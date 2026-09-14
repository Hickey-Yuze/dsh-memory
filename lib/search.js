// dsh-memory — 关键词检索：CJK 二元组 + 拉丁词元并集，
// 评分 = 查询词元命中率（子串精确命中加权），排序按 相关度 × max(0.5, 0.5^(距更新天数/半衰期))。
// 纯 JS 实现，零依赖；个人库容量（百~千条）下内存扫描足够快。

const CJK_RE = /[\u2E80-\u2EFF\u3000-\u303F\u31C0-\u31EF\u3200-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]/;
const LATIN_RE = /[a-z0-9_+#.\-]{2,}/g;

/** 把文本切成检索词元：拉丁词 + CJK 连续段的二元组（单字段保留一元）。 */
export function tokenize(text) {
  const tokens = new Set();
  const input = String(text || '').toLowerCase();
  for (const match of input.matchAll(LATIN_RE)) {
    const word = match[0].replace(/^[.\-_]+|[.\-_]+$/g, '');
    if (word.length >= 2) tokens.add(word);
  }
  let run = '';
  for (const ch of input) {
    if (CJK_RE.test(ch)) {
      run += ch;
    } else if (run.length > 0) {
      addCjkRun(tokens, run);
      run = '';
    }
  }
  if (run.length > 0) addCjkRun(tokens, run);
  return tokens;
}

function addCjkRun(tokens, run) {
  if (run.length === 1) {
    tokens.add(run);
    return;
  }
  for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2));
}

/** 查询词元在文档中的命中精度（可 >1：叠加子串整词加权），0~1+。 */
export function scoreTokens(queryTokens, docTokens, docText) {
  if (queryTokens.size === 0) return 0;
  let hit = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) hit += 1;
    else if (docText && docText.toLowerCase().includes(token)) hit += 0.5;
  }
  return hit / queryTokens.size;
}

/** 文档被查询覆盖的比例（文档侧召回），0~1。 */
function coverageOf(queryTokens, docTokens, docText) {
  if (docTokens.size === 0) return 0;
  const lower = docText ? docText.toLowerCase() : '';
  let hit = 0;
  for (const token of docTokens) {
    if (queryTokens.has(token) || (lower && lower.includes(token))) hit += 1;
  }
  return hit / docTokens.size;
}

/** 时效权重：max(0.5, 0.5^(天数/半衰期))；halfLifeDays<=0 恒为 1。 */
export function recencyFactor(updatedAt, now, halfLifeDays) {
  const halfLife = Number(halfLifeDays);
  if (!halfLife || halfLife <= 0) return 1;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 1;
  const days = Math.max(0, (now - updatedAt) / 86400000);
  return Math.max(0.5, Math.pow(0.5, days / halfLife));
}

/**
 * 对候选文档排序。docs: [{text, updatedAt, ...payload}]。
 * 综合分 = sqrt(精度 × 覆盖)：精度防长查询稀释、覆盖防短文档偶然命中。
 * 返回 [{score, factor, item}] 降序，过滤 score < threshold。
 */
export function rankDocs(query, docs, { threshold = 0, decayHalfLifeDays = 0, now = Date.now(), limit = 10 } = {}) {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];
  const scored = [];
  for (const item of docs) {
    const docTokens = item._tokens || (item._tokens = tokenize(item.text));
    const precision = scoreTokens(queryTokens, docTokens, item.text);
    if (precision <= 0) continue;
    const coverage = coverageOf(queryTokens, docTokens, item.text);
    const raw = Math.sqrt(Math.max(0, precision) * Math.max(0, coverage));
    if (raw <= 0) continue;
    const factor = recencyFactor(item.updatedAt, now, decayHalfLifeDays);
    const score = raw * factor;
    if (score < threshold) continue;
    scored.push({ score, factor, item });
  }
  scored.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));
  return scored.slice(0, Math.max(0, limit));
}

// ============ 向量检索 + hybrid RRF 融合（对齐 dsh-layered-memory 三策略） ============

/** 余弦相似度；零向量/维度不齐返回 0。 */
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * 向量单路检索：queryVector 与各文档向量（vectors.get(id)）算余弦，
 * 归一到 0~1（(cos+1)/2），过滤 threshold，按分排序。
 * docs: [{id, text, updatedAt, ...payload}]；vectors: Map<id, number[]>。
 */
export function rankDocsByVector(queryVector, docs, vectors, { threshold = 0, decayHalfLifeDays = 0, now = Date.now(), limit = 10 } = {}) {
  if (!Array.isArray(queryVector) || queryVector.length === 0 || !(vectors instanceof Map)) return [];
  const scored = [];
  for (const item of docs) {
    const vec = vectors.get(item.id);
    if (!vec) continue;
    const cos = cosine(queryVector, vec);
    if (cos <= -1) continue;
    const score = (cos + 1) / 2;
    const factor = recencyFactor(item.updatedAt, now, decayHalfLifeDays);
    const final = score * factor;
    if (final < threshold) continue;
    scored.push({ score: final, raw: score, factor, item });
  }
  scored.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));
  return scored.slice(0, Math.max(0, limit));
}

/**
 * hybrid 双路 RRF 融合（k=60，对齐原版）：keyword 排名 + vector 排名各自产出后按
 * `Σ 1/(k + rank)` 融合，融合前不过滤阈值；融合后按时效加权（乘法软加权 + 地板 0.5）。
 * vectorRoute: {vectors, queryVector}（缺省或未就绪时自动退化为纯关键词路）。
 */
export function rankDocsHybrid(query, docs, { threshold = 0, decayHalfLifeDays = 0, now = Date.now(), limit = 10, rrfK = 60, vectorRoute = null } = {}) {
  const keywordHits = rankDocs(query, docs, { threshold: 0, decayHalfLifeDays: 0, now, limit: docs.length });
  const overFetch = Math.min(docs.length, Math.max(limit * 3, 30));
  const vectorHits = vectorRoute && Array.isArray(vectorRoute.queryVector) && vectorRoute.vectors instanceof Map
    ? rankDocsByVector(vectorRoute.queryVector, docs, vectorRoute.vectors, { threshold: 0, decayHalfLifeDays: 0, now, limit: overFetch })
    : [];
  if (vectorHits.length === 0) {
    // 单路退化：直接走关键词（含阈值语义）
    return keywordHits
      .filter(({ score }) => score >= threshold)
      .map(({ score, item }) => ({ score: score * recencyFactor(item.updatedAt, now, decayHalfLifeDays), item }))
      .filter(({ score }) => score >= threshold || threshold <= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));
  }
  const kwRank = new Map(keywordHits.slice(0, overFetch).map(({ item }, i) => [item.id, i + 1]));
  const vecRank = new Map(vectorHits.map(({ item }, i) => [item.id, i + 1]));
  const ids = new Set([...kwRank.keys(), ...vecRank.keys()]);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const fused = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    let score = 0;
    if (kwRank.has(id)) score += 1 / (rrfK + kwRank.get(id));
    if (vecRank.has(id)) score += 1 / (rrfK + vecRank.get(id));
    fused.push({ score, item });
  }
  // 时效衰减乘法加权（对齐 applyDecayWeight：只轮转相关度相近候选的名次）
  for (const entry of fused) {
    entry.score *= recencyFactor(entry.item.updatedAt, now, decayHalfLifeDays);
  }
  fused.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));
  return fused.slice(0, Math.max(0, limit));
}
