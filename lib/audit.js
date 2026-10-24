// dsh-memory — 记忆体检：只读统计，不写盘、不改记忆。
// 回答四个问题：有多少记忆从没被召回过、是不是少数几条霸榜、哪些是同一条的多个版本、哪几条真睡了。
// 合并方案只产出「建议」，必须由调用方（设置页按钮 / 自动合并开关 / CLI --apply）确认后才交给 store.mergeRecords。
// 另外回答第五个问题：召回准不准 —— 见 buildRecallTest（记忆测试卡）。

import { containmentOf, tokenize } from './search.js';
import { rankDocs, collapseNearDuplicates, applyExposureBalance } from './search.js';

export const AUTO_MERGE_THRESHOLD = 0.9;
/** 大组放宽：一条簇里挤了这么多条，即使两两相似度只到 0.72 也几乎肯定是重复写（用户 2026-10-15 拍板）。 */
export const LARGE_GROUP_MIN_SIZE = 4;
export const LARGE_GROUP_THRESHOLD = 0.72; // 自动合并门槛：比手工面板的 0.72 严得多，宁可漏合

export const AUDIT_DEFAULTS = {
  dupThreshold: 0.72, // 词元包含度达到该值视为同一条的多个版本
  sleepDays: 14, // 超过这些天且零召回＝沉睡
  headHits: 10, // 命中次数超过它＝头部垄断
  topN: 5,
  maxGroups: 50,
  samples: 5,
};

const DAY = 86400000;

function daysOf(r, now) {
  const t = r.updatedAt || r.createdAt || now;
  return Math.max(0, Math.round((now - t) / DAY));
}

function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function brief(r, now) {
  return {
    id: r.id,
    family: r.family,
    kind: r.kind || 'fact',
    hits: r.hits || 0,
    days: daysOf(r, now),
    content: String(r.content || '').slice(0, 120),
  };
}

/**
 * 近重复分组：按 (hits 降序, 内容长度降序, updatedAt 降序) 选保留者，
 * 同族内与保留者包含度达标者并入该组（只跟保留者比，不做传递闭包）。
 */
export function groupDuplicates(records, { threshold = AUDIT_DEFAULTS.dupThreshold, maxGroups = AUDIT_DEFAULTS.maxGroups } = {}) {
  const items = records.map((r) => ({ r, tokens: tokenize(r.content || '') }));
  const inv = new Map();
  items.forEach((it, i) => {
    for (const t of it.tokens) {
      let list = inv.get(t);
      if (!list) inv.set(t, (list = []));
      list.push(i);
    }
  });
  const freq = (t) => (inv.get(t) || []).length;
  const near = new Map(); // i → Set<j>：只跟稀有词元共现的候选比，避免 O(n²) 全量比对
  // 双向建边：保留者是按 hits/长度选的，可能不是「词元更稀有」的那一方，
  // 单向建边会让它找不到本该并入的成员（近重复组被漏报）。
  const link = (i, j) => {
    if (i === j) return;
    let a = near.get(i);
    if (!a) near.set(i, (a = new Set()));
    a.add(j);
  };
  items.forEach((it, i) => {
    // 取「最有区分度且至少被两篇共享」的 3 个词元建候选边。
    // 只取最稀有的会是每篇独有的词（df=1），反而建不出任何边，近重复直接漏报。
    const shared = [...it.tokens].filter((t) => freq(t) > 1).sort((a, b) => freq(a) - freq(b)).slice(0, 3);
    const rare = shared.length > 0 ? shared : [...it.tokens].sort((a, b) => freq(a) - freq(b)).slice(0, 3);
    for (const t of rare) {
      for (const j of inv.get(t) || []) {
        link(i, j);
        link(j, i);
      }
    }
  });

  const now = Date.now();
  const order = items
    .map((_, i) => i)
    .sort((a, b) => (items[b].r.hits || 0) - (items[a].r.hits || 0)
      || String(items[b].r.content || '').length - String(items[a].r.content || '').length
      || (items[b].r.updatedAt || 0) - (items[a].r.updatedAt || 0));
  const taken = new Set();
  const groups = [];
  for (const i of order) {
    if (taken.has(i)) continue;
    if (groups.length >= maxGroups) break;
    const keeper = items[i];
    const members = [i];
    taken.add(i);
    for (const j of near.get(i) || []) {
      if (taken.has(j)) continue;
      if (items[j].r.family !== keeper.r.family) continue;
      if (containmentOf(keeper.tokens, items[j].tokens) < threshold) continue;
      members.push(j);
      taken.add(j);
    }
    if (members.length < 2) continue;
    const rows = members.map((idx) => items[idx].r);
    const longest = rows.reduce((best, r) => (String(r.content || '').length > String(best.content || '').length ? r : best), rows[0]);
    groups.push({
      keepId: keeper.r.id,
      family: keeper.r.family,
      size: rows.length,
      mergedHits: rows.reduce((n, r) => n + (r.hits || 0), 0),
      suggestedContent: String(longest.content || ''),
      members: rows.map((r) => brief(r, now)),
    });
  }
  groups.sort((a, b) => b.size - a.size || b.mergedHits - a.mergedHits);
  return groups;
}

