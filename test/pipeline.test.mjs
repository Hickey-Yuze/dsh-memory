// 蒸馏管线单测：桩 LLM 驱动 L1→L2→L3 全链路 / 失败退避 / 重建。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { createPipeline } from '../lib/pipeline.js';
import { createConfig } from '../lib/config.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

/** 按 purpose 分发的桩 LLM。 */
function stubLlm(handlers, calls = []) {
  return {
    available: () => true,
    setRuntime() {},
    async call({ purpose, system, user }) {
      calls.push({ purpose, system, user });
      const handler = handlers[purpose];
      if (!handler) throw new Error(`unexpected purpose ${purpose}`);
      return handler({ system, user });
    },
  };
}

const L1_OK = {
  'memory:extract': () => ({ ok: true, text: JSON.stringify({ memories: [{ content: '用户偏好 pnpm', tags: ['工具'] }, { content: '项目用 TypeScript' }] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 42 } }),
  'memory:scene': () => ({ ok: true, text: JSON.stringify({ scenes: [{ title: '工程偏好', content: 'pnpm + TS', record_ids: [] }], dropped_ids: [] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 20 } }),
  'memory:persona': () => ({ ok: true, text: JSON.stringify({ persona: '用户是注重工程效率的前端开发者，偏好 pnpm 与 TypeScript，长期维护 DSH 生态插件。' }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 60 } }),
};

function setup(t, handlers = L1_OK, yaml = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-pipe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = silentLog();
  const store = createStore(dir, log);
  const config = createConfig(yaml, null);
  const calls = [];
  const llm = stubLlm(handlers, calls);
  const pipeline = createPipeline({ store, llm, config, log });
  return { dir, store, config, pipeline, calls, log };
}

test('阈值触发 L1 抽取：记录入库、水位清零、翻倍爬坡', async (t) => {
  const { store, pipeline } = await setup(t, L1_OK, { extract: { minMessages: 2 } });
  for (let i = 1; i <= 2; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  assert.equal(pipeline.effectiveThresholdForTest ? pipeline.effectiveThresholdForTest('s1') : 2, 2);
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords().length, 2);
  const s = store.sessionState('s1');
  assert.equal(s.count, 0);
  assert.equal(s.rounds, 1);
  // 爬坡：rounds=1 → 本轮阈值 2^1=2；再攒 1 条未达自动触发线，但水位已计入
  pipeline.noteActivity('s1');
  assert.equal(store.sessionState('s1').count, 1);
  await pipeline.flushSession('s1', 'test'); // 手动 flush 照常蒸馏
  assert.equal(store.sessionState('s1').count, 0);
  assert.equal(store.sessionState('s1').rounds, 2);
});

test('L2 / L3 水位触发', async (t) => {
  const { store, pipeline, calls } = await setup(t, L1_OK, { l2: { minNewMemories: 2 }, l3: { interval: 2 } });
  for (let i = 1; i <= 2; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords().length, 2);   // L1
  assert.equal(store.getScenes().length, 1);    // L2（新记忆 2 ≥ 2）
  assert.ok(store.getPersona());                // L3（新记忆 2 ≥ 2）
  assert.ok(calls.some((c) => c.purpose === 'memory:scene'));
  assert.ok(calls.some((c) => c.purpose === 'memory:persona'));
});

test('L1 失败：计数保留 + 退避，不崩管线', async (t) => {
  const failHandlers = {
    'memory:extract': () => ({ ok: false, error: '路由炸了' }),
  };
  const { store, pipeline } = await setup(t, failHandlers, { extract: { minMessages: 2 } });
  for (let i = 1; i <= 2; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  await pipeline.flushSession('s1', 'test');
  const s = store.sessionState('s1');
  assert.equal(s.count, 2);           // 消息未丢
  assert.ok(s.backoffUntil > Date.now());
  assert.equal(store.getRecords().length, 0);
  const err = store.getState();
  assert.equal(err.stats.distillFailures, 1);
});

test('全量重建：清资产、按块重蒸、进度推进', async (t) => {
  const { store, pipeline } = await setup(t, L1_OK, {});
  for (let i = 1; i <= 3; i++) {
    store.appendConversation('sA', 'user', `A${i}`);
    pipeline.noteActivity('sA');
  }
  await pipeline.flushSession('sA', 'seed'); // 先积累一轮 → 2 条旧记忆
  const before = store.getRecords().length;
  assert.ok(before >= 2);
  const started = await pipeline.startRebuild();
  assert.equal(started.started, true);
  // 等重建收敛
  for (let i = 0; i < 100; i++) {
    const rb = store.getState().rebuild;
    if (rb && rb.phase !== 'running') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const rb = store.getState().rebuild;
  assert.equal(rb.phase, 'done');
  assert.equal(rb.done, 3);
  assert.ok(store.getRecords().length >= 2);
});

test('重建取消', async (t) => {
  const { store, pipeline } = await setup(t, {
    'memory:extract': async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, text: JSON.stringify({ memories: [{ content: 'x' }] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 1 } };
    },
  }, {});
  for (let i = 1; i <= 10; i++) store.appendConversation('sB', 'user', `B${i}`);
  const started = await pipeline.startRebuild();
  assert.equal(started.started, true);
  assert.equal(pipeline.cancelRebuild(), true);
  for (let i = 0; i < 100; i++) {
    const rb = store.getState().rebuild;
    if (rb && rb.phase !== 'running') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(store.getState().rebuild.phase, 'cancelled');
});
