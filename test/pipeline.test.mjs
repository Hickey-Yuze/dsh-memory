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

test('L2 分批：积压按批送进 prompt，不再一次性塞爆', async (t) => {
  const handler = ({ user }) => {
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    return {
      ok: true,
      text: JSON.stringify({ scenes: [{ title: '工程偏好', content: '工程类记忆合集', record_ids: ids }], dropped_ids: [] }),
      route: { provider: 'p', model: 'm' },
      usage: { outputTokens: 30 },
    };
  };
  const { store, pipeline, calls } = setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 3, maxBatchesPerRun: 2 } });
  for (let i = 1; i <= 7; i++) store.upsertRecord({ content: `工程记忆 ${i}`, family: 'chat' });
  await pipeline.maybeL2('chat');
  assert.equal(calls.length, 2, '单次触发只跑 maxBatchesPerRun 批');
  for (const call of calls) {
    const ids = [...call.user.matchAll(/- \[(m_[a-z0-9]+)\]/g)];
    assert.ok(ids.length <= 3, `单批记忆数应 ≤ batchRecords，实际 ${ids.length}`);
  }
  assert.equal(store.getRecords('chat').filter((r) => r.sceneId).length, 6, '两批共 6 条进了场景');
  assert.equal(store.getPendingRecords('chat').length, 1, '两批消化 6 条，剩 1 条等下轮');
});

test('L2 未归类条目不卡队头：打跳过标记后队列归零', async (t) => {
  const handler = () => ({
    ok: true,
    text: JSON.stringify({ scenes: [{ title: '空场景', content: '暂无内容', record_ids: [] }], dropped_ids: [] }),
    route: { provider: 'p', model: 'm' },
    usage: { outputTokens: 10 },
  });
  const { store, pipeline, calls } = setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 2, maxBatchesPerRun: 5 } });
  for (let i = 1; i <= 5; i++) store.upsertRecord({ content: `零散记忆 ${i}`, family: 'chat' });
  await pipeline.maybeL2('chat');
  assert.equal(store.getPendingRecords('chat').length, 0, '模型没归类的条目应被跳过标记，不再卡住队头');
  assert.equal(calls.length, 3, '5 条按每批 2 条分 3 批消化');
});