/** 体检读数：覆盖率 / 头部集中 / 沉睡 / 近重复 / 长度分布。 */
export function auditHealth(records, {
  threshold = AUDIT_DEFAULTS.dupThreshold,
  sleepDays = AUDIT_DEFAULTS.sleepDays,
  headHits = AUDIT_DEFAULTS.headHits,
  topN = AUDIT_DEFAULTS.topN,
  samples = AUDIT_DEFAULTS.samples,
  maxGroups = AUDIT_DEFAULTS.maxGroups,
  now = Date.now(),
} = {}) {
  const total = records.length;
  const byKind = { fact: 0, opinion: 0, commitment: 0 };
  const byFamily = {};
  let zero = 0;
  let heads = 0;
  const sleeping = [];
  const ranked = [];
  for (const r of records) {
    const kind = r.kind === 'opinion' || r.kind === 'commitment' ? r.kind : 'fact';
    byKind[kind] += 1;
    byFamily[r.family || 'chat'] = (byFamily[r.family || 'chat'] || 0) + 1;
    const hits = r.hits || 0;
    if (hits === 0) {
      zero += 1;
      if (daysOf(r, now) >= sleepDays) sleeping.push(brief(r, now));
    }
    if (hits >= headHits) heads += 1;
    ranked.push({ r, hits });
  }
  ranked.sort((a, b) => b.hits - a.hits);
  sleeping.sort((a, b) => b.days - a.days);

  const lengths = records.map((r) => String(r.content || '').length).sort((a, b) => a - b);
  const groups = groupDuplicates(records, { threshold, maxGroups });

  return {
    generatedAt: now,
    total,
    byKind,
    byFamily,
    coverage: {
      recalled: total - zero,
      zero,
      zeroPct: total === 0 ? 0 : Number(((zero / total) * 100).toFixed(1)),
      hitPct: total === 0 ? 0 : Number((((total - zero) / total) * 100).toFixed(1)),
    },
    head: {
      manyHits: heads,
      top: ranked.slice(0, topN).map(({ r }) => brief(r, now)),
    },
    sleeping: {
      count: sleeping.length,
      sleepDays,
      samples: sleeping.slice(0, samples),
    },
    duplicates: {
      groupCount: groups.length,
      recordCount: groups.reduce((n, g) => n + g.size, 0),
      mergable: groups.reduce((n, g) => n + g.size - 1, 0),
      groups,
    },
    length: {
      median: median(lengths),
      p90: lengths.length === 0 ? 0 : lengths[Math.floor(lengths.length * 0.9)],
      max: lengths.length === 0 ? 0 : lengths[lengths.length - 1],
      over400: lengths.filter((n) => n > 400).length,
    },
  };
}

