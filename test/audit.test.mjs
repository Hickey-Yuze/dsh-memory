// 记忆体检单测：近重复分组（含「已被并入的记录不得中断扫描」回归）/ 跨族隔离 /
// 覆盖率 / 沉睡阈值 / 头部集中 / 长度统计。

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHealth, auditSummary, groupDuplicates, planAutoMerges, buildRecallTest, buildProbeHint, recallTestSummary } from '../lib/audit.js';

const NOW = Date.now();
const days = (n) => NOW - n * 86400000;

function rec(id, content, extra = {}) {
  return { id, content, family: 'work', kind: 'fact', hits: 0, createdAt: days(1), updatedAt: days(1), ...extra };
}

test('近重复分组：保留 hits 最高者，内容取最长的成员', () => {
  const records = [
    rec('m1', '用户偏好使用 pnpm 管理依赖', { hits: 9 }),
    rec('m2', '用户偏好使用 pnpm 管理依赖，并且 CI 里也跑 pnpm test', { hits: 0 }),
    rec('m3', '用户养了一只叫豆豆的猫', { hits: 0 }),
  ];
  const groups = groupDuplicates(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].keepId, 'm1');
  assert.equal(groups[0].size, 2);
  assert.equal(groups[0].mergedHits, 9);
  assert.match(groups[0].suggestedContent, /CI 里也跑/);
});

test('分组回归：被并入的记录不能中断后续扫描（break→continue）', () => {
  const records = [
    rec('a', '用户偏好使用 pnpm 管理依赖', { hits: 5 }),
    rec('b', '用户偏好使用 pnpm 管理依赖，并且 CI 里也跑 pnpm test', { hits: 0 }), // b 会被并入 a
    rec('c', '用户近期在纠结是否搬家，起因是衣服阳台和冰箱', { hits: 4 }),
    rec('d', '用户近期在纠结是否搬家，起因是衣服阳台与冰箱，又嫌贵', { hits: 0 }),
  ];
  const groups = groupDuplicates(records);
  assert.equal(groups.length, 2); // 旧实现遇到已并入的 b 会 break，只找得到 1 组
});

test('跨族不合并：同内容不同族各自独立', () => {
  const records = [
    rec('w', '用户偏好使用 pnpm 管理依赖', { hits: 1, family: 'work' }),
    rec('c', '用户偏好使用 pnpm 管理依赖', { hits: 1, family: 'chat' }),
  ];
  assert.equal(groupDuplicates(records).length, 0);
  assert.equal(groupDuplicates(records, { threshold: 0.1 }).length, 0);
});

test('体检读数：覆盖率 / 沉睡 / 头部集中 / 长度 / 分组计数', () => {
  const records = [
    rec('h1', 'x'.repeat(30), { hits: 25 }),
    rec('h2', 'y'.repeat(500), { hits: 11 }),
    rec('s1', 'z'.repeat(20), { updatedAt: days(40) }),
    rec('s2', 'w'.repeat(20), { updatedAt: days(1) }),
  ];
  const a = auditHealth(records, { sleepDays: 14, headHits: 10, samples: 5, topN: 5 });
  assert.equal(a.total, 4);
  assert.equal(a.coverage.zero, 2);
  assert.equal(a.coverage.hitPct, 50);
  assert.equal(a.sleeping.count, 1); // 只有 40 天那条算沉睡
  assert.equal(a.head.manyHits, 2);
  assert.equal(a.head.top[0].id, 'h1');
  assert.equal(a.length.max, 500);
  assert.equal(a.byKind.fact, 4);
  assert.ok(auditSummary(a).includes('记忆体检'));
});

