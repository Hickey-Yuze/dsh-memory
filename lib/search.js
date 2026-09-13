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