/**
 * 自动合并方案：只挑「高置信度」近重复（默认包含度 ≥ 0.9，比手工面板的 0.72 严），
 * 并按 maxMerges 限制单轮并入总量（超出的大组只并入前几条，保留者仍是最优的那条）。
 * 返回 [{ keepId, dropIds, content }]，交给 store.mergeRecords 执行（可撤销）。
 */
export function planAutoMerges(records, {
  threshold = AUTO_MERGE_THRESHOLD,
  maxMerges = 50,
  maxGroups = 200,
  largeGroupMinSize = LARGE_GROUP_MIN_SIZE,
  largeGroupThreshold = LARGE_GROUP_THRESHOLD,
} = {}) {
  const out = [];
  const claimed = new Set();
  let budget = Math.max(1, maxMerges);

  const take = (groups) => {
    for (const g of groups) {
      if (budget <= 0) return;
      const dropIds = g.members
        .filter((m) => m.id !== g.keepId && !claimed.has(m.id))
        .map((m) => m.id)
        .slice(0, budget);
      if (dropIds.length === 0) continue;
      out.push({ keepId: g.keepId, dropIds, content: g.suggestedContent });
      for (const id of dropIds) claimed.add(id);
      budget -= dropIds.length;
    }
  };

  // 第一遍：严格阈值——同一件事被写了好几遍
  take(groupDuplicates(records, { threshold, maxGroups }));
  // 第二遍：大组放宽——≥largeGroupMinSize 条挤成一簇，即使两两只到 0.72 也基本可断定是重复写
  if (largeGroupMinSize > 0 && budget > 0) {
    const rest = records.filter((r) => !claimed.has(r.id));
    const big = groupDuplicates(rest, { threshold: largeGroupThreshold, maxGroups })
      .filter((g) => g.members.length >= largeGroupMinSize);
    take(big);
  }
  return out;
}

/** 体检摘要文本（供 memory_audit 工具与日志用）。 */
export function auditSummary(a) {
  const lines = [
    `记忆体检：${a.total} 条｜覆盖 ${a.coverage.hitPct}%（未召回 ${a.coverage.zero} 条）｜头部 ≥${AUDIT_DEFAULTS.headHits} 次 ${a.head.manyHits} 条｜沉睡 ${a.sleeping.count} 条｜近重复 ${a.duplicates.groupCount} 组（可合并 ${a.duplicates.mergable} 条）`,
    `类型 fact ${a.byKind.fact} / opinion ${a.byKind.opinion} / commitment ${a.byKind.commitment}｜族 ${Object.entries(a.byFamily).map(([k, v]) => `${k} ${v}`).join(' / ')}｜长度中位 ${a.length.median}·p90 ${a.length.p90}`,
  ];
  return lines.join('\n');
}

/** 归一化场景标题：去掉空白与标点，用来识别「同一个主题被 L2 建了两遍」。 */
function normSceneTitle(t) {
  return String(t || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 60);
}

/**
 * 可安全合并的场景：同族内归一化标题完全相同（整对同名场景＝同一主题重复建档）。
 * 只按标题判，不按正文相似度——场景正文是各自批次的摘要，相似度低不代表主题不同，反之亦然。
 */
export function planSceneMerges(scenes, { maxGroups = 50 } = {}) {
  const byKey = new Map();
  for (const s of scenes || []) {
    const key = normSceneTitle(s.title);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  }
  const groups = [];
  for (const [, list] of byKey) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => (b.recordIds || []).length - (a.recordIds || []).length
      || String(b.content || '').length - String(a.content || '').length);
    groups.push({
      keepId: sorted[0].id,
      dropIds: sorted.slice(1).map((s) => s.id),
      title: sorted[0].title, family: sorted[0].family, size: sorted.length,
    });
    if (groups.length >= maxGroups) break;
  }
  return groups;
}

// ============ 记忆测试卡（召回质量抽检） ============