test('自动合并方案：同族同文才并入、命中多者保留、按预算截断、跨族不合并', () => {
  const rec = (id, content, family = 'work', hits = 0) => ({ id, content, tags: [], family, hits, kind: 'fact', createdAt: 1, updatedAt: 1 });
  const same = '用户偏好 pnpm 与 workspace 多包管理';
  const plan = planAutoMerges([
    rec('a', same, 'work', 5),
    rec('b', same, 'work', 0),
    rec('c', same, 'work', 0),
    rec('d', same, 'chat', 0),
    rec('e', '完全无关的另一条记忆内容', 'work'),
  ]);
  assert.equal(plan.length, 1, '只有一个高置信度组');
  assert.equal(plan[0].keepId, 'a', '命中多的当保留者');
  assert.deepEqual([...plan[0].dropIds].sort(), ['b', 'c']);
  assert.equal(plan[0].content, same);

  const capped = planAutoMerges([
    rec('a', same, 'work', 5), rec('b', same, 'work', 0), rec('c', same, 'work', 0),
  ], { maxMerges: 1 });
  assert.deepEqual(capped[0].dropIds, ['b'], '预算只够并一条时不超支');

  assert.equal(planAutoMerges([rec('a', same, 'work'), rec('b', same, 'chat')]).length, 0, '跨族永不合并');
  assert.equal(planAutoMerges([]).length, 0);
});

test('自动合并：大组放宽阈值（≥4 条的簇也收），小组仍守严门槛', () => {
  const records = [
    rec('m1', '像素办公室的场景渲染要接着优化走路卡顿的问题'),
    rec('m2', '像素办公室场景渲染优化走路卡顿的地方'),
    rec('m3', '优化像素办公室场景渲染的走路卡顿'),
    rec('m4', '像素办公室走路卡顿需要继续优化渲染'),
    rec('m5', '用户偏好用 pnpm'),
    rec('m6', '用户偏好用 pnpm 管理依赖'),
  ];
  const strict = planAutoMerges(records, { threshold: 0.95, largeGroupMinSize: 0 });
  assert.equal(strict.length, 1);
  assert.deepEqual(strict[0].dropIds, ['m5']);

  const loose = planAutoMerges(records, { threshold: 0.95, largeGroupMinSize: 4, largeGroupThreshold: 0.5 });
  assert.equal(loose.length, 2);
  const big = loose.find((p) => p.keepId === 'm1');
  assert.deepEqual(big.dropIds, ['m2', 'm3', 'm4']);
  assert.match(big.content, /接着优化走路卡顿/);
});

test('分组候选边回归：只取最稀有的词元会漏掉整簇近重复', () => {
  const records = [rec('a', '甲乙丙丁戊己庚辛'), rec('b', '甲乙丙丁戊己庚'), rec('c', '甲乙丙丁戊己')];
  const groups = groupDuplicates(records, { threshold: 0.5 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].size, 3);
});

// ============ 记忆测试卡（召回质量抽检） ============

