// dsh-memory — 远程嵌入源（对齐 dsh-layered-memory 嵌入能力的纯 JS 裁剪版）：
//   关闭（默认，纯关键词）| 远程（OpenAI 兼容 /embeddings 服务）。
// 本地 ONNX 运行时不实现（重依赖子系统，见 README 差异说明）。
// 设计不变量：
//   - 向量缓存落盘 vectors.json（{recordId: {v, at}}），写穿去抖、原子写；
//   - 换源（baseUrl/model/dims 变化）→ 全量向量失效 → 由 host 调度重嵌；
//   - 任何嵌入失败只降级关键词检索 + 告警，绝不阻塞召回/工具/蒸馏；
//   - 连续失败熔断 60s（远程服务不可达时不再每轮白付一次超时）。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const CIRCUIT_OPEN_MS = 60000;
const CIRCUIT_THRESHOLD = 3;
const BATCH_SIZE = 16;

function providerKeyOf(cfg) {
  return `${cfg.baseUrl}|${cfg.model}|${cfg.dimensions}`;
}

export function createEmbeddingService(dataDir, { config, log }) {
  const filePath = join(dataDir, 'vectors.json');
  let meta = { key: '', dimensions: 0 };
  let vectors = new Map(); // recordId -> { v: number[], at: number }
  let saveTimer = null;
  let consecutiveFailures = 0;
  let circuitUntil = 0;
  let lastError = null;
  let reindexing = false;
  let reindexCancel = false;
  let reindexProgress = { done: 0, total: 0, startedAt: 0 };

  // 启动载入
  try {
    const raw = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf-8')) : null;
    if (raw && raw.vectors && typeof raw.vectors === 'object') {
      meta = { key: typeof raw.meta?.key === 'string' ? raw.meta.key : '', dimensions: Number(raw.meta?.dimensions) || 0 };
      for (const [id, entry] of Object.entries(raw.vectors)) {
        if (entry && Array.isArray(entry.v)) vectors.set(id, { v: entry.v, at: Number(entry.at) || 0 });
      }
    }
  } catch { /* 坏文件空表起步 */ }

  function persist() {
    try {
      const obj = {};
      for (const [id, e] of vectors) obj[id] = { v: e.v, at: e.at };
      writeJsonAtomic(filePath, JSON.stringify({ version: 1, meta, vectors: obj }));
    } catch (e) {
      log.warn(`向量缓存写盘失败: ${e.message || e}`);
    }
  }
  function persistDebounced() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 800);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  function cfg() {
    try { return config.effective().embedding || {}; } catch { return {}; }
  }
  function ready() {
    const c = cfg();
    return Boolean(c.enabled && c.baseUrl && c.apiKey && c.model && Number(c.dimensions) > 0);
  }
  /** 当前源与已缓存的向量维度/来源是否一致（不一致=需全量重嵌）。 */
  function sourceChanged() {
    const c = cfg();
    return ready() && meta.key !== providerKeyOf(c);
  }

  /** 单次 /embeddings 调用（批量）；失败抛错由上层降级。 */
  async function callEmbeddings(texts) {
    const c = cfg();
    const url = `${String(c.baseUrl).replace(/\/+$/, '')}/embeddings`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`embedding 超时 ${c.timeoutMs}ms`)), Math.max(1000, Number(c.timeoutMs) || 10000));
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify({ model: c.model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`embedding HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.data) ? data.data : null;
      if (!list || list.length !== texts.length) throw new Error('embedding 响应条数不符');
      const dims = Number(c.dimensions);
      const out = [];
      for (const item of list) {
        const v = Array.isArray(item?.embedding) ? item.embedding.map((x) => Number(x) || 0) : null;
        if (!v || (dims > 0 && v.length !== dims)) throw new Error(`embedding 维度不符（期望 ${dims}，得到 ${v ? v.length : '无'}）`);
        out.push(v);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  function markOk() {
    consecutiveFailures = 0;
    lastError = null;
  }
  function markFail(e) {
    consecutiveFailures += 1;
    lastError = String(e && e.message ? e.message : e).slice(0, 200);
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
      circuitUntil = Date.now() + CIRCUIT_OPEN_MS;
      log.warn(`嵌入连续失败 ${consecutiveFailures} 次，熔断 60s（期间自动降级关键词检索）: ${lastError}`);
      consecutiveFailures = 0;
    }
  }
  function circuitOpen() {
    return Date.now() < circuitUntil;
  }

  function clip(text, maxChars) {
    const s = String(text || '');
    const max = Math.max(100, Number(maxChars) || 5000);
    return s.length > max ? s.slice(0, max) : s;
  }

  return {
    ready,
    sourceChanged,
    status() {
      const c = cfg();
      return {
        enabled: Boolean(c.enabled),
        ready: ready(),
        provider: c.baseUrl && c.model ? `${c.model}` : '',
        baseUrl: c.baseUrl || '',
        dimensions: Number(c.dimensions) || 0,
        indexed: vectors.size,
        sourceChanged: sourceChanged(),
        reindexing,
        reindexProgress,
        circuitOpen: circuitOpen(),
        lastError,
      };
    },
    getVector(id) { return vectors.get(id)?.v || null; },
    /** 单条查询向量；未就绪/熔断/失败返回 null（调用方降级关键词）。 */
    async embedQuery(text) {
      if (!ready() || circuitOpen()) return null;
      try {
        const [v] = await callEmbeddings([clip(text, cfg().maxInputChars)]);
        markOk();
        return v;
      } catch (e) {
        markFail(e);
        return null;
      }
    },
    /**
     * 差量重嵌：records 为全量 L1 快照（{id, content, updatedAt}），缺/旧的补嵌。
     * 返回 {written, failed}；failed>0 时不写 meta（下次继续补齐）。
     */
    async ensureIndexed(records) {
      if (!ready()) return { written: 0, failed: 0, skipped: 'not-ready' };
      const c = cfg();
      if (sourceChanged()) {
        vectors.clear();
        meta = { key: providerKeyOf(c), dimensions: Number(c.dimensions) };
        persist();
        log.info('嵌入源已切换，旧向量已清空，开始全量重嵌');
      }
      const pending = records.filter((r) => {
        const cached = vectors.get(r.id);
        return !cached || cached.at !== r.updatedAt;
      });
      if (pending.length === 0) return { written: 0, failed: 0 };
      if (reindexing) return { written: 0, failed: 0, skipped: 'busy' };
      reindexing = true;
      reindexCancel = false;
      reindexProgress = { done: 0, total: pending.length, startedAt: Date.now() };
      let written = 0;
      let failed = 0;
      try {
        for (let i = 0; i < pending.length; i += BATCH_SIZE) {
          if (reindexCancel) break;
          const batch = pending.slice(i, i + BATCH_SIZE);
          try {
            const vecs = await callEmbeddings(batch.map((r) => clip(r.content, c.maxInputChars)));
            batch.forEach((r, j) => vectors.set(r.id, { v: vecs[j], at: r.updatedAt }));
            written += batch.length;
            markOk();
          } catch (e) {
            failed += batch.length;
            markFail(e);
            if (circuitOpen()) break; // 熔断：本轮到此为止，下次补齐
          }
          reindexProgress.done = Math.min(reindexProgress.total, written + failed);
          persistDebounced();
        }
        persist();
        if (failed === 0) log.info(`向量重嵌完成: ${written} 条（维度 ${c.dimensions}）`);
        else log.warn(`向量重嵌部分完成: ${written} 成 / ${failed} 败（未达条目下次补齐）`);
      } finally {
        reindexing = false;
        reindexProgress = { done: reindexProgress.done, total: reindexProgress.total, startedAt: reindexProgress.startedAt, endedAt: Date.now() };
      }
      return { written, failed };
    },
    /** 取消在途重嵌（软取消：当前批次完成后停）。 */
    cancelReindex() { reindexCancel = true; },
    /** 清空向量（记录删除/清库联动）。 */
    drop(id) { if (id) vectors.delete(id); else vectors.clear(); persist(); },
    dispose() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      persist();
    },
  };
}