/**
 * 记忆测试卡：体检缺的第五个维度 —— 召回准不准。
 *
 * 现有体检全是结构指标（覆盖率/近重复/沉睡），只能说明「有多少条被召回过」，
 * 说不清「该被召回的那条，召回时排第几、排进来没有」。
 * 做法照搬硅基拍档「记忆测试卡」的动作（抽旧记忆 → 只提示一半 → 回忆 → 对答案 → 计分），
 * 但把「谁来回忆」换成机器：
 *   1. 抽 N 条够旧、且不算太冷的记忆当考题；
 *   2. 每条只给「一半提示」——取正文的前半段当探针查询词（模拟"只记得片段"时的召回）；
 *   3. 用生产召回的真实排序链路（rankDocs → 近重复收敛 → 曝光均衡）跑一遍；
 *   4. 计分：目标排第 1 = 命中；进了前 K = 半对；没进前 K = 记错。
 *
 * 只读：全程不写盘、不改 hits、不动记忆。
 */
export const RECALL_TEST_DEFAULTS = {
  sampleSize: 10,      // 每张测试卡抽多少条考题
  minAgeDays: 30,      // 「旧记忆」下限：够旧才测得出召回质量
  maxAgeDays: 0,       // 0 = 不限上限
  topK: 3,             // 前 K 名算「半对」；第 1 名算「命中」
  hintRatio: 0.5,      // 提示比例：只给正文的前半段
  maxCharsPerProbe: 40, // 探针最大字符数
  seed: 0,             // 随机种子（0 = 按时间戳取样，同一时刻多次调用结果稳定）
};

/** 稳定的伪随机：同一 seed 每次取样结果一致，避免面板每次刷新换一批题。 */
function pickRandom(list, n, seed) {
  if (list.length <= n) return list.slice();
  const arr = list.slice();
  let s = (Number(seed) || 1) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, n);
}

/** 造「只提示一半」的探针：取正文前半段，截到 maxChars。 */
export function buildProbeHint(content, { hintRatio = RECALL_TEST_DEFAULTS.hintRatio, maxChars = RECALL_TEST_DEFAULTS.maxCharsPerProbe } = {}) {
  const text = String(content || '').trim();
  if (!text) return '';
  const cut = Math.max(4, Math.floor(text.length * Math.min(1, Math.max(0.1, hintRatio))));
  return text.slice(0, Math.min(cut, maxChars));
}

/**
 * 生成一张记忆测试卡。
 * records: 全量记录；family: 只测某族（'chat'/'work'）或不筛。
 *
 * 池龄下限用「相对」口径兜底：minAgeDays 之上，再要求「不是最近才写的」。
 * 绝对天数在新建的库上会直接卡死（实测生产库最老的记录也只有 39 天，
 * 固定 90 天会让测试卡永远空跑），所以真正的门槛是
 * 「比库里最老的那条还新 0 天，但至少 minAgeDays 天前写的」——
 * 库里没到 minAgeDays 的记录时，池龄下限自动回落到库里实际可用的最大龄。
 *
 * 返回 { items, score, ... }，items 每条含 探针 / 正确答案 / 实际排位 / 判定 / 召回列表。
 */
