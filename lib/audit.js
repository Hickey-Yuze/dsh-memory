// dsh-memory — 记忆体检：只读统计，不写盘、不改记忆。
// 回答四个问题：有多少记忆从没被召回过、是不是少数几条霸榜、哪些是同一条的多个版本、哪几条真睡了。
// 合并方案只产出「建议」，必须由调用方（设置页按钮 / 自动合并开关 / CLI --apply）确认后才交给 store.mergeRecords。

import { containmentOf, tokenize } from './search.js';

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
