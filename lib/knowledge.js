// dsh-memory — 知识库索引：扫描本地目录，把 md/txt 等文本文件按段落分块，
// 作为可检索资产并入召回。检索策略：关键词（默认，阈值语义）；配置嵌入源且向量
// 就绪时，最高余弦过语义门槛才升级 hybrid RRF——防"无关提问也硬凑 Top-N"的盲目
// 注入（片段向量由 host 调度经 embedding.ensureIndexed 差量重嵌，updatedAt=文件
// mtime 判旧——文件一改自动失效重嵌，无需手动失效）。
// 增量：按 mtime+size 判断文件变化，只重读变过的；消失的文件从索引剔除。
// 定位：记忆系统只记对话，知识库是"文件内容"层——把"位置指针"升级成"内容可检索"。
// 索引落盘 dataDir/kb-index.json；任何异常不抛出调用方（扫描失败保留旧索引）。

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { rankDocs, rankDocsHybrid, cosine } from './search.js';
import { defuseTemplateVars } from './prompts.js';
import { writeJsonAtomic } from './log.js';

/** 扫描时跳过的目录名（点开头目录一律跳过，如 .obsidian/.git）。 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.venv', '__pycache__', 'dist', 'build']);
const MIN_CHUNK_CHARS = 40; // 碎片段（<40 字符）不值得索引
const SEMANTIC_GATE_DEFAULT = 0.5; // bge 系模型：无关中文对典型 cos≈0.3~0.45，相关 ≥0.55

export function createKnowledgeIndex(dataDir, { config, log, embedding }) {
  const indexFile = join(dataDir, 'kb-index.json');
  let state = { version: 1, files: {}, lastScanAt: 0, lastError: null };
  try {
    if (existsSync(indexFile)) {
      const raw = JSON.parse(readFileSync(indexFile, 'utf-8'));
      if (raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object') {
        state = { version: 1, files: raw.files, lastScanAt: raw.lastScanAt || 0, lastError: null };
      }
    }
  } catch (e) {
    log.warn(`知识库索引文件损坏，重建: ${e.message || e}`);
    state = { version: 1, files: {}, lastScanAt: 0, lastError: null };
  }
  state.files = sanitizeFiles(state.files);

  function sanitizeFiles(files) {
    const out = {};
    for (const [abs, entry] of Object.entries(files || {})) {
      if (!abs || !entry || !Array.isArray(entry.chunks)) continue;
      const chunks = entry.chunks.filter((c) => c && typeof c.id === 'string' && typeof c.text === 'string' && typeof c.relPath === 'string');
      if (chunks.length > 0) out[abs] = { mtimeMs: entry.mtimeMs || 0, size: entry.size || 0, chunks, indexedAt: entry.indexedAt || 0 };
    }
    return out;
  }

  function chunkText(text, chunkChars) {
    const target = Math.max(200, Number(chunkChars) || 1200);
    const chunks = [];
    let cur = '';
    for (const para of String(text).split(/\n{2,}/)) {
      let piece = para.trim();
      if (!piece) continue;
      while (piece.length > target * 1.5) { // 单段超长硬切
        chunks.push(piece.slice(0, target));
        piece = piece.slice(target);
      }
      if (!piece) continue;
      if (cur && cur.length + piece.length + 2 > target) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
    if (cur) {
      // 短尾块并回上一块（只丢真正的孤儿碎片段）
      if (chunks.length > 0 && cur.trim().length < MIN_CHUNK_CHARS) chunks[chunks.length - 1] += `\n\n${cur}`;
      else if (cur.trim().length >= MIN_CHUNK_CHARS) chunks.push(cur);
    }
    return chunks.filter((c) => c.trim().length >= MIN_CHUNK_CHARS);
  }

  function* walk(root, exts, maxFiles) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = join(root, entry.name);
      if (entry.isDirectory()) {
        yield* walk(abs, exts, maxFiles);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!exts.has(ext)) continue;
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        yield { abs, size: st.size, mtimeMs: st.mtimeMs };
        if (maxFiles > 0 && countFiles() + countSeen() >= maxFiles) return;
      }
    }
  }

  let seenCount = 0;
  const countSeen = () => seenCount;
  const countFiles = () => Object.keys(state.files).length;
  const chunkCount = () => Object.values(state.files).reduce((sum, f) => sum + f.chunks.length, 0);

  /**
   * 增量扫描：配置的目录 → 索引新增/变化的文件 → 剔除消失的文件。
   * @returns {{indexed:number, dropped:number, files:number, chunks:number, skipped:boolean}}
   */
  function scan() {
    const cfg = config.effective().knowledge || {};
    if (!cfg.enabled) return { indexed: 0, dropped: 0, files: countFiles(), chunks: chunkCount(), skipped: true };
    const roots = Array.isArray(cfg.paths) ? cfg.paths : [];
    if (roots.length === 0) return { indexed: 0, dropped: 0, files: countFiles(), chunks: chunkCount(), skipped: true };
    const exts = new Set((Array.isArray(cfg.extensions) && cfg.extensions.length > 0 ? cfg.extensions : ['.md', '.txt']).map((e) => e.toLowerCase()));
    const maxFileBytes = Math.max(1024, Number(cfg.maxFileBytes) || 2097152);
    const maxFileChars = Math.max(1000, Number(cfg.maxFileChars) || 60000);
    const maxFiles = Math.max(1, Number(cfg.maxFiles) || 500);

    const seen = new Set();
    let indexed = 0;
    seenCount = 0;
    try {
      for (const root of roots) {
        let rootStat;
        try {
          rootStat = statSync(root);
        } catch {
          log.warn(`知识库目录不可访问，跳过: ${root}`);
          continue;
        }
        const single = rootStat.isFile();
        const iterable = single
          ? (function* () { const st = rootStat; const ext = extname(root).toLowerCase(); if (exts.has(ext)) yield { abs: root, size: st.size, mtimeMs: st.mtimeMs }; })()
          : walk(root, exts, maxFiles);
        for (const { abs, size, mtimeMs } of iterable) {
          seen.add(abs);
          seenCount = seen.size;
          if (size > maxFileBytes) continue;
          const prev = state.files[abs];
          if (prev && prev.mtimeMs === mtimeMs && prev.size === size) continue;
          try {
            const text = readFileSync(abs, 'utf-8').slice(0, maxFileChars);
            const rel = single ? abs.split(/[\\/]/).pop() : relative(root, abs).split('\\').join('/');
            const chunks = chunkText(text, cfg.chunkChars).map((c, i) => ({
              id: `kb:${abs}#${i}`,
              text: c,
              updatedAt: mtimeMs,
              relPath: rel,
              absPath: abs,
            }));
            if (chunks.length > 0) {
              state.files[abs] = { mtimeMs, size, chunks, indexedAt: Date.now() };
              indexed++;
            } else if (prev) {
              delete state.files[abs]; // 内容改成只剩碎片：当作移除
            }
          } catch (e) {
            log.warn(`知识库文件读取失败（跳过）: ${abs}: ${e.message || e}`);
          }
        }
      }
      let dropped = 0;
      for (const abs of Object.keys(state.files)) {
        if (!seen.has(abs)) {
          delete state.files[abs];
          dropped++;
        }
      }
      state.lastScanAt = Date.now();
      state.lastError = null;
      docsCache = null; // 索引已变，检索视图失效重建
      if (indexed > 0 || dropped > 0) {
        writeJsonAtomic(indexFile, JSON.stringify(state));
        log.info(`知识库索引更新: 新索引 ${indexed} 个文件、移除 ${dropped} 个（共 ${countFiles()} 文件 / ${chunkCount()} 片段）`);
      }
      return { indexed, dropped, files: countFiles(), chunks: chunkCount(), skipped: false };
    } catch (e) {
      state.lastError = String(e.message || e);
      docsCache = null; // 扫描中途失败可能有部分变更，检索视图同样重建
      log.warn(`知识库扫描失败（保留旧索引）: ${e.message || e}`);
      return { indexed: 0, dropped: 0, files: countFiles(), chunks: chunkCount(), skipped: false };
    }
  }

  let docsCache = null; // 片段包装层缓存：rankDocs 的 _tokens 落在包装对象上，不混入索引文件

  /** 所有片段的检索视图（scan 后失效重建）。 */
  function allDocs() {
    if (!docsCache) {
      const docs = [];
      for (const entry of Object.values(state.files)) {
        for (const chunk of entry.chunks) {
          docs.push({ id: chunk.id, text: chunk.text, updatedAt: chunk.updatedAt, relPath: chunk.relPath, absPath: chunk.absPath });
        }
      }
      docsCache = docs;
    }
    return docsCache;
  }

  /** 片段检索：嵌入源就绪时 hybrid RRF（关键词+向量），否则纯关键词。 */
  async function search(query, { limit = 3, threshold = 0.45, decayHalfLifeDays = 0 } = {}) {
    const docs = allDocs();
    if (docs.length === 0) return [];
    let queryVector = null;
    if (embedding && typeof embedding.ready === 'function' && embedding.ready() && !embedding.sourceChanged()) {
      try {
        queryVector = await embedding.embedQuery(query);
      } catch {
        queryVector = null; // 降级关键词
      }
    }
    if (queryVector) {
      // 语义门槛（防盲目注入）：向量路天生"总有 Top-N"，不设门槛则无关提问也会硬凑
      // 片段。片段与查询的最高余弦过门槛才启用 hybrid；不过则退回关键词+阈值语义，
      // 宁可不注入。门槛可调（knowledge.semanticGate）。
      const cfgK = config.effective().knowledge || {};
      const gate = Number.isFinite(Number(cfgK.semanticGate)) && Number(cfgK.semanticGate) > 0
        ? Number(cfgK.semanticGate)
        : SEMANTIC_GATE_DEFAULT;
      const vectors = new Map();
      let bestCos = -1;
      for (const d of docs) {
        const v = embedding.getVector(d.id);
        if (!v) continue;
        vectors.set(d.id, v);
        const c = cosine(queryVector, v);
        if (c > bestCos) bestCos = c;
      }
      if (bestCos >= gate && vectors.size > 0) {
        // 融合排名是无量纲的（RRF），阈值语义由门槛承担；threshold 仅约束关键词单路
        return defuse(rankDocsHybrid(query, docs, { decayHalfLifeDays, limit, vectorRoute: { queryVector, vectors } }));
      }
    }
    return defuse(rankDocs(query, docs, { threshold, decayHalfLifeDays, limit }));
  }

  /** 片段文本中性化：源文件（提示词模板等）常含 {{...}}，原样注入会炸 prompt 插值器。 */
  function defuse(hits) {
    return hits.map((h) => (h && h.item ? { ...h, item: { ...h.item, text: defuseTemplateVars(h.item.text) } } : h));
  }

  /** 片段向量差量重嵌的输入视图（embedding.ensureIndexed 契约：{id, content, updatedAt}）。 */
  function embedDocs() {
    return allDocs().map((d) => ({ id: d.id, content: d.text, updatedAt: d.updatedAt }));
  }

  /** 片段收缩/删除后的向量孤儿清理（前缀 kb: 范围内，不碰 L1 向量）。 */
  function pruneOrphans() {
    if (!embedding || typeof embedding.prunePrefix !== 'function') return;
    const keep = new Set(allDocs().map((d) => d.id));
    try {
      embedding.prunePrefix('kb:', keep);
    } catch { /* 忽略 */ }
  }

  function status() {
    const cfg = config.effective().knowledge || {};
    const semanticReady = !!(embedding && typeof embedding.ready === 'function' && embedding.ready() && !embedding.sourceChanged());
    let vectorCount = 0;
    if (semanticReady) {
      for (const d of allDocs()) {
        if (embedding.getVector(d.id)) vectorCount++;
      }
    }
    return {
      enabled: !!cfg.enabled,
      paths: Array.isArray(cfg.paths) ? cfg.paths : [],
      extensions: Array.isArray(cfg.extensions) ? cfg.extensions : ['.md', '.txt'],
      files: countFiles(),
      chunks: chunkCount(),
      semanticReady,
      vectorCount,
      lastScanAt: state.lastScanAt,
      lastError: state.lastError,
    };
  }

  function flush() {
    try {
      writeJsonAtomic(indexFile, JSON.stringify(state));
    } catch { /* 忽略 */ }
  }

  return { scan, search, status, chunkCount, embedDocs, pruneOrphans, flush };
}
