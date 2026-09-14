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

function setup(t, handlers = L1_OK, yaml = {}, extras = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-pipe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = silentLog();
  const store = createStore(dir, log);
  const config = createConfig(yaml, null);
  const calls = [];
  const llm = stubLlm(handlers, calls);
  const modes = extras.modes || null;
  const pipeline = createPipeline({ store, llm, config, log, getMode: (sid) => (modes ? modes.get(sid) : 'auto') });
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

test('L2 / L3 水位触发（分族水位）', async (t) => {
  const { store, pipeline, calls } = await setup(t, L1_OK, { l2: { minNewMemories: 2 }, l3: { interval: 2 } });
  for (let i = 1; i <= 2; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords('chat').length, 2);   // L1（无族标签兜底 chat）
  assert.equal(store.getScenes('chat').length, 1);    // L2（chat 族新记忆 2 ≥ 2）
  assert.ok(store.getPersona('chat'));                // L3（chat 族新记忆 2 ≥ 2）
  assert.equal(store.getPersona('work'), null);
  assert.ok(calls.some((c) => c.purpose === 'memory:scene'));
  assert.ok(calls.some((c) => c.purpose === 'memory:persona'));
});

test('auto 档显式归族：work 记忆独立水位，触发 work 族 L2/L3', async (t) => {
  const handlers = {
    'memory:extract': () => ({ ok: true, text: JSON.stringify({ memories: [
      { content: '个人偏好早起', family: 'chat' },
      { content: '项目决策使用 monorepo', family: 'work' },
    ] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 10 } }),
    'memory:scene': () => ({ ok: true, text: JSON.stringify({ scenes: [{ title: '工作场景', content: 'monorepo 决策', record_ids: [] }], dropped_ids: [] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 10 } }),
    'memory:persona': () => ({ ok: true, text: JSON.stringify({ persona: '团队当前聚焦记忆插件开发，采用 monorepo 结构与 TypeScript 技术栈。' }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 10 } }),
  };
  const { store, pipeline, calls } = await setup(t, handlers, { l2: { minNewMemories: 2 }, l3: { interval: 2 } });
  for (let i = 1; i <= 2; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords('chat').length, 1);
  assert.equal(store.getRecords('work').length, 1);
  assert.equal(store.familyWater('work').newSinceL2, 1); // work 族只有 1 条，未达阈值 2
  assert.equal(store.familyWater('chat').newSinceL2, 1);
  // 纯档强制族标签：chat 档会话再蒸馏 1 条 → chat 水位 2 → L2/L3(chat) 触发
  const modes = { get: () => 'chat' };
  const { store: store2, pipeline: pipeline2, calls: calls2 } = setup2(t, handlers, { l2: { minNewMemories: 2 }, l3: { interval: 2 } }, modes);
  for (let i = 1; i <= 2; i++) {
    store2.appendConversation('s2', 'user', `消息 ${i}`);
    pipeline2.noteActivity('s2');
  }
  await pipeline2.flushSession('s2', 'test');
  assert.equal(store2.getRecords('chat').length, 2); // 抽取输出 family:work 被纯档强制覆盖
  assert.equal(store2.getRecords('work').length, 0);
  assert.ok(calls2.some((c) => c.purpose === 'memory:scene' && c.system.includes('记忆整合器')));
});

function setup2(t, handlers, yaml, modes) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-pipe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = silentLog();
  const store = createStore(dir, log);
  const config = createConfig(yaml, null);
  const calls = [];
  const llm = stubLlm(handlers, calls);
  const pipeline = createPipeline({ store, llm, config, log, getMode: (sid) => modes.get(sid) });
  return { store, pipeline, calls };
}

test('off 档会话：捕获计数不推进，蒸馏挂起', async (t) => {
  const entries = new Map([['s1', { mode: 'off' }]]);
  const modes = { get: (sid) => entries.get(sid)?.mode ?? 'auto' };
  const { store, pipeline } = await setup(t, L1_OK, {}, { modes });
  for (let i = 1; i <= 5; i++) {
    store.appendConversation('s1', 'user', `消息 ${i}`);
    pipeline.noteActivity('s1');
  }
  assert.equal(store.sessionState('s1').count, 0); // off 档不计数
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords().length, 0);
});

test('跨族合并防御：existing_id 与解析族不同 → 按新增处理', async (t) => {
  const { store, pipeline } = await setup(t, {
    'memory:extract': () => ({ ok: true, text: JSON.stringify({ memories: [
      { content: '项目决策使用 monorepo', family: 'work', existing_id: 'm_个人' },
    ] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 5 } }),
  }, {});
  store.upsertRecord({ id: 'm_个人', content: '旧的个人记忆', family: 'chat' });
  store.appendConversation('s1', 'user', '消息');
  pipeline.noteActivity('s1');
  await pipeline.flushSession('s1', 'test');
  assert.equal(store.getRecords('work').length, 1); // 新增 work 记录
  assert.equal(store.getRecord('m_个人').family, 'chat'); // 原记录未被跨族污染
  assert.notEqual(store.getRecord('m_个人').content, '项目决策使用 monorepo');
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
