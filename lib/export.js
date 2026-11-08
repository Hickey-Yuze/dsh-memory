// dsh-memory — 定时整理导出：把 L1 记忆按「项目」合并导出为知识库 md。
// 设计对齐用户约定（2026-11-05 / 2026-11-07 改造）：
//   - 导出是只读视图，记忆本体仍是 JSON（「不迁 md」禁忌——导出不搬家）
//   - 按项目聚合：场景先聚类成项目（黄金矿工/像素办公室/音乐平台…），
//     每个项目一个目录 + README.md 合并文档（项目总览 + 各场景小节）
//   - 项目名跨次稳定：sceneId→项目名 映射持久化到 project-map.json，
//     增量导出时新场景优先归入已有项目（不再并发拆目录）
//   - 提炼精华：复用现有 llm 通道（消耗 token），每项目生成「总览」段
//   - 幂等：记录上次导出时间戳，只重生成「有更新的场景所属项目」文档
//   - 根目录生成 README.md 总索引；旧版按场景分目录的 md 自动移入 _legacy_scenes/
//   - 完整 cron 5 段表达式触发（lib/cron.js 解析），也可手动触发立即导一次

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';
import { extractJsonLoose } from './prompts.js';

const EXPORT_STATE_FILE = 'export-state.json';
const PROJECT_MAP_FILE = 'project-map.json';
const INDEX_FILE = 'README.md';
const LEGACY_DIR = '_legacy_scenes';
const EXPORT_DOC_CHARS = 2000;          // LLM 项目总览目标长度
const EXPORT_MAX_SUPPORT_RECORDS = 50;  // 单场景支撑列表最多条数（防 md 过大）
const EXPORT_MAX_SCENES_PER_PROJECT = 40; // 单项目文档最多列出的场景数
const CLUSTER_BATCH = 120;              // LLM 项目聚类每批场景标题数
const CLUSTER_TIMEOUT_MS = 20000;       // 聚类单批 LLM 调用上限：通道不稳时快速失败走规则归并
const LEGACY_MARKER = 'source: dsh-memory 场景导出';

function freshState() {
  return { version: 1, lastExportAt: 0, lastResult: null };
}

function loadJsonSafe(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

/** 场景名/项目名 → 目录名：去掉不能用于文件名的字符，限长。 */
function dirNameOf(title) {
  const clean = String(title || '未归类').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 80);
  return clean || '未归类';
}

/**
 * 语义匹配：把场景名归入 targetDir 下已存在的某个子文件夹。
 * （保留：旧版单场景归类 + 规则降级聚类复用）
 * 规则（零依赖，避免每次都烧一次 LLM）：
 *   1) 精确同名 → 命中
 *   2) 互相包含（去掉空格/下划线后小写比较）→ 命中
 *   3) 词重叠 ≥ 2（英文按空格 token、中文按单字符）→ 命中
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
  const zhTokens = (s) => [...s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')];
  const enTokens = (s) => s.toLowerCase().split(/[\s_\-/]+/).filter((t) => t.length >= 2);
  let best = null;
  for (const d of existingDirs) {
    let overlap = 0;
    const zh = zhTokens(d);
    for (const c of zhTokens(name)) if (zh.includes(c)) overlap++;
    const en = enTokens(d);
    for (const t of enTokens(name)) if (en.includes(t)) overlap++;
    if (overlap >= 2 && (!best || overlap > best.overlap)) best = { dir: d, overlap };
  }
  if (best) return { dir: best.dir, created: false };
  return { dir: name, created: true };
}

/** 旧版单场景 md（保留：兼容测试与旧格式识别参考；新导出不再使用）。 */
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

// ---------- 项目聚类 ----------

/** 规则降级聚类：已知项目优先归入（字符重叠≥2）；否则场景标题自身作项目名（兜底可读）。零 LLM。 */
function clusterByRules(scenes, knownProjectNames) {
  const map = {};
  const norm = (s) => String(s || '').trim();
  const known = [...new Set(knownProjectNames || [])].filter((p) => p && p !== '未归类');
  const titleGroups = new Map(); // 完全同名标题 → 组名（即标题本身）
  for (const sc of scenes) {
    const title = norm(sc.title);
    if (!title) { map[sc.id] = '未归类'; continue; }
    // 1) 标题与已有项目互相包含（子串关系）才算相关——避免旧版「共 2 字就硬并」
    //    把《像素办公室会议点击修复》并进《当前生活与项目焦点》的大杂烩。
    let hit = null;
    for (const p of known) {
      const pt = norm(p);
      if (!pt) continue;
      if (title.includes(pt) || pt.includes(title)) { hit = p; break; }
    }
    // 2) 完全同名标题合并为同一组（组名即标题）
    const same = titleGroups.get(title);
    map[sc.id] = hit || same || title;
    if (!hit && !same) titleGroups.set(title, title);
  }
  const projects = [...new Set(Object.values(map))];
  return { map, projects };
}

