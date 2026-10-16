// 记忆体检 + 近重复合并 + 召回公平性 + 召回超时降级 —— 端到端验证（真实库只读）。
// 只读生产库：先把 records.json / bias.json 复制到临时目录，再在副本上跑体检与合并演练，
// 绝不写 ~/.dsh/dsh-memory/。用法：node verify-audit.mjs
//
// A 真实库体检读数   B 近重复分组与合并演练（副本）
// C 召回公平性（近重复收敛 + 同分让位）  D 召回超时降级（慢知识库）
// E 路由/工具已接线

import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createStore } from './lib/store.js';
import { auditHealth, auditSummary, groupDuplicates, planAutoMerges } from './lib/audit.js';
import { collapseNearDuplicates, applyExposureBalance, rankDocs } from './lib/search.js';
import { createRecall } from './lib/recall.js';
import { createRecallDedupe } from './lib/recall-dedupe.js';
import { createConfig } from './lib/config.js';

const DATA = join(homedir(), '.dsh', 'dsh-memory');
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
const records = raw.records || [];
console.log(`生产库：${records.length} 条（只读，不会改动）\n`);

// ---------- A 真实库体检 ----------
console.log('A 真实库体检');
const t0 = Date.now();
const report = auditHealth(records);
const cost = Date.now() - t0;
console.log(`  ${auditSummary(report)}`);
ok(report.total === records.length, '总条数一致', `${report.total}`);
ok(Number.isFinite(report.coverage.hitPct), '覆盖率可计算', `${report.coverage.hitPct}%`);
ok(cost < 3000, '体检耗时在 3 秒内', `${cost}ms`);
ok(report.sleeping.count <= report.coverage.zero, '沉睡数 ≤ 未召回数', `${report.sleeping.count} ≤ ${report.coverage.zero}`);

