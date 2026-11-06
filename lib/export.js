// dsh-memory — 定时整理导出：把 L1 记忆按 L2 场景分目录导出为 md 文件。
// 设计对齐用户约定（2026-11-05）：
//   - 导出是只读视图，记忆本体仍是 JSON（「不迁 md」禁忌——导出不搬家）
//   - 按主题场景（L2）分目录 + 按日期分文件：targetDir/<场景名>/<YYYY-MM-DD>.md
//   - 自动归类：扫描 targetDir 已有文件夹结构，用场景名做语义匹配放到最合适子文件夹，
//     找不到就新建场景目录
//   - 提炼精华：复用现有 llm 通道（消耗 token），每场景生成「精华」段
//   - 幂等：记录上次导出时间戳，只导增量（updatedAt > lastExportAt 的场景/记忆）
//   - 完整 cron 5 段表达式触发（lib/cron.js 解析），也可手动触发立即导一次

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const EXPORT_STATE_FILE = 'export-state.json';
const EXPORT_DOC_CHARS = 2000;        // LLM 提炼正文目标长度
const EXPORT_MAX_RECORDS_PER_SCENE = 200; // 单场景 md 最多列出的记忆条数（支撑列表）
const EXPORT_MAX_SUPPORT_RECORDS = 50;    // 支撑列表最多条数（防 md 过大）

function freshState() {
  return { version: 1, lastExportAt: 0, lastResult: null };
}

function loadJsonSafe(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

/** 场景名 → 目录名：去掉不能用于文件名的字符，限长。 */
function dirNameOf(title) {
  const clean = String(title || '未归类').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80);
  return clean || '未归类';
}

/**
 * 语义匹配：把场景名归入 targetDir 下已存在的某个子文件夹。
 * 规则（零依赖，避免每次归类都烧一次 LLM）：
 *   1) 精确同名 → 命中
 *   2) 互相包含（去掉空格/下划线后小写比较）→ 命中
 *   3) 词重叠 ≥ 2（英文按空格 token、中文按 2+ 字符子串）→ 命中
 * 找不到 → 新建场景目录。
 */
export function pickSceneDir(sceneTitle, existingDirs) {
  const name = dirNameOf(sceneTitle);
  if (existingDirs.length === 0) return { dir: name, created: true };
  const exact = existingDirs.find((d) => d === name);
  if (exact) return { dir: exact, created: false };
  const norm = (s) => s.toLowerCase().replace(/[_\s]/g, '');
  const n = norm(name);
  for (const d of existingDirs) {
    const nd = norm(d);
    if (n.length >= 2 && (nd.includes(n) || n.includes(nd))) return { dir: d, created: false };
  }
  // 词重叠：中文按 2+ 字符子串、英文按 token
  const zhTokens = (s) => [...s.replace(/[\W_]/g, '')];
  const enTokens = (s) => s.toLowerCase().split(/[\s_\-/]+/).filter((t) => t.length >= 2);
  let best = null;
  for (const d of existingDirs) {
    let overlap = 0;
    const zh = zhTokens(d);
    for (const c of zhTokens(name)) if (zh.includes(c)) overlap++;
    const en = enTokens(d);
    for (const t of enTokens(name)) if (en.includes(t)) overlap++;
    if (overlap >= 3 && (!best || overlap > best.overlap)) best = { dir: d, overlap };
  }
  if (best) return { dir: best.dir, created: false };
  return { dir: name, created: true };
}