/**
 * LLM 项目聚类：把一批场景标题归入项目（已有项目优先）。分批调用，批间项目名累加。
 * 返回 { map: {sceneId: projectName}, projects: [去重项目名] }。
 */
async function clusterScenes(llm, scenes, knownProjectNames) {
  const map = {};
  const projects = [...new Set((knownProjectNames || []).filter((p) => p && p !== '未归类'))];
  const system = [
    '你是项目归类助手。下面给出某个人 AI 记忆库中一批「场景」（每个场景 = 一个会话/主题的记忆组）。',
    '任务：把属于同一项目的场景归为一组，并为每组起一个简短项目名（2~6 个汉字，如「黄金矿工」「像素办公室」「音乐平台」）。',
    '判断规则：',
    '- 同一项目 = 同一软件产品 / 同一工作流 / 同一主题领域（例如《黄金矿工》的开发、验证环境、派活纪律都应归「黄金矿工」）',
    '- 若场景能明确归入「已有项目」则归入，不要为单个场景新建近义项目；项目名要与已有项目保持一致',
    '- 无法归入任何项目的标为「未归类」',
    '- 项目名要短、稳定，不带括号、冒号与说明文字',
    '只输出 JSON，不要输出任何其他文字：{"projects":[{"name":"项目名","sceneIds":["s_xxx",...]}]}',
  ].join('\n');

  const knownLine = projects.length > 0 ? `已有项目（优先归入）：${projects.join('、')}` : '已有项目：无（全部自行归类）';
  const batchable = [...scenes];
  while (batchable.length > 0) {
    const batch = batchable.splice(0, CLUSTER_BATCH);
    const list = batch.map((s) => `${s.id}: ${s.title}`).join('\n');
    const user = `${knownLine}\n\n场景列表：\n${list}`;
    try {
      if (!llm || typeof llm.call !== 'function') throw new Error('无 LLM 通道');
      // LLM 通道不稳（主路由失败、fallback 逐条等待）时聚类会被整批拖死：
      // 每批最多等 CLUSTER_TIMEOUT_MS，超时抛错走规则兜底，保证聚类可秒级完成。
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('聚类批处理超时，改用规则归并')), CLUSTER_TIMEOUT_MS);
      let result;
      try {
        result = await llm.call({ layer: 'l2', purpose: 'memory:project', system, user, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!result.ok) throw new Error(result.error || 'LLM 调用失败');
      const obj = extractJsonLoose(String(result.text || ''));
      const groups = Array.isArray(obj && obj.projects) ? obj.projects : null;
      if (!groups || groups.length === 0) throw new Error('聚类输出结构不符');
      const seen = new Set();
      for (const g of groups) {
        if (!g || typeof g !== 'object') continue;
        const name = String(g.name || '').trim();
        if (!name) continue;
        if (name !== '未归类' && !projects.includes(name)) projects.push(name);
        const ids = Array.isArray(g.sceneIds) ? g.sceneIds.filter((i) => typeof i === 'string') : [];
        for (const id of ids) { if (!seen.has(id)) { seen.add(id); map[id] = name; } }
      }
      // 本批未被 LLM 点名的场景 → 规则兜底
      const missing = batch.filter((s) => !seen.has(s.id));
      if (missing.length > 0) {
        const r = clusterByRules(missing, projects);
        Object.assign(map, r.map);
        for (const p of r.projects) if (!projects.includes(p)) projects.push(p);
      }
    } catch (e) {
      const r = clusterByRules(batch, projects);
      Object.assign(map, r.map);
      for (const p of r.projects) if (!projects.includes(p)) projects.push(p);
    }
  }
  return { map, projects };
}

// ---------- 项目文档 ----------

