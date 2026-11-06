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
const EXPORT_SUMMARY_CHARS = 600;      // LLM 精华摘要目标长度
const EXPORT_MAX_RECORDS_PER_SCENE = 200; // 单场景 md 最多列出的记忆条数

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

/** 生成单场景 md 正文。records 为该场景成员（按 updatedAt 倒序），summary 为 LLM 精华（可空）。 */
export function renderSceneMd(scene, records, summary, familyLabel) {
  const lines = [];
  lines.push(`# ${scene.title}`);
  lines.push('');
  lines.push(`- 记忆域：${familyLabel}｜场景 ${scene.id}｜${records.length} 条记忆`);
  lines.push('');
  if (summary && String(summary).trim()) {
    lines.push('## 精华');
    lines.push('');
    lines.push(String(summary).trim());
    lines.push('');
  }
  lines.push('## 记忆');
  lines.push('');
  for (const r of records) {
    const kind = r.kind === 'opinion' ? '（推测）' : r.kind === 'commitment' ? '（约定）' : '';
    const when = r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : '';
    lines.push(`- ${kind ? kind + ' ' : ''}${String(r.content || '').replace(/\n/g, ' ')}${when ? '  · ' + when : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** LLM 提炼精华（异步，回退链语义；失败抛错由调用方降级）。 */
async function summarizeAsync(llm, scene, members) {
  if (!llm || typeof llm.call !== 'function') return '';
  const recordsText = members
    .slice(0, 60)
    .map((r, i) => `${i + 1}. ${String(r.content || '').replace(/\n/g, ' ').slice(0, 200)}`)
    .join('\n');
  if (!recordsText.trim()) return '';
  const system =
    '你是记忆整理助手。把用户的一段记忆条目压缩成简明精华摘要，只保留事实与要点，不编造。直接输出摘要正文，不要用任何 markdown 标题或列表。';
  const user = `场景：${scene.title}\n\n记忆条目：\n${recordsText}`;
  const result = await llm.call({ layer: 'l2', purpose: 'memory:export', system, user });
  if (!result.ok) throw new Error(result.error || 'LLM 调用失败');
  return String(result.text || '').trim().slice(0, EXPORT_SUMMARY_CHARS * 3);
}

/** 异步导出器：逐场景 await LLM 提炼（不阻塞事件循环），增量幂等。 */
export function createExporter({ store, config, log, dataDir } = {}) {
  return {
    /** 立即导出一次（手动触发或 cron 到点调用）。返回最终结果。 */
    async runExport() {
      const cfg = config.effective();
      const targetDir = cfg.export && cfg.export.targetDir ? String(cfg.export.targetDir).trim() : '';
      if (!targetDir) return { ok: false, error: '未配置导出目录（自动化 → 定时整理导出 → 导出目录）', skipped: true };
      const scenes = store.getScenes();
      const statePath = join(dataDir, EXPORT_STATE_FILE);
      const state = loadJsonSafe(statePath, freshState());
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

      let files = 0, dirs = 0, recordCount = 0, summaryChars = 0;
      for (const scene of fresh) {
        const familyLabel = scene.family === 'work' ? '团队工作准则' : '用户个人画像';
        const members = (scene.recordIds || [])
          .map((id) => store.getRecord(id))
          .filter(Boolean)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (members.length === 0) continue; // 空场景不导出
        const picked = pickSceneDir(scene.title, existingDirs);
        const sceneDir = join(targetDir, picked.dir);
        try { mkdirSync(sceneDir, { recursive: true }); } catch { /* 目录已存在或权限问题 */ }
        if (picked.created) dirs++;

        let summary = '';
        try {
          summary = await summarizeAsync(llm, scene, members);
          summaryChars += summary.length;
        } catch (e) {
          log.warn(`场景「${scene.title}」精华提炼失败（降级纯列表）: ${e.message || e}`);
        }

        const dateStr = new Date().toISOString().slice(0, 10);
        const filePath = join(sceneDir, `${dateStr}.md`);
        const md = renderSceneMd(scene, members.slice(0, EXPORT_MAX_RECORDS_PER_SCENE), summary, familyLabel);
        try {
          writeFileSync(filePath, md, 'utf-8');
          files++;
          recordCount += members.length;
        } catch (e) {
          log.warn(`导出写入失败 ${filePath}: ${e.message || e}`);
        }
        if (picked.created && !existingDirs.includes(picked.dir)) existingDirs.push(picked.dir);
      }

      const result = { ok: true, scenes: fresh.length, records: recordCount, files, dirs, summaryChars, skipped: fresh.length === 0 };
      if (files > 0 || fresh.length > 0) {
        state.lastExportAt = Date.now();
        state.lastResult = result;
        writeJsonAtomic(statePath, JSON.stringify(state, null, 1));
      }
      if (log && files > 0) log.info(`定时导出完成: ${files} 个文件 / ${dirs} 个新目录 / ${recordCount} 条记忆 / 精华 ${summaryChars} 字符`);
      return result;
    },

    /** 导出状态（面板展示）：启用状态 / cron / 目标目录 / 上次导出。 */
    status() {
      const cfg = config.effective();
      const statePath = join(dataDir, EXPORT_STATE_FILE);
      const state = loadJsonSafe(statePath, freshState());
      return {
        enabled: Boolean(cfg.export && cfg.export.enabled),
        cron: (cfg.export && cfg.export.cron) || '',
        targetDir: (cfg.export && cfg.export.targetDir) || '',
        lastExportAt: state.lastExportAt || 0,
        lastResult: state.lastResult || null,
      };
    },
  };
}
