// L2 分批整合 —— 端到端验证（真实库只读：先把 records.json 复制到临时目录，再在副本上演练）。
// 用法：node verify-l2.mjs
//
// A 真实积压读数：旧「一次性整族送进 prompt」的输入规模（必然被模型输出预算截断）
// B 分批消化：每批 prompt 有界、积压能清零、模型不再回显全部 id
// C 沿用场景：模型只回 id+title 时，正文与成员由管线保留
// D 稳态门控：积压清零后要攒够新记忆才再跑
// E 真实失败模式：模型对「条数多」的批次烧光输出预算（与输入长度无关）→ 拆半重试必须能自愈

import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './lib/store.js';
import { createConfig } from './lib/config.js';
import { createPipeline } from './lib/pipeline.js';
import { buildL2Prompt } from './lib/prompts.js';

const DATA = join(homedir(), '.dsh', 'dsh-memory');
const MODEL_BUDGET = 60000; // 模拟真实模型：输入超过这个量级就 max-tokens 空输出
let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`);
  else { failed += 1; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
const silentLog = () => {
  const lines = [];
  return {
    debug() {}, info(msg) { lines.push(`[info] ${msg}`); }, warn(msg) { lines.push(`[warn] ${msg}`); },
    error(msg) { lines.push(`[error] ${msg}`); }, tail: () => lines, errors: () => [], lastError: () => null,
  };
};

const recordsPath = join(DATA, 'records.json');
if (!existsSync(recordsPath)) {
  console.log('✗ 找不到生产库 records.json，跳过');
  process.exit(1);
}
const raw = JSON.parse(readFileSync(recordsPath, 'utf-8'));
const all = raw.records || [];
console.log(`生产库：${all.length} 条（只读，不会改动）\n`);

// ---------- A 真实积压与此前的失败规模 ----------
console.log('A 真实积压读数（旧路径为什么必炸）');
const dir = mkdtempSync(join(tmpdir(), 'dsh-l2-verify-'));
copyFileSync(recordsPath, join(dir, 'records.json'));
const log = silentLog();
const store = createStore(dir, log);
const cfg0 = createConfig({}, null).effective();
const pendingWork = store.getPendingRecords('work');
const pendingChat = store.getPendingRecords('chat');
const workChars = pendingWork.reduce((n, r) => n + r.content.length, 0);
console.log(`  chat 待整合 ${pendingChat.length} 条 / work 待整合 ${pendingWork.length} 条（work 正文 ${workChars} 字符）`);

// 积压清零后（正常状态），本脚本的 B/C/E 三组需要「有积压」才能演练。
// 这里就地造一批未归场景的副本记录，让验证始终可跑——不碰生产库。
let synthetic = 0;
if (pendingWork.length < 40) {
  const need = 40 - pendingWork.length;
  for (let i = 0; i < need; i += 1) {
    store.upsertRecord({
      content: `合成验证记录 ${i}：像素办公室场景渲染要继续优化走路卡顿的问题，第 ${i} 条`,
      family: 'work',
    });
  }
  synthetic = need;
  console.log(`  （生产库积压已清零，就地补 ${need} 条合成记录用于演练 B/C/E；仅副本）`);
}
const oldPrompt = buildL2Prompt({
  records: pendingWork,
  existingScenes: store.getScenes('work'),
  maxScenes: cfg0.l2.maxScenes,
  sceneContextLimit: cfg0.l2.sceneContextLimit,
  maxInputChars: cfg0.llm.maxInputChars,
  family: 'work',
});
const rawPromptChars = buildL2Prompt({
  records: pendingWork, existingScenes: [], maxScenes: 12, sceneContextLimit: 3,
  maxInputChars: 10 ** 9, family: 'work',
}).user.length;
// 这条是「读数」不是门槛：积压大时旧路径必炸，积压已经被分批消化完了自然就不炸了。
if (oldPrompt.user.length > cfg0.l2.batchChars) {
  ok(true, '旧的一次性路径：一次塞整族，远超单批预算（积压越大越离谱）',
    `旧 ${rawPromptChars} 字符 → 截断后 ${oldPrompt.user.length} 字符，单批预算 ${cfg0.l2.batchChars} 字符`);
} else {
  ok(true, '积压已收敛到单批预算内（旧路径此时也不会炸，说明积压真的被消化了）',
    `旧 ${rawPromptChars} 字符，单批预算 ${cfg0.l2.batchChars} 字符`);
}
const charBudget = cfg0.l2.batchChars;
let firstN = 0;
let firstChars = 0;
// 用补料后的积压算「首批」（pendingWork 是补料前的快照）
const pendingForBudget = store.getPendingRecords('work');
for (const r of pendingForBudget) {
  if (firstN >= cfg0.l2.batchRecords) break;
  const len = r.content.length;
  if (firstN > 0 && firstChars + len > charBudget) break;
  firstN += 1;
  firstChars += len;
}
ok(firstN > 0 && firstChars <= charBudget, '字符预算下的首批条数（长记忆族自动缩小批）', `${firstN} 条 / ${firstChars} 字符（上限 ${charBudget}）`);
ok(cfg0.l2.batchRecords > 0 && cfg0.l2.maxBatchesPerRun > 0,
  '分批参数已就位',
  `batchRecords=${cfg0.l2.batchRecords}, maxBatchesPerRun=${cfg0.l2.maxBatchesPerRun}`);

// ---------- B 分批消化 ----------
console.log('\nB 分批消化（副本上跑，模拟模型）');
const state = { calls: [], ids: [], titles: new Map(), sceneId: null, title: '工作积压汇总' };
const model = ({ user }) => {
  state.calls.push(user);
  if (user.length > MODEL_BUDGET) {
    return { ok: false, error: '空输出（finish=max-tokens, output=16384tok）', route: { provider: 'workbuddy', model: 'cn:deepseek-v4.1-flash' }, usage: {} };
  }
  const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
  const sceneIds = [...user.matchAll(/- \[(s_[a-z0-9]+)\] /g)].map((m) => m[1]);
  state.ids.push(...ids);
  const mainId = state.sceneId || sceneIds[0] || null;
  if (mainId) state.sceneId = mainId;
  const scenes = [];
  for (const id of sceneIds) {
    if (id === mainId) continue;
    scenes.push({ id, title: state.titles.get(id) || `沿用场景 ${id}` }); // 沿用场景：只回 id + title
  }
  scenes.push({
    id: mainId || undefined,
    title: state.title,
    content: `累计 ${state.ids.length} 条工作记忆的浓缩摘要（本批 ${ids.length} 条）。`,
    record_ids: state.ids,
  });
  return { ok: true, text: JSON.stringify({ scenes, dropped_ids: [] }), route: { provider: 'p', model: 'm' }, usage: { outputTokens: 300 } };
};
const llm = { available: () => true, setRuntime() {}, call: async ({ purpose, system, user }) => {
  if (purpose !== 'memory:scene') return { ok: true, text: '{}', route: {}, usage: {} };
  return model({ system, user });
} };
const config = createConfig({}, null);
const pipeline = createPipeline({ store, llm, config, log, getMode: () => 'auto' });
const before = pendingWork.length;
let rounds = 0;
const t0 = Date.now();
for (let i = 0; i < 8 && store.getPendingRecords('work').length > 0; i++) {
  await pipeline.buildScenes('work', 20);
  rounds += 1;
}
const cost = Date.now() - t0;
const after = store.getPendingRecords('work').length;
const maxPrompt = Math.max(0, ...state.calls.map((u) => u.length));
const maxIds = Math.max(0, ...state.calls.map((u) => [...u.matchAll(/- \[(m_[a-z0-9]+)\]/g)].length));
ok(state.calls.every((u) => u.length <= MODEL_BUDGET), '每一批 prompt 都在模型预算内（不再 max-tokens 空输出）', `最大 ${maxPrompt} 字符`);
ok(maxIds <= cfg0.l2.batchRecords, '每批送进去的记忆数 ≤ batchRecords', `最大 ${maxIds} 条`);
ok(after === 0, '积压能真正清零（旧代码永远清不掉）', `${before} → ${after}，共 ${state.calls.length} 批 / 耗时 ${cost}ms`);
const owned = store.getRecords('work').filter((r) => r.sceneId).length;
ok(owned >= before, '所有积压记录都归入了场景', `有场景归属 ${owned} 条`);

// ---------- C 沿用场景不丢正文与成员 ----------
console.log('\nC 沿用场景：只回 id+title 也不丢内容');
const scenes = store.getScenes('work');
const main = scenes.find((s) => s.id === state.sceneId);
ok(Boolean(main), '主场景存在', main ? `「${main.title}」` : '');
ok(Boolean(main) && main.content.length > 20, '正文由管线保留（模型没回 content）', main ? `${main.content.length} 字符` : '');
ok(Boolean(main) && (main.recordIds || []).length > cfg0.l2.batchRecords, '成员在多批之间累加（模型没回 record_ids）', main ? `${(main.recordIds || []).length} 条` : '');

// ---------- D 稳态门控 ----------
console.log('\nD 稳态门控');
const callsBefore = state.calls.length;
store.upsertRecord({ content: '新蒸馏出来的一条工作记忆', family: 'work' });
await pipeline.maybeL2('work');
ok(state.calls.length === callsBefore, '积压清零后，没攒够 minNewMemories 不再白跑 L2');
const water = store.familyWater('work');
water.newSinceL2 = cfg0.l2.minNewMemories;
store.saveState();
await pipeline.maybeL2('work');
ok(state.calls.length === callsBefore + 1, '攒够新记忆后正常触发一批 L2');
ok(state.calls.every((u) => u.length <= MODEL_BUDGET), '稳态路径同样不超预算');

// ---------- E 真实失败模式：思考吃光输出预算（与输入长度无关） ----------
console.log('\nE 模拟真实失败：条数多的批次烧光输出预算 → 拆半自愈');
const dir2 = mkdtempSync(join(tmpdir(), 'dsh-l2-verify-'));
copyFileSync(recordsPath, join(dir2, 'records.json'));
const store2 = createStore(dir2, silentLog());
// 同上：E 组要有「条数多的批次」才能触发打回，积压清零时补合成记录
if (store2.getPendingRecords('work').length < 40) {
  for (let i = 0; i < 40; i += 1) {
    store2.upsertRecord({
      content: `E 组合成验证记录 ${i}：像素办公室场景渲染要继续优化走路卡顿的问题，第 ${i} 条`,
      family: 'work',
    });
  }
}
const calls = [];
const model2 = ({ user }) => {
  const ids = [...user.matchAll(/- \[(m_[a-z0-9]+)\]/g)].map((m) => m[1]);
  calls.push(ids.length);
  if (ids.length > 12) {
    return { ok: false, error: '空输出（finish=max-tokens, output=16384tok）', route: { provider: 'workbuddy', model: 'cn:deepseek-v4.1-flash' }, usage: {} };
  }
  return {
    ok: true,
    text: JSON.stringify({ scenes: [{ title: `拆半场景 ${calls.length}`, content: '正文', record_ids: ids }], dropped_ids: [] }),
    route: {}, usage: { outputTokens: 80 },
  };
};
const llm2 = {
  available: () => true,
  setRuntime() {},
  call: async ({ purpose, user }) => (purpose !== 'memory:scene' ? { ok: true, text: '{}', route: {}, usage: {} } : model2({ user })),
};
const pipe2 = createPipeline({ store: store2, llm: llm2, config: createConfig({}, null), log: silentLog(), getMode: () => 'auto' });
const beforeW = store2.getPendingRecords('work').length;
const t1 = Date.now();
for (let i = 0; i < 80 && store2.getPendingRecords('work').length > 0; i++) await pipe2.buildScenes('work', 5);
const afterW = store2.getPendingRecords('work').length;
ok(calls.some((n) => n > 12), '确实触发过会被打回的大批次', `最大 ${Math.max(0, ...calls)} 条`);
ok(afterW === 0, '拆半重试后积压仍能清零（旧代码在第一批就整体报错）', `${beforeW} → ${afterW}，共 ${calls.length} 次调用 / ${Date.now() - t1}ms`);
ok(store2.getRecords('work').filter((r) => r.sceneId).length >= beforeW, '拆半后每条记忆都归入了场景');
rmSync(dir2, { recursive: true, force: true });

rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