/** LLM 提炼项目总览正文（异步；失败抛错由调用方降级为空）。 */
async function distillProject(llm, projectName, scenes, records) {
  if (!llm || typeof llm.call !== 'function') return '';
  const lines = [];
  for (const sc of scenes.slice(0, EXPORT_MAX_SCENES_PER_PROJECT)) {
    const members = sc.recordIds.map((id) => records.find((r) => r.id === id)).filter(Boolean);
    lines.push(`【${sc.title}】`);
    for (const r of members.slice(0, 12)) {
      lines.push(`- ${String(r.content || '').replace(/\n/g, ' ').slice(0, 200)}`);
    }
  }
  const recordsText = lines.join('\n');
  if (!recordsText.trim()) return '';
  const system =
    '你是产品需求文档（PRD）撰写专家。下面是某个人 AI 记忆库中一个「项目」下的场景与记忆条目（编号/场景分组列表）。' +
    '请把这些零散记忆提炼成一篇**正规 PRD（产品需求文档）**，按以下固定骨架组织（Markdown）：\n' +
    '- ## 1. 背景与目标（### 1.1 背景 / ### 1.2 目标 / ### 1.3 非目标）\n' +
    '- ## 2. 功能需求（### 2.1 需求清单：Markdown 表格，列=编号/需求/优先级/状态，编号 R1/R2…，优先级 P0~P2，状态=已实现/待实现；### 2.2 详细需求：每条 **R# 需求名**：描述（规则、边界、约定））\n' +
    '- ## 3. 非功能需求（- **项**：描述）\n' +
    '- ## 4. 验收标准（Markdown 表格，列=编号/验收项/标准，编号 A1/A2…）\n' +
    '- ## 5. 里程碑（- **日期** 节点（commit 可考时注明））\n' +
    '- ## 6. 变更记录（Markdown 表格，列=版本/日期/变更/作者）\n' +
    '- ## 附录 A：参考资料（Markdown 表格，列=名称/位置，如源码仓库链接、项目内文档路径（docs/…）、数据落盘目录，**只列记忆条目中真实出现的项**）\n' +
    '- 重要术语加粗（**术语**），关键数字、决策、约定、项目边界必须保留；不编造、不臆测，内容只来自给定条目；删除无信息量的口语废话\n' +
    '- 直接输出文档正文（从 ## 1 开始，到 ## 附录 A 结束），不要 frontmatter、不要代码块包裹、不要开头寒暄、不要结尾总结语\n' +
    `目标篇幅约 ${EXPORT_DOC_CHARS} 字符以内。`;
  const user = `项目：${projectName}\n\n场景与记忆条目：\n${recordsText}`;
  const result = await llm.call({ layer: 'l2', purpose: 'memory:export', system, user });
  if (!result.ok) throw new Error(result.error || 'LLM 调用失败');
  let text = String(result.text || '').trim();
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '');
  return text.slice(0, EXPORT_DOC_CHARS * 3);
}

/** 项目族标签：全 work → 团队工作准则；全 chat → 用户个人画像；混合 → 记忆。 */
function familyLabelOf(scenes) {
  const fams = [...new Set(scenes.map((s) => s.family))];
  if (fams.length === 1 && fams[0] === 'work') return '团队工作准则';
  if (fams.length === 1 && fams[0] === 'chat') return '用户个人画像';
  return '个人与团队记忆';
}

/** 渲染单项目合并文档：正规 PRD（产品需求文档）骨架。 */
export function renderProjectMd(projectName, scenesWithRecords, body, familyLabel) {
  const today = new Date().toISOString().slice(0, 10);
  const tag = familyLabel === '团队工作准则' ? '团队' : familyLabel === '用户个人画像' ? '个人' : '团队';
  const recordTotal = scenesWithRecords.reduce((sum, x) => sum + x.records.length, 0);
  const lines = [];
  lines.push('---');
  lines.push(`title: ${projectName}`);
  lines.push(`created: ${today}`);
  lines.push(`updated: ${today}`);
  lines.push('type: knowledge');
  lines.push(`tags: [${tag}, 记忆, 项目]`);
  lines.push('source: dsh-memory 项目导出');
  lines.push('---');
  lines.push('');
  lines.push(`# ${projectName}（PRD）`);
  lines.push('');
  lines.push(`> 版本 v1.0 ｜ ${today} ｜ 状态：已实现 ｜ 记忆源：${scenesWithRecords.length} 个场景 / ${recordTotal} 条记忆`);
  lines.push('');
  if (body && String(body).trim()) {
    lines.push(String(body).trim());
    lines.push('');
  }
  // 附录 A：参考资料 —— LLM 正文若已自带「附录 A」则不重复；缺失时补占位
  if (!String(body || '').includes('附录 A')) {
    lines.push('## 附录 A：参考资料');
    lines.push('');
    lines.push('> 未提炼出可考参考资料；原始记忆见文末说明。');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('> 原始记忆保留在 dsh-memory 记忆库（JSON），未随导出搬运。');
  lines.push('');
  return lines.join('\n');
}

/** 渲染根目录总索引 README。 */
export function renderIndexReadme(projects, totalScenes, totalRecords, exportedAt) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push('# dsh-memory 知识导出（按项目）');
  lines.push('');
  lines.push(`> 自动生成于 ${today}｜${totalScenes} 个场景 → ${projects.length} 个项目（共 ${totalRecords} 条记忆）`);
  lines.push('');
  lines.push('| 项目 | 场景数 | 记忆数 | 文档 |');
  lines.push('|---|---|---|---|');
  for (const p of projects) {
    const dir = dirNameOf(p.name);
    lines.push(`| ${p.name} | ${p.sceneCount} | ${p.recordCount} | [${dir}/README.md](${dir}/README.md) |`);
  }
  lines.push('');
  lines.push('> 本目录由 dsh-memory 定时整理导出维护（只读视图，记忆本体仍为 JSON）。');
  lines.push('> 旧版按场景分目录的 md 文件已移入 `_legacy_scenes/`（可随时删除）。');
  lines.push('');
  return lines.join('\n');
}