/** 生成单场景 md 文档。records 为该场景成员（按 updatedAt 倒序），body 为 LLM 提炼的结构化正文（可空）。 */
export function renderSceneMd(scene, records, body, familyLabel) {
  const lines = [];
  const today = new Date().toISOString().slice(0, 10);
  const kind = scene.family === 'work' ? 'team' : 'personal';
  lines.push('---');
  lines.push(`title: ${scene.title}`);
  lines.push(`created: ${today}`);
  lines.push(`updated: ${today}`);
  lines.push('type: knowledge');
  lines.push(`tags: [${familyLabel === '团队工作准则' ? '团队, 记忆' : '个人, 记忆'}]`);
  lines.push('source: dsh-memory 场景导出');
  lines.push('---');
  lines.push('');
  lines.push(`# ${scene.title}`);
  lines.push('');
  lines.push(`> ${familyLabel} 记忆域｜场景 ${scene.id}｜${records.length} 条记忆`);
  lines.push('');
  if (body && String(body).trim()) {
    lines.push(String(body).trim());
    lines.push('');
  }
  const support = records.slice(0, EXPORT_MAX_SUPPORT_RECORDS);
  lines.push('---');
  lines.push('');
  lines.push('## 支撑记忆');
  lines.push('');
  for (const r of support) {
    const kindLabel = r.kind === 'opinion' ? '（推测）' : r.kind === 'commitment' ? '（约定）' : '';
    const when = r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : '';
    lines.push(`- ${kindLabel ? kindLabel + ' ' : ''}${String(r.content || '').replace(/\n/g, ' ')}${when ? '  · ' + when : ''}`);
  }
  if (records.length > support.length) {
    lines.push('');
    lines.push(`> 另有 ${records.length - support.length} 条记忆未列出（本场景共 ${records.length} 条）。`);
  }
  lines.push('');
  return lines.join('\n');
}