export function buildRecallTest(records, {
  family,
  sampleSize = RECALL_TEST_DEFAULTS.sampleSize,
  minAgeDays = RECALL_TEST_DEFAULTS.minAgeDays,
  maxAgeDays = RECALL_TEST_DEFAULTS.maxAgeDays,
  topK = RECALL_TEST_DEFAULTS.topK,
  hintRatio = RECALL_TEST_DEFAULTS.hintRatio,
  maxCharsPerProbe = RECALL_TEST_DEFAULTS.maxCharsPerProbe,
  scoreThreshold = 0.3,
  decayHalfLifeDays = 30,
  now = Date.now(),
  seed = RECALL_TEST_DEFAULTS.seed,
} = {}) {
  const all = records || [];
  const inFamily = all.filter((r) => !family || (r.family || 'chat') === family);
  // 池龄下限回落：库里没有一条够老时，按库里实际最老的龄取，避免测试卡永远空跑。
  const agesAll = inFamily.map((r) => daysOf(r, now));
  const oldest = agesAll.length > 0 ? Math.max(...agesAll) : 0;
  const effectiveMinAge = oldest > 0 ? Math.min(minAgeDays, oldest) : minAgeDays;
  const pool = inFamily.filter((r) => {
    const text = String(r.content || '').trim();
    if (text.length < 8) return false; // 太短没法一半提示
    const age = daysOf(r, now);
    if (age < effectiveMinAge) return false;
    if (maxAgeDays > 0 && age > maxAgeDays) return false;
    return true;
  });
  const sampled = pickRandom(pool, Math.max(1, sampleSize), seed || Math.floor(now / 60000));

  // 考题集合就是全量记录（召回时要在整个库里竞争名额，不能只跟考题比）
  const corpus = all.map((r) => ({ ...r, text: r.content }));
  const items = [];
  let hit = 0; let half = 0; let miss = 0;

  for (const r of sampled) {
    const hint = buildProbeHint(r.content, { hintRatio, maxChars: maxCharsPerProbe });
    if (!hint) continue;
    const ranked = applyExposureBalance(collapseNearDuplicates(rankDocs(hint, corpus, {
      threshold: scoreThreshold,
      decayHalfLifeDays,
      limit: Math.max(topK * 3, 10),
      now,
    })));
    const pos = ranked.findIndex(({ item }) => item.id === r.id);
    const rank = pos < 0 ? 0 : pos + 1;
    let verdict = 'miss';
    if (rank === 1) { verdict = 'hit'; hit += 1; }
    else if (rank > 1 && rank <= topK) { verdict = 'half'; half += 1; }
    else { miss += 1; }
    items.push({
      id: r.id,
      family: r.family || 'chat',
      kind: r.kind || 'fact',
      ageDays: daysOf(r, now),
      hits: r.hits || 0,
      hint,                       // 只提示的一半
      answer: String(r.content || ''), // 正确答案（核对用）
      rank,                       // 实际排位；0 = 没进候选
      verdict,                    // hit / half / miss
      candidates: ranked.slice(0, topK).map(({ item, score }) => ({
        id: item.id,
        score: Number((score || 0).toFixed(3)),
        excerpt: String(item.content || '').slice(0, 80),
      })),
    });
  }

  const total = items.length;
  const score = total === 0 ? 0 : Number((((hit + half * 0.5) / total) * 100).toFixed(1));
  return {
    generatedAt: now,
    family: family || null,
    total,
    poolSize: pool.length,
    hit,
    half,
    miss,
    score,                       // 0~100：命中记 1 分、半对记 0.5 分
    hitPct: total === 0 ? 0 : Number(((hit / total) * 100).toFixed(1)),
    topK,
    minAgeDays: effectiveMinAge,
    requestedMinAgeDays: minAgeDays,
    ageFellBack: effectiveMinAge < minAgeDays,
    oldestAgeDays: oldest,
    items,
  };
}

/** 测试卡摘要文本（供 memory_audit 工具与日志用）。 */
export function recallTestSummary(t) {
  if (!t || t.total === 0) return '记忆测试卡：没有够旧的记忆可测（放宽 minAgeDays 再试）';
  const fb = t.ageFellBack
    ? `（库里最老的一条才 ${t.oldestAgeDays} 天，池龄已从 ${t.requestedMinAgeDays} 天回落到 ${t.minAgeDays} 天）`
    : '';
  return `记忆测试卡：抽 ${t.total} 条（池 ${t.poolSize} 条 / 池龄 ≥${t.minAgeDays} 天${fb}）｜命中 ${t.hit} · 半对 ${t.half} · 记错 ${t.miss}｜得分 ${t.score}/100（前 ${t.topK} 名算半对）`;
}