// ---------- B 近重复分组 + 合并演练（副本） ----------
console.log('\nB 近重复分组与合并演练（临时副本）');
const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-audit-'));
const log = silentLog();
try {
  copyFileSync(recordsPath, join(dir, 'records.json'));
  if (existsSync(join(DATA, 'bias.json'))) copyFileSync(join(DATA, 'bias.json'), join(dir, 'bias.json'));
  const store = createStore(dir, log);
  const before = store.getRecords().length;
  const groups = groupDuplicates(store.getRecords());
  const mergable = groups.reduce((n, g) => n + g.size - 1, 0);
  ok(groups.length > 0, '副本里找到近重复组', `${groups.length} 组 / 可合并 ${mergable} 条`);
  ok(groups.every((g) => g.size >= 2), '每组至少 2 条');
  ok(groups.every((g) => g.members.some((m) => m.id === g.keepId)), '保留者必在组内');

  if (groups.length > 0) {
    const g = groups[0];
    const dropIds = g.members.filter((m) => m.id !== g.keepId).map((m) => m.id);
    const keepBefore = store.getRecord(g.keepId);
    const hitsBefore = dropIds.reduce((n, id) => n + (store.getRecord(id)?.hits || 0), 0) + (keepBefore.hits || 0);
    const merged = store.mergeRecords(g.keepId, dropIds, { content: g.suggestedContent });
    ok(merged && merged.dropped === dropIds.length, '合并删除条数正确', `${merged && merged.dropped}`);
    ok(store.getRecords().length === before - dropIds.length, '总量按预期减少', `${before} → ${store.getRecords().length}`);
    ok(store.getRecord(g.keepId).hits === hitsBefore, 'hits 已累加', `${hitsBefore}`);
    ok(store.getRecord(g.keepId).content === g.suggestedContent, '内容取建议的最全版本');
    ok(dropIds.every((id) => store.getRecord(id) === null), '被并入的记录已删除');
  }
  ok(store.counts().records === store.getRecords().length, 'counts 与记录数一致');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- C 召回公平性 ----------
console.log('\nC 召回公平性（近重复收敛 + 同分让位）');
const dupDocs = [
  { id: 'head1', family: 'work', hits: 25, text: '用户已装跨会话技能与调用约定，写入 AGENTS.md 持久层' },
  { id: 'head2', family: 'work', hits: 0, text: '用户已装跨会话技能与调用约定，写入 AGENTS.md 持久层' },
  { id: 'cold', family: 'work', hits: 0, text: '用户已装跨会话技能与调用约定，写入 AGENTS.md 持久层，另有补充说明' },
];
const scored = rankDocs('已装技能与调用约定', dupDocs, { threshold: 0, limit: 10 });
const collapsed = collapseNearDuplicates(scored);
ok(collapsed.length < scored.length, '近重复在召回侧被收敛', `${scored.length} → ${collapsed.length}`);
ok(collapsed.filter((c) => c.item.id === 'head1' || c.item.id === 'head2').length < 2, '同一条的两个版本不会同时占位');

const tie = [
  { score: 0.8, item: { id: 'hot', family: 'work', hits: 25 } },
  { score: 0.79, item: { id: 'cold', family: 'work', hits: 0 } },
];
ok(applyExposureBalance(tie)[0].item.id === 'cold', '同分同族时命中少的先上');
ok(applyExposureBalance(tie, { epsilon: 0 })[0].item.id === 'hot', '关掉均衡（epsilon=0）时按原分数排');

// ---------- D 召回超时降级 ----------
console.log('\nD 召回超时降级');
{
  const dir2 = mkdtempSync(join(tmpdir(), 'dsh-memory-audit-timeout-'));
  const log2 = silentLog();
  try {
    const config = createConfig({ recall: { timeoutMs: 80 }, knowledge: { enabled: true } }, null);
    const store = {
      getRecords: () => [
        { id: 'm1', content: '部署流程是 pnpm build 后跑 vercel deploy', family: 'chat', kind: 'fact', hits: 0, updatedAt: Date.now() },
      ],
      getRecord: () => null, getBiases: () => [], getBias: () => null,
      getState: () => ({ stats: {} }), saveState() {},
    };
    const dedupe = createRecallDedupe(dir2, log2);
    const knowledge = { chunkCount: () => 5, search: () => new Promise(() => {}) }; // 永不返回
    const recall = createRecall({ store, config, log: log2, modes: null, embedding: null, dedupe, knowledge });
    const started = Date.now();
    const text = await recall.recallText('s1', 'pnpm 部署流程怎么走');
    const costMs = Date.now() - started;
    ok(costMs < 1000, '超时后立刻返回，不阻塞', `${costMs}ms`);
    ok(text !== '', '不再整轮丢弃（旧行为返回空串）');
    ok(text.includes('部署流程'), '同步层的 L1 照常注入');
    ok(log2.tail().some((l) => l.includes('降级') || l.includes('超时')), '日志写明降级原因');
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
}

// ---------- E 接线 ----------
console.log('\nE 路由与工具接线');
{
  const routes = readFileSync(new URL('./lib/routes.js', import.meta.url), 'utf-8');
  const tools = readFileSync(new URL('./lib/tools.js', import.meta.url), 'utf-8');
  const client = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf-8');
  ok(routes.includes("'/api-memory/audit'"), '路由 /api-memory/audit 已注册');
  ok(routes.includes("'/api-memory/records/merge'"), '路由 /api-memory/records/merge 已注册');
  ok(tools.includes("name: 'memory_audit'"), '工具 memory_audit 已定义');
  ok(tools.includes('ctx.tools.register(memoryAudit)'), '工具已注册进 disposers');
  ok(client.includes('function HealthCard'), '设置页「记忆体检」卡片已接入');
}

// ---------- F 自动合并 + 一键撤销 ----------
console.log('\nF 自动合并与撤销（临时副本）');
{
  const dir3 = mkdtempSync(join(tmpdir(), 'dsh-memory-audit-auto-'));
  const log3 = silentLog();
  try {
    const store = createStore(dir3, log3);
    const same = '用户偏好 pnpm 与 workspace 多包管理，CI 也走同一条命令链';
    store.upsertRecord({ content: same, family: 'work' });
    store.upsertRecord({ content: same, family: 'work' });
    store.upsertRecord({ content: same, family: 'work' });
    const plan = planAutoMerges(store.getRecords(), { threshold: 0.9, maxMerges: 50 });
    ok(plan.length === 1, '自动方案挑出 1 组高置信度近重复', `${plan.length} 组`);
    let dropped = 0;
    for (const g of plan) {
      const r = store.mergeRecords(g.keepId, g.dropIds, { content: g.content, auto: true });
      dropped += r ? r.dropped : 0;
    }
    ok(dropped === 2, '自动合并并入 2 条', `${dropped}`);
    ok(store.getRecords().length === 1, '合并后只剩一条');
    ok(existsSync(join(dir3, 'merge-log.jsonl')), '生成可撤销台账 merge-log.jsonl');
    ok(store.listMerges().length === 1 && store.listMerges()[0].auto === true, '台账标记为自动合并');
    const undone = store.undoMerge();
    ok(undone.restored === 2, '撤销恢复 2 条', `${undone.restored}`);
    ok(store.getRecords().length === 3, '记录数已还原');
    ok(store.listMerges().length === 0, '台账已清空');
  } finally {
    rmSync(dir3, { recursive: true, force: true });
  }
}

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