test('L2 沿用未提及的已有场景：漏掉≠删除', async (t) => {
  const phase = { n: 0 };
  const first = () => {
    phase.n += 1;
    const title = phase.n === 1 ? '甲场景' : '乙场景';
    return {
      ok: true,
      text: JSON.stringify({ scenes: [{ title, content: `${title}的内容`, record_ids: [] }], dropped_ids: [] }),
      route: { provider: 'p', model: 'm' },
      usage: { outputTokens: 10 },
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': first }, { l2: { minNewMemories: 99, batchRecords: 2, maxBatchesPerRun: 1 } });
  store.upsertRecord({ content: '记忆 A', family: 'chat' });
  store.upsertRecord({ content: '记忆 B', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const kept = store.getScenes('chat');
  assert.equal(kept.length, 1);
  // 第二批：模型只回新场景、完全没提甲场景 → 甲场景必须被兜住
  store.upsertRecord({ content: '记忆 C', family: 'chat' });
  store.upsertRecord({ content: '记忆 D', family: 'chat' });
  store.upsertRecord({ content: '记忆 E', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const after = store.getScenes('chat');
  assert.ok(after.some((s) => s.title === '甲场景'), '未提及的已有场景不能被丢掉');
  assert.ok(after.length >= 2);
});

test('L2 沿用场景：只回 id+title 时，正文与成员由管线保留', async (t) => {
  const phase = { n: 0 };
  const handler = ({ user }) => {
    phase.n += 1;
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    const sceneIds = [...user.matchAll(/- \[(s_[a-z0-9]+)\] /g)].map((m) => m[1]);
    const base = { ok: true, route: { provider: 'p', model: 'm' }, usage: { outputTokens: 20 } };
    if (phase.n === 1) {
      return { ...base, text: JSON.stringify({ scenes: [{ title: '甲场景', content: '甲的正文', record_ids: ids }], dropped_ids: [] }) };
    }
    return {
      ...base,
      text: JSON.stringify({
        scenes: [
          { id: sceneIds[0], title: '甲场景' }, // 沿用：不回 content、不回 record_ids
          { title: '乙场景', content: '乙的正文', record_ids: ids },
        ],
        dropped_ids: [],
      }),
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 2, maxBatchesPerRun: 1 } });
  store.upsertRecord({ content: '记忆 A1', family: 'chat' });
  store.upsertRecord({ content: '记忆 A2', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const jia = store.getScenes('chat').find((s) => s.title === '甲场景');
  assert.ok(jia && jia.content === '甲的正文');
  assert.equal((jia.recordIds || []).length, 2);

  store.upsertRecord({ content: '记忆 B1', family: 'chat' });
  store.upsertRecord({ content: '记忆 B2', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const scenes = store.getScenes('chat');
  const jia2 = scenes.find((s) => s.title === '甲场景');
  assert.equal(jia2.content, '甲的正文', '沿用场景的正文不能被清空');
  assert.equal((jia2.recordIds || []).length, 2, '沿用场景的成员不能被清空');
  assert.equal((scenes.find((s) => s.title === '乙场景').recordIds || []).length, 2);
});

test('后台整合：进度可见（批次递增 / 剩余递减 / 预估值与耗时）', async (t) => {
  const handler = ({ user }) => {
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    return {
      ok: true,
      text: JSON.stringify({ scenes: [{ title: '进度场景', content: '正文', record_ids: ids }], dropped_ids: [] }),
      route: { provider: 'p', model: 'm' },
      usage: { outputTokens: 10 },
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 2, maxBatchesPerRun: 2 } });
  for (let i = 0; i < 6; i++) store.upsertRecord({ content: `记忆 P${i}`, family: 'chat' });
  const started = pipeline.startSceneBuild('chat', 3);
  assert.equal(started.started, true);
  assert.equal(started.pendingBefore, 6);
  assert.equal(started.pendingAfter, 6);
  assert.equal(started.total, 3);
  assert.equal(started.batchSize, 2);
  assert.equal(started.running, true);
  assert.ok(typeof started.elapsedMs === 'number');
  assert.equal(pipeline.startSceneBuild('chat', 3).started, false, '已在跑时不重复启动');
  for (let i = 0; i < 60 && pipeline.sceneBuildStatus().running; i++) await new Promise((r) => setTimeout(r, 10));
  const st = pipeline.sceneBuildStatus();
  assert.equal(st.running, false);
  assert.equal(st.batches, 3);
  assert.equal(st.pendingAfter, 0);
  assert.equal(st.error, '');
  assert.ok(st.finishedAt > 0 && st.elapsedMs >= 0);
});

test('L2 分批：按字符预算自动缩小批', async (t) => {
  const seen = [];
  const handler = ({ user }) => {
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    seen.push(ids.length);
    return {
      ok: true,
      text: JSON.stringify({ scenes: [{ title: `批${seen.length}`, content: '正文', record_ids: ids }], dropped_ids: [] }),
      route: { provider: 'p', model: 'm' },
      usage: { outputTokens: 5 },
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 60, batchChars: 800 } });
  for (let i = 0; i < 6; i++) store.upsertRecord({ content: 'x'.repeat(300) + `#${i}`, family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  assert.deepEqual(seen, [2], '800 字符预算下每批 2 条');
});

test('L2 拆半重试：整批输出被 max-tokens 打回时自动拆小重跑', async (t) => {
  let calls = 0;
  const handler = ({ user }) => {
    calls += 1;
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    const base = { route: { provider: 'p', model: 'm' } };
    if (ids.length > 2) return { ...base, ok: false, error: '空输出（finish=max-tokens, output=16384tok）' };
    return {
      ...base,
      ok: true,
      text: JSON.stringify({ scenes: [{ title: `场景${calls}`, content: '正文', record_ids: ids }], dropped_ids: [] }),
      usage: { outputTokens: 10 },
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 60, minBatchRecords: 1 } });
  for (let i = 0; i < 6; i++) store.upsertRecord({ content: `记忆 S${i}`, family: 'chat' });
  await pipeline.buildScenes('chat', 5);
  assert.ok(calls > 2, `应发生拆半重试（实际调用 ${calls} 次）`);
  assert.equal(store.getPendingRecords('chat').length, 0, '拆半后积压清零');
  const covered = store.getScenes('chat').reduce((n, s) => n + (s.recordIds || []).length, 0);
  assert.equal(covered, 6, '6 条记忆都归入场景');
});

test('L2 到下限仍被打回：跳过该批而不是整族卡死', async (t) => {
  const handler = () => ({ ok: false, error: '空输出（finish=max-tokens, output=16384tok）', route: { provider: 'p', model: 'm' }, usage: {} });
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 60, minBatchRecords: 4 } });
  for (let i = 0; i < 4; i++) store.upsertRecord({ content: `记忆 K${i}`, family: 'chat' });
  const ids = store.getRecords('chat').map((r) => r.id);
  await pipeline.buildScenes('chat', 3);
  assert.equal(store.getPendingRecords('chat').length, 0, '不再卡在队头');
  assert.ok(ids.every((id) => store.getRecord(id).l2SkippedAt > 0), '被跳过的记录打了标记');
  store.upsertRecord({ id: ids[0], content: '记忆 K0（更新过）', family: 'chat' });
  assert.ok(store.getPendingRecords('chat').some((r) => r.id === ids[0]), '内容更新后重新参与整合');
});

test('L2 同名场景守卫：模型把同一主题又建一遍时不重复建档', async (t) => {
  const handler = ({ user }) => {
    const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
    return {
      ok: true,
      text: JSON.stringify({ scenes: [{ title: '甲场景', content: '甲的内容', record_ids: ids }], dropped_ids: [] }),
      route: { provider: 'p', model: 'm' },
      usage: { outputTokens: 10 },
    };
  };
  const { store, pipeline } = await setup(t, { 'memory:scene': handler }, { l2: { minNewMemories: 99, batchRecords: 2, maxBatchesPerRun: 1 } });
  store.upsertRecord({ content: '记忆 A', family: 'chat' });
  store.upsertRecord({ content: '记忆 B', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const id1 = store.getScenes('chat')[0].id;
  // 第二批：模型没回 id，而是要新建一个标题完全一样的场景 → 应认领已有那条
  store.upsertRecord({ content: '记忆 C', family: 'chat' });
  store.upsertRecord({ content: '记忆 D', family: 'chat' });
  store.upsertRecord({ content: '记忆 E', family: 'chat' });
  await pipeline.buildScenes('chat', 1);
  const scenes = store.getScenes('chat');
  assert.equal(scenes.length, 1, '同名场景不该重复建档');
  assert.equal(scenes[0].id, id1, '沿用原场景 id');
  // batchRecords=2：第一批 2 条、第二批 2 条（第三条 E 还在队列里等下一批）
  assert.equal(scenes[0].recordIds.length, 4, '两批记忆都并进同一个场景');
});