test('记忆测试卡：只给一半提示，目标排第 1 记命中', () => {
  const records = [
    { id: 'm1', content: '用户偏好使用 pnpm 管理依赖，CI 也跑 pnpm test', family: 'work', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
    { id: 'm2', content: '用户养了一只叫豆豆的猫，喜欢在阳台晒太阳', family: 'work', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
  ];
  const t = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(t.total, 2);
  assert.equal(t.poolSize, 2);
  assert.equal(t.hit, 2, '两条都该被召回且排第一');
  assert.equal(t.half, 0);
  assert.equal(t.miss, 0);
  assert.equal(t.score, 100);
  assert.ok(t.items.every((i) => i.rank === 1));
  assert.ok(t.items.every((i) => i.hint.length < i.answer.length), '提示比答案短');
  assert.ok(t.items.every((i) => i.answer.startsWith(i.hint)), '提示是答案的前半段');
});

test('记忆测试卡：只考够旧的记忆，太新的不进考题池', () => {
  const records = [
    { id: 'old', content: '这条是很久以前写下的旧记忆内容', family: 'chat', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
    { id: 'new', content: '这条是刚刚写下的新记忆内容', family: 'chat', kind: 'fact', hits: 0, createdAt: days(1), updatedAt: days(1) },
  ];
  const t = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(t.poolSize, 1);
  assert.equal(t.total, 1);
  assert.equal(t.items[0].id, 'old');
});

test('记忆测试卡：跨族隔离，只测指定族', () => {
  const records = [
    { id: 'c1', content: '个人画像里的一条旧记忆内容', family: 'chat', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
    { id: 'w1', content: '工作准则里的一条旧记忆内容', family: 'work', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
  ];
  const chat = buildRecallTest(records, { family: 'chat', minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(chat.total, 1);
  assert.equal(chat.items[0].id, 'c1');
  const all = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(all.total, 2);
});

test('记忆测试卡：提示不足导致召回不到 = 记错，得分会掉', () => {
  // 目标内容与库里其他条完全同形，只靠半段提示无法区分 → 必然排不到第一
  const records = [
    { id: 'a', content: '像素办公室场景渲染需要继续优化走路卡顿', family: 'work', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
    { id: 'b', content: '像素办公室场景渲染需要继续优化走路卡顿', family: 'work', kind: 'fact', hits: 0, createdAt: days(200), updatedAt: days(200) },
  ];
  const t = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, topK: 1, seed: 42 });
  assert.equal(t.total, 2);
  assert.ok(t.score <= 100);
  assert.ok(t.hit + t.half + t.miss === 2, '每条都有判定');
  assert.ok(t.items.every((i) => ['hit', 'half', 'miss'].includes(i.verdict)));
});

test('记忆测试卡：池空时给出可读摘要而不是崩', () => {
  const t = buildRecallTest([], { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(t.total, 0);
  assert.equal(t.score, 0);
  assert.ok(recallTestSummary(t).includes('没有够旧'));
});

test('探针提示：取正文前半段并截断到上限', () => {
  assert.equal(buildProbeHint('abcdefghij', { hintRatio: 0.5, maxChars: 100 }), 'abcde');
  assert.equal(buildProbeHint('abcdefghij', { hintRatio: 0.5, maxChars: 3 }), 'abc');
  assert.equal(buildProbeHint('', {}), '');
  assert.equal(buildProbeHint('   ', {}), '');
});

test('记忆测试卡：同一 seed 取样稳定，不因刷新换题', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({
    id: `m${i}`, content: `第 ${i} 条很长的旧记忆内容用来测试抽样的稳定性`, family: 'work', kind: 'fact', hits: 0, createdAt: days(200 + i), updatedAt: days(200 + i),
  }));
  const a = buildRecallTest(records, { minAgeDays: 90, sampleSize: 5, seed: 7 });
  const b = buildRecallTest(records, { minAgeDays: 90, sampleSize: 5, seed: 7 });
  assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
});

test('记忆测试卡：库里没够老的记忆时池龄自动回落（不空跑）', () => {
  // 生产库实测：最老的一条也只有 39 天，固定 90 天下限会让测试卡永远空池
  const records = [
    { id: 'a', content: '这条旧记忆只写了三十九天前的日期', family: 'chat', kind: 'fact', hits: 0, createdAt: days(39), updatedAt: days(39) },
    { id: 'b', content: '另一条更近一点只有十几天前写的记忆', family: 'chat', kind: 'fact', hits: 0, createdAt: days(12), updatedAt: days(12) },
  ];
  const t = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(t.total, 1, '回落后至少有 1 条可测');
  assert.equal(t.items[0].id, 'a');
  assert.equal(t.ageFellBack, true);
  assert.equal(t.requestedMinAgeDays, 90);
  assert.equal(t.minAgeDays, 39, '池龄回落到库里实际最老的龄');
  assert.equal(t.oldestAgeDays, 39);
  assert.ok(recallTestSummary(t).includes('回落到 39 天'), '摘要写明回落原因');
});

test('记忆测试卡：库够老时不回落（口径保持 90 天）', () => {
  const records = [
    { id: 'a', content: '这条是一百九十天前写下的旧记忆内容', family: 'chat', kind: 'fact', hits: 0, createdAt: days(190), updatedAt: days(190) },
    { id: 'b', content: '这条是三天前刚写下的新记忆内容', family: 'chat', kind: 'fact', hits: 0, createdAt: days(3), updatedAt: days(3) },
  ];
  const t = buildRecallTest(records, { minAgeDays: 90, sampleSize: 10, seed: 42 });
  assert.equal(t.ageFellBack, false);
  assert.equal(t.minAgeDays, 90);
  assert.equal(t.total, 1);
  assert.equal(t.items[0].id, 'a');
});