/** LLM 提炼结构化知识正文（异步；失败抛错由调用方降级）。 */
async function distillScene(llm, scene, members) {
  if (!llm || typeof llm.call !== 'function') return '';
  const recordsText = members
    .slice(0, 60)
    .map((r, i) => `${i + 1}. ${String(r.content || '').replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');
  if (!recordsText.trim()) return '';
  const familyLabel = scene.family === 'work' ? '团队工作' : '个人日常';
  const system =
    '你是知识整理专家。下面是某个人 AI 记忆库中一个主题场景的记忆条目（编号列表）。' +
    '请把这些零散记忆提炼成一篇结构化知识文档，对齐个人知识库的写作规范：\n' +
    '- 用 Markdown 章节标题（## / ###）组织内容，按主题逻辑分组\n' +
    '- 重要术语加粗（**术语**），关键数字、决策、约定必须保留\n' +
    '- 优先用列表、表格呈现事实与要点，条理清晰\n' +
    '- 不编造、不臆测，内容只来自给定条目；删除无信息量的口语废话\n' +
    '- 直接输出文档正文（从第一个章节标题开始），不要 frontmatter、不要代码块包裹、不要开头寒暄、不要结尾总结语\n' +
    `目标篇幅约 ${EXPORT_DOC_CHARS} 字符以内。`;
  const user = `记忆域：${familyLabel}\n场景：${scene.title}\n\n记忆条目：\n${recordsText}`;
  const result = await llm.call({ layer: 'l2', purpose: 'memory:export', system, user });
  if (!result.ok) throw new Error(result.error || 'LLM 调用失败');
  let text = String(result.text || '').trim();
  // 剥掉 LLM 可能加的 markdown 代码块围栏
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '');
  return text.slice(0, EXPORT_DOC_CHARS * 3);
}

/** 异步导出器：逐场景 await LLM 提炼（不阻塞事件循环），增量幂等。 */
const EXPORT_CONCURRENCY = 5; // LLM 提炼并发数（串行 2967 场景太久，限并发避免打爆 llm 通道）

export function createExporter({ store, config, log, dataDir, llm } = {}) {
  let running = false; // 是否正在后台导出
  let progress = null; // { done, total, cur, ok } 进度快照

  const statePath = () => join(dataDir, EXPORT_STATE_FILE);
  const readState = () => loadJsonSafe(statePath(), freshState());

  /** 单场景导出：提炼 + 写文件。返回 { body, wrote }。 */
  async function exportOne(scene, targetDir, existingDirs, counters) {
    const familyLabel = scene.family === 'work' ? '团队工作准则' : '用户个人画像';
    const members = (scene.recordIds || [])
      .map((id) => store.getRecord(id))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (members.length === 0) return false; // 空场景不导出
    const picked = pickSceneDir(scene.title, existingDirs);
    const sceneDir = join(targetDir, picked.dir);
    try { mkdirSync(sceneDir, { recursive: true }); } catch { /* 目录已存在或权限问题 */ }
    if (picked.created && !existingDirs.includes(picked.dir)) {
      existingDirs.push(picked.dir);
      counters.dirs++;
    }

    let body = '';
    try {
      body = await distillScene(llm, scene, members);
      counters.docChars += body.length;
    } catch (e) {
      if (log) log.warn(`场景「${scene.title}」提炼失败（降级支撑列表）: ${e.message || e}`);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filePath = join(sceneDir, `${dateStr}.md`);
    const md = renderSceneMd(scene, members.slice(0, EXPORT_MAX_RECORDS_PER_SCENE), body, familyLabel);
    try {
      writeFileSync(filePath, md, 'utf-8');
      counters.files++;
      counters.records += members.length;
    } catch (e) {
      if (log) log.warn(`导出写入失败 ${filePath}: ${e.message || e}`);
    }
    return true;
  }

  function targetDirOf(cfg) {
    return cfg.export && cfg.export.targetDir ? String(cfg.export.targetDir).trim() : '';
  }

  /** 立即导出一次（手动触发或 cron 到点调用）。返回最终结果。 */
  async function runExport() {
    const cfg = config.effective();
    const targetDir = targetDirOf(cfg);
    if (!targetDir) return { ok: false, error: '未配置导出目录（自动化 → 定时整理导出 → 导出目录）', skipped: true };
    const scenes = store.getScenes();
    const state = readState();
    const lastExportAt = state.lastExportAt || 0;

    let existingDirs = [];
    try {
      if (existsSync(targetDir)) {
        existingDirs = readdirSync(targetDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      }
    } catch { existingDirs = []; }

    // 增量：场景本身或成员记忆在窗口内有更新
    const fresh = scenes.filter((s) => {
      if ((s.updatedAt || 0) > lastExportAt) return true;
      const members = (s.recordIds || []).map((id) => store.getRecord(id)).filter(Boolean);
      return members.some((r) => (r.updatedAt || 0) > lastExportAt);
    });

    const counters = { files: 0, dirs: 0, records: 0, docChars: 0 };
    progress = { done: 0, total: fresh.length, cur: '', ok: null };

    // 并发提炼：固定池大小，逐批跑完；每完成一个更新进度
    const pool = Array.from({ length: EXPORT_CONCURRENCY }, (_, i) => i);
    let idx = 0;
    await Promise.all(pool.map(async () => {
      while (idx < fresh.length) {
        const scene = fresh[idx++];
        progress = { ...progress, done: progress.done, cur: scene.title };
        try {
          await exportOne(scene, targetDir, existingDirs, counters);
        } catch (e) {
          if (log) log.warn(`场景「${scene.title}」导出异常: ${e.message || e}`);
        }
        progress = { ...progress, done: progress.done + 1 };
      }
    }));

    const result = { ok: true, scenes: fresh.length, records: counters.records, files: counters.files, dirs: counters.dirs, docChars: counters.docChars, skipped: fresh.length === 0 };
    if (counters.files > 0 || fresh.length > 0) {
      state.lastExportAt = Date.now();
      state.lastResult = result;
      writeJsonAtomic(statePath(), JSON.stringify(state, null, 1));
    }
    if (log && counters.files > 0) log.info(`定时导出完成: ${counters.files} 个文件 / ${counters.dirs} 个新目录 / ${counters.records} 条记忆 / 提炼 ${counters.docChars} 字符`);
    return result;
  }

  /** 后台导出：不等待完成，立即返回「已开始」；完成后写状态。 */
  async function runExportAsync() {
    if (running) return { ok: true, started: false, error: '导出已在运行', running: true };
    running = true;
    progress = { done: 0, total: 0, cur: '', ok: null };
    try {
      const result = await runExport();
      progress = { ...progress, ok: result.ok };
      return { ...result, started: true, running: false };
    } catch (e) {
      progress = { ...progress, ok: false };
      if (log) log.warn(`导出异常: ${e.message || e}`);
      return { ok: false, started: true, running: false, error: e.message || String(e) };
    } finally {
      running = false;
    }
  }

  return {
    runExport,
    runExportAsync,
    /** 导出状态（面板展示）：启用状态 / cron / 目标目录 / 上次导出 / 当前进度。 */
    status() {
      const cfg = config.effective();
      const state = readState();
      return {
        enabled: Boolean(cfg.export && cfg.export.enabled),
        cron: (cfg.export && cfg.export.cron) || '',
        targetDir: targetDirOf(cfg),
        lastExportAt: state.lastExportAt || 0,
        lastResult: state.lastResult || null,
        running,
        progress,
      };
    },
  };
}