// ---------- 旧格式识别 ----------

/** 目录内是否存在旧版场景导出 md（frontmatter 含 source: dsh-memory 场景导出）。 */
function isLegacySceneDir(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !String(e.name).toLowerCase().endsWith('.md')) continue;
      const head = readFileSync(join(dir, e.name), 'utf-8').slice(0, 800);
      if (head.includes(LEGACY_MARKER)) return true;
    }
  } catch { /* 目录不可读视为非旧格式 */ }
  return false;
}

/** 把 targetDir 下旧版场景目录移入 _legacy_scenes/（只动旧格式目录，不动项目与用户目录）。 */
function moveLegacySceneDirs(targetDir, projectDirs, log) {
  let dirs = [];
  try {
    dirs = readdirSync(targetDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { return 0; }
  const legacyRoot = join(targetDir, LEGACY_DIR);
  let moved = 0;
  for (const d of dirs) {
    if (d === LEGACY_DIR || projectDirs.has(d)) continue;
    const abs = join(targetDir, d);
    if (!isLegacySceneDir(abs)) continue;
    try {
      mkdirSync(legacyRoot, { recursive: true });
      renameSync(abs, join(legacyRoot, d));
      moved += 1;
    } catch (e) {
      if (log) log.warn(`旧场景目录迁移失败 ${d}: ${e.message || e}`);
    }
  }
  return moved;
}

// ---------- 导出器 ----------

/** 异步导出器：项目聚类 → 按项目生成合并文档 → 总索引 → 收纳旧目录。 */
export function createExporter({ store, config, log, dataDir, llm } = {}) {
  let running = false; // 是否正在后台导出
  let progress = null; // { done, total, cur, ok } 进度快照

  const statePath = () => join(dataDir, EXPORT_STATE_FILE);
  const projectMapPath = () => join(dataDir, PROJECT_MAP_FILE);
  const readState = () => loadJsonSafe(statePath(), freshState());
  const readProjectMap = () => loadJsonSafe(projectMapPath(), {});
  const writeProjectMap = (map) => { try { writeJsonAtomic(projectMapPath(), JSON.stringify(map, null, 1)); } catch (e) { if (log) log.warn(`项目映射写入失败: ${e.message || e}`); } };

  /** 单项目导出：提炼总览 + 写 <项目>/README.md。 */
  async function exportProject(projectName, scenes, existingDirs, counters) {
    const membersByScene = scenes
      .map((scene) => ({
        scene,
        records: (scene.recordIds || [])
          .map((id) => store.getRecord(id))
          .filter(Boolean)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
      }))
      .filter((x) => x.records.length > 0);
    if (membersByScene.length === 0) return false;
    const familyLabel = familyLabelOf(membersByScene.map((x) => x.scene));

    let body = '';
    try {
      const allRecords = membersByScene.flatMap((x) => x.records);
      body = await distillProject(llm, projectName, membersByScene.map((x) => x.scene), allRecords);
      counters.docChars += body.length;
    } catch (e) {
      if (log) log.warn(`项目「${projectName}」总览提炼失败（降级场景明细）: ${e.message || e}`);
    }

    const dir = dirNameOf(projectName);
    const sceneDir = join(existingDirs.targetDir, dir);
    try { mkdirSync(sceneDir, { recursive: true }); } catch { /* 目录已存在或权限问题 */ }
    if (!existingDirs.projectSet.has(dir)) {
      existingDirs.projectSet.add(dir);
      counters.dirs++;
    }

    const md = renderProjectMd(projectName, membersByScene, body, familyLabel);
    const filePath = join(sceneDir, INDEX_FILE);
    try {
      writeFileSync(filePath, md, 'utf-8');
      counters.files++;
      counters.records += membersByScene.reduce((sum, x) => sum + x.records.length, 0);
    } catch (e) {
      if (log) log.warn(`项目导出写入失败 ${filePath}: ${e.message || e}`);
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

    // —— 项目聚类（串行，批内失败规则降级）——
    const projectMap = readProjectMap();
    const knownProjects = [...new Set([
      ...Object.values(projectMap).filter(Boolean),
      ...existingDirs.filter((d) => d !== LEGACY_DIR && !isLegacySceneDir(join(targetDir, d))),
    ])];
    let freshMap = { map: {}, projects: knownProjects };
    try {
      freshMap = await clusterScenes(llm, fresh, knownProjects);
    } catch (e) {
      if (log) log.warn(`项目聚类异常，降级规则聚类: ${e.message || e}`);
      freshMap = { map: clusterByRules(fresh, knownProjects).map, projects: knownProjects };
    }
    for (const [id, name] of Object.entries(freshMap.map)) projectMap[id] = name;
    writeProjectMap(projectMap);

    // 受影响项目：fresh 涉及的项目（含「未归类」）
    const touched = [...new Set(Object.values(freshMap.map))];
    const share = { targetDir, projectSet: new Set() };
    const projectScenesByName = {};
    for (const scene of scenes) {
      const name = projectMap[scene.id] || '未归类';
      (projectScenesByName[name] = projectScenesByName[name] || []).push(scene);
    }
    const finalProjects = Object.entries(projectScenesByName)
      .map(([name, ps]) => ({ name, scenes: ps }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

    let done = 0;
    for (const name of [...touched].sort((a, b) => a.localeCompare(b, 'zh'))) {
      const entry = finalProjects.find((p) => p.name === name);
      if (!entry) continue;
      progress = { ...progress, cur: name };
      try {
        await exportProject(name, entry.scenes, share, counters);
      } catch (e) {
        if (log) log.warn(`项目「${name}」导出异常: ${e.message || e}`);
      }
      progress = { ...progress, done: ++done };
    }

    const result = {
      ok: true,
      scenes: fresh.length,
      records: counters.records,
      files: counters.files,
      dirs: counters.dirs,
      docChars: counters.docChars,
      projects: touched.length,
      skipped: fresh.length === 0,
    };
    if (counters.files > 0 || fresh.length > 0) {
      // 总索引（计数与各项目 README 的实际渲染口径一致）
      const indexed = finalProjects.map((p) => {
        const rendered = p.scenes.map((s) => ({
          scene: s,
          records: (s.recordIds || [])
            .map((id) => { try { return store.getRecord(id) } catch { return undefined } })
            .filter((r) => r !== undefined && typeof r === 'object' && typeof r.content === 'string' && r.content.trim() !== ''),
        })).filter((x) => x.records.length > 0);
        const picked = rendered.reduce((sum, x) => sum + x.records.slice(0, EXPORT_MAX_SUPPORT_RECORDS).length, 0);
        return { name: p.name, sceneCount: rendered.length, recordCount: picked };
      });
      const indexMd = renderIndexReadme(indexed, scenes.length, counters.records || 0, Date.now());
      try { writeFileSync(join(targetDir, INDEX_FILE), indexMd, 'utf-8'); } catch (e) { if (log) log.warn(`索引写入失败: ${e.message || e}`); }
      // 收纳旧版场景目录（仅当本次至少成功写了一个项目文档）
      if (counters.files > 0) {
        const moved = moveLegacySceneDirs(targetDir, share.projectSet, log);
        if (moved > 0 && log) log.info(`旧版场景目录收纳: ${moved} 个 → ${LEGACY_DIR}/`);
      }
      state.lastExportAt = Date.now();
      state.lastResult = result;
      writeJsonAtomic(statePath(), JSON.stringify(state, null, 1));
    }
    if (log && counters.files > 0) log.info(`定时导出完成: ${counters.files} 个项目文档 / ${counters.dirs} 个新目录 / ${counters.records} 条记忆 / 提炼 ${counters.docChars} 字符`);
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
