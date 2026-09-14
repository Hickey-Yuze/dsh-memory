// dsh-memory — 存储层（JSONL + JSON 文件，全部落在 dataDir 下）：
//   conversations/<sid>.jsonl   L0 事实源，只增不改（不分族）
//   records.json                L1 原子记忆（带 family 族标签：chat=个人 / work=工作）
//   scenes.json                 L2 场景块（分族隔离，同文件内按 family 过滤）
//   persona.json                L3 核心画像（分族：families.chat / families.work）
//   state.json                  蒸馏水位 / 统计 / 重建进度（L2/L3 水位分族计数）
//   activity.jsonl              资产活动流（设置页"最近活动"）
//   usage.jsonl                 蒸馏调用记账（成本/洞察）
// 重建 = 丢弃 L1–L3，从 conversations 全量重导。
// 族语义对齐 dsh-layered-memory：记录族三级兜底（纯档强制 → auto 抽取显式 → 默认 chat），
// 去重候选只在同族内召回，L2/L3 按族各自触发。

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const STATE_VERSION = 2;
export const FAMILIES = ['chat', 'work'];

function freshFamilyState() {
  return { newSinceL2: 0, newSinceL3: 0 };
}

function freshState() {
  return {
    version: STATE_VERSION,
    sessions: {},            // sid -> { count, rounds, lastExtractAt, lastActivityAt, backoffUntil }
    families: { chat: freshFamilyState(), work: freshFamilyState() }, // 分族蒸馏水位
    stats: {
      recallInjections: 0,   // 累计注入轮次
      recallRecords: 0,      // 累计注入记忆条数
      lastRecallAt: 0,
      lastDistillAt: 0,
      distillCalls: 0,
      distillFailures: 0,
    },
    rebuild: null,           // { phase, done, total, startedAt, endedAt, cancel }
  };
}

function normFamily(family) {
  return family === 'work' ? 'work' : 'chat';
}

export function createStore(dataDir, log) {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, 'conversations'), { recursive: true });

  const convDir = join(dataDir, 'conversations');
  const recordsPath = join(dataDir, 'records.json');
  const scenesPath = join(dataDir, 'scenes.json');
  const personaPath = join(dataDir, 'persona.json');
  const statePath = join(dataDir, 'state.json');
  const activityPath = join(dataDir, 'activity.jsonl');
  const usagePath = join(dataDir, 'usage.jsonl');

  // —— 状态（内存持有，落盘原子写） ——
  let state = loadJson(statePath, freshState());
  if (!state || typeof state !== 'object' || state.version !== STATE_VERSION) {
    const v1 = state && typeof state === 'object' ? state : {};
    state = freshState();
    // v1 平铺水位 → chat 桶（旧库无族标签，记录默认归 chat）
    if (typeof v1.stats?.newSinceL2 === 'number') state.families.chat.newSinceL2 = v1.stats.newSinceL2;
    if (typeof v1.stats?.newSinceL3 === 'number') state.families.chat.newSinceL3 = v1.stats.newSinceL3;
  }
  if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
  if (!state.families || typeof state.families !== 'object') state.families = freshState().families;
  for (const f of FAMILIES) {
    if (!state.families[f] || typeof state.families[f] !== 'object') state.families[f] = freshFamilyState();
  }
  if (!state.stats) state.stats = freshState().stats;
  if (!state.stats.recallInjections) state.stats.recallInjections = 0;

  let records = migrateRecords(loadJson(recordsPath, { version: 2, records: [] }).records || []);
  let scenes = migrateScenes(loadJson(scenesPath, { version: 2, scenes: [] }).scenes || []);
  let persona = migratePersona(loadJson(personaPath, null));

  function migrateRecords(list) {
    // 旧记录无 family 列 → 默认 chat（与原版 familyForType 兜底一致）
    for (const r of list) if (r && r.family !== 'work' && r.family !== 'chat') r.family = 'chat';
    return list;
  }
  function migrateScenes(list) {
    for (const s of list) if (s && s.family !== 'work' && s.family !== 'chat') s.family = 'chat';
    return list;
  }
  /** persona v1 单文档 → v2 分族（旧画像归 chat）。 */
  function migratePersona(raw) {
    if (!raw || typeof raw !== 'object') return freshPersona();
    if (raw.version === 2 && raw.families && typeof raw.families === 'object') {
      const families = {};
      for (const f of FAMILIES) {
        const bucket = raw.families[f];
        families[f] = { content: typeof bucket?.content === 'string' ? bucket.content : '', updatedAt: Number(bucket?.updatedAt) || 0 };
      }
      return { version: 2, families };
    }
    return {
      version: 2,
      families: {
        chat: { content: typeof raw.content === 'string' ? raw.content : '', updatedAt: Number(raw.updatedAt) || 0 },
        work: { content: '', updatedAt: 0 },
      },
    };
  }
  function freshPersona() {
    return {
      version: 2,
      families: {
        chat: { content: '', updatedAt: 0 },
        work: { content: '', updatedAt: 0 },
      },
    };
  }

  let stateSaveTimer = null;
  function saveStateDebounced() {
    if (stateSaveTimer) return;
    stateSaveTimer = setTimeout(() => {
      stateSaveTimer = null;
      try { writeJsonAtomic(statePath, JSON.stringify(state, null, 1)); } catch (e) { log.warn(`state 保存失败: ${e.message}`); }
    }, 400);
    if (typeof stateSaveTimer.unref === 'function') stateSaveTimer.unref();
  }
  function saveStateNow() {
    if (stateSaveTimer) { clearTimeout(stateSaveTimer); stateSaveTimer = null; }
    try { writeJsonAtomic(statePath, JSON.stringify(state, null, 1)); } catch (e) { log.warn(`state 保存失败: ${e.message}`); }
  }

  // —— 新 id：时间基 + 随机后缀 ——
  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  // ============ L0 会话 ============
  function convPath(sid) {
    const safe = String(sid).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'unknown';
    return join(convDir, `${safe}.jsonl`);
  }

  function appendConversation(sid, role, text, meta) {
    const line = { t: Date.now(), r: role, text: String(text || '') };
    if (meta) line.meta = meta;
    appendFileSync(convPath(sid), `${JSON.stringify(line)}\n`, 'utf-8');
  }

  function appendConversationMeta(sid, meta) {
    appendFileSync(convPath(sid), `${JSON.stringify({ t: Date.now(), r: 'meta', ...meta })}\n`, 'utf-8');
  }

  /** 读会话切片：最后 limit 条 user/assistant 消息（meta 行跳过）。 */
  function readConversationTail(sid, limit = 40) {
    const path = convPath(sid);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const line = JSON.parse(lines[i]);
        if (line.r === 'user' || line.r === 'assistant') out.push(line);
      } catch { /* 坏行跳过 */ }
    }
    return out.reverse();
  }

  /** 汇总待蒸馏切片（含头部背景消息），供 L1 prompt。 */
  function readConversationSlice(sid, count, backgroundCount) {
    const path = convPath(sid);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const msgs = [];
    for (const l of lines) {
      try {
        const line = JSON.parse(l);
        if (line.r === 'user' || line.r === 'assistant') msgs.push(line);
      } catch { /* 跳过 */ }
    }
    const cut = Math.max(0, msgs.length - count);
    const backgroundStart = Math.max(0, cut - Math.max(0, backgroundCount));
    return msgs.slice(backgroundStart);
  }

  function conversationStats() {
    const files = listConversationFiles();
    let messages = 0;
    for (const f of files) {
      try { messages += readConversationTail(f.sid, Number.MAX_SAFE_INTEGER).length; } catch { /* 跳过 */ }
    }
    return { conversations: files.length, messages };
  }

  function listConversationFiles() {
    const out = [];
    try {
      for (const name of readdirSync(convDir)) {
        if (!name.endsWith('.jsonl')) continue;
        const sid = name.slice(0, -'.jsonl'.length);
        let size = 0;
        let mtime = 0;
        try {
          const st = statSync(join(convDir, name));
          size = st.size;
          mtime = st.mtimeMs;
        } catch { /* 跳过 */ }
        out.push({ sid, size, mtime });
      }
    } catch { /* 目录缺失 */ }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  /** 跨会话全文检索 L0（子串计数评分，控制单文件扫描量）。 */
  function searchConversations(query, limit = 8) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const results = [];
    for (const file of listConversationFiles()) {
      if (results.length >= limit * 4) break;
      const path = join(convDir, `${file.sid}.jsonl`);
      if (file.size > 8 * 1024 * 1024) continue; // 超大文件跳过，避免卡顿
      let raw = '';
      try { raw = readFileSync(path, 'utf-8'); } catch { continue; }
      for (const lineText of raw.split('\n')) {
        if (!lineText.trim()) continue;
        let line;
        try { line = JSON.parse(lineText); } catch { continue; }
        if (line.r !== 'user' && line.r !== 'assistant') continue;
        const text = String(line.text || '');
        const lower = text.toLowerCase();
        if (!lower.includes(q)) continue;
        const hits = lower.split(q).length - 1;
        results.push({ sessionId: file.sid, time: line.t, role: line.r, text: text.slice(0, 300), hits });
        if (results.length >= limit * 4) break;
      }
    }
    results.sort((a, b) => b.hits - a.hits || b.time - a.time);
    return results.slice(0, Math.max(1, limit));
  }

  // ============ L1 记忆 ============
  function saveRecords() {
    writeJsonAtomic(recordsPath, JSON.stringify({ version: 2, records }, null, 1));
  }

  /** upsert 记忆；family 走三级兜底：显式传入 → 旧记录保留 → chat。 */
  function upsertRecord(rec) {
    const now = Date.now();
    const family = normFamily(rec.family);
    if (rec.id) {
      const existing = records.find((r) => r.id === rec.id);
      if (existing) {
        existing.content = rec.content;
        existing.tags = Array.isArray(rec.tags) ? rec.tags : existing.tags;
        existing.family = family || existing.family || 'chat';
        existing.updatedAt = now;
        existing.sessionId = rec.sessionId || existing.sessionId;
        saveRecords();
        appendActivity('updated', 'memory', existing.id, existing.content, existing.family);
        return { record: existing, created: false };
      }
    }
    const record = {
      id: rec.id || newId('m'),
      content: String(rec.content || ''),
      tags: Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
      family,
      sessionId: rec.sessionId || '',
      sceneId: null,
      hits: 0,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
    saveRecords();
    appendActivity('added', 'memory', record.id, record.content, family);
    return { record, created: true };
  }

  function deleteRecord(id) {
    const before = records.length;
    records = records.filter((r) => r.id !== id);
    for (const scene of scenes) scene.recordIds = (scene.recordIds || []).filter((rid) => rid !== id);
    saveRecords();
    saveScenes();
    return before - records.length;
  }

  function getRecords(family) {
    if (family === 'chat' || family === 'work') return records.filter((r) => r.family === family);
    return records.slice();
  }
  function getRecord(id) { return records.find((r) => r.id === id) || null; }

  // ============ L2 场景（分族隔离） ============
  function saveScenes() {
    writeJsonAtomic(scenesPath, JSON.stringify({ version: 2, scenes }, null, 1));
  }

  /**
   * 用 LLM 输出的完整场景列表替换指定族的现有场景（尽量保持已有 id 稳定）；
   * 另一族的场景不受影响。
   */
  function replaceScenes(sceneList, family) {
    const fam = normFamily(family);
    const now = Date.now();
    const others = scenes.filter((s) => s.family !== fam);
    const byId = new Map(scenes.filter((s) => s.family === fam).map((s) => [s.id, s]));
    const next = [];
    const seenIds = new Set();
    for (const item of sceneList) {
      const recordIds = (Array.isArray(item.record_ids) ? item.record_ids : Array.isArray(item.recordIds) ? item.recordIds : [])
        .filter((rid) => typeof rid === 'string' && records.some((r) => r.id === rid && r.family === fam));
      let id = typeof item.id === 'string' && byId.has(item.id) ? item.id : null;
      if (!id || seenIds.has(id)) id = newId('s');
      seenIds.add(id);
      const prev = byId.get(id);
      next.push({
        id,
        family: fam,
        title: String(item.title || '未命名场景').slice(0, 80),
        content: String(item.content || ''),
        recordIds,
        createdAt: prev ? prev.createdAt : now,
        updatedAt: now,
      });
    }
    scenes = [...others, ...next];
    const sceneIds = new Set(scenes.map((s) => s.id));
    for (const record of records) {
      const owner = scenes.find((s) => s.recordIds.includes(record.id));
      record.sceneId = owner ? owner.id : null;
    }
    saveScenes();
    saveRecords();
    for (const scene of next) appendActivity('updated', 'scene', scene.id, scene.title, fam);
    return next;
  }

  function getScenes(family) {
    if (family === 'chat' || family === 'work') return scenes.filter((s) => s.family === family);
    return scenes.slice();
  }
  function getScene(idOrTitle, family) {
    const pool = family === 'chat' || family === 'work' ? scenes.filter((s) => s.family === family) : scenes;
    const key = String(idOrTitle || '').trim().toLowerCase();
    if (!key) return null;
    return pool.find((s) => s.id === idOrTitle)
      || pool.find((s) => s.title.toLowerCase() === key)
      || pool.find((s) => s.title.toLowerCase().includes(key))
      || null;
  }

  // ============ L3 画像（分族） ============
  function setPersona(family, content) {
    const fam = normFamily(family);
    persona.families[fam] = { content: String(content || ''), updatedAt: Date.now() };
    writeJsonAtomic(personaPath, JSON.stringify(persona, null, 1));
    if (persona.families[fam].content) appendActivity('updated', 'persona', `persona-${fam}`, fam === 'chat' ? '个人画像' : '工作准则', fam);
  }
  function getPersona(family) {
    if (family === 'chat' || family === 'work') {
      const bucket = persona.families[family];
      return bucket && bucket.content ? { family, content: bucket.content, updatedAt: bucket.updatedAt } : null;
    }
    return null;
  }
  /** 两族画像快照（稳定区 auto 组装用）。 */
  function getPersonas() {
    const out = {};
    for (const f of FAMILIES) out[f] = getPersona(f);
    return out;
  }

  // ============ 活动流 / 记账 ============
  function appendActivity(verb, layer, id, title, family) {
    try {
      const line = { ts: Date.now(), verb, layer, id, title: String(title || '').slice(0, 120) };
      if (family === 'chat' || family === 'work') line.family = family;
      appendFileSync(activityPath, `${JSON.stringify(line)}\n`, 'utf-8');
    } catch { /* 活动流失败不影响主流程 */ }
  }

  function recentActivity(n = 50) {
    if (!existsSync(activityPath)) return [];
    try {
      const raw = readFileSync(activityPath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim());
      return lines.slice(-Math.max(1, n)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    } catch { return []; }
  }

  function appendUsage(entry) {
    try {
      appendFileSync(usagePath, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`, 'utf-8');
    } catch { /* 记账失败只告警 */ }
    state.stats.distillCalls += 1;
    if (entry.ok === false) state.stats.distillFailures += 1;
    saveStateDebounced();
    pruneUsage();
  }

  let lastPruneDay = 0;
  function pruneUsage() {
    const retention = Number(process.env.DSH_MEMORY_USAGE_DAYS);
    const days = Number.isFinite(retention) && retention >= 0 ? retention : 365;
    if (days <= 0) return;
    const day = Math.floor(Date.now() / 86400000);
    if (day === lastPruneDay) return;
    lastPruneDay = day;
    if (!existsSync(usagePath)) return;
    try {
      const cutoff = Date.now() - days * 86400000;
      const raw = readFileSync(usagePath, 'utf-8');
      const kept = raw.split('\n').filter((l) => {
        if (!l.trim()) return false;
        try { return JSON.parse(l).ts >= cutoff; } catch { return false; }
      });
      if (kept.length !== raw.split('\n').filter((l) => l.trim()).length) {
        writeJsonAtomic(usagePath, kept.length > 0 ? `${kept.join('\n')}\n` : '');
      }
    } catch { /* 清理失败忽略 */ }
  }

  function usageSince(days = 7) {
    if (!existsSync(usagePath)) return [];
    try {
      const cutoff = Date.now() - Math.max(0, days) * 86400000;
      const raw = readFileSync(usagePath, 'utf-8');
      return raw.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.ts >= cutoff).reverse();
    } catch { return []; }
  }

  // ============ 统计 / 重建 ============
  function counts() {
    return {
      records: records.length,
      recordsByFamily: { chat: records.filter((r) => r.family === 'chat').length, work: records.filter((r) => r.family === 'work').length },
      scenes: scenes.length,
      hasPersona: Boolean(persona.families.chat.content || persona.families.work.content),
      ...conversationStats(),
    };
  }

  function sessionState(sid) {
    if (!state.sessions[sid]) state.sessions[sid] = { count: 0, rounds: 0, lastExtractAt: 0, lastActivityAt: 0, backoffUntil: 0 };
    return state.sessions[sid];
  }
  function getState() { return state; }
  function saveState() { saveStateNow(); }

  /** 分族蒸馏水位读写。 */
  function familyWater(family) {
    const fam = normFamily(family);
    return state.families[fam] || (state.families[fam] = freshFamilyState());
  }
  function addNewSince(family, n) {
    const fam = normFamily(family);
    const bucket = familyWater(fam);
    bucket.newSinceL2 = (bucket.newSinceL2 || 0) + n;
    bucket.newSinceL3 = (bucket.newSinceL3 || 0) + n;
    saveStateDebounced();
  }

  function markDistilled(sid) {
    const s = sessionState(sid);
    s.lastExtractAt = Date.now();
    state.stats.lastDistillAt = Date.now();
    saveStateNow();
  }

  function wipe({ keepConversations = true } = {}) {
    records = [];
    scenes = [];
    persona = freshPersona();
    state = freshState();
    saveRecords(); saveScenes(); saveStateNow();
    try { writeJsonAtomic(personaPath, JSON.stringify(persona, null, 1)); } catch { /* 忽略 */ }
    try { if (existsSync(activityPath)) rmSync(activityPath); } catch { /* 忽略 */ }
    try { if (existsSync(usagePath)) rmSync(usagePath); } catch { /* 忽略 */ }
    if (!keepConversations) {
      try { for (const f of listConversationFiles()) rmSync(join(convDir, `${f.sid}.jsonl`), { force: true }); } catch { /* 忽略 */ }
    }
  }

  return {
    // L0
    appendConversation, appendConversationMeta, readConversationTail, readConversationSlice,
    searchConversations, listConversationFiles, conversationStats,
    // L1
    getRecords, getRecord, upsertRecord, deleteRecord,
    // L2
    getScenes, getScene, replaceScenes,
    // L3
    getPersona, getPersonas, setPersona,
    // 活动 / 记账
    appendActivity, recentActivity, appendUsage, usageSince,
    // 状态 / 统计 / 维护
    sessionState, getState, saveState, markDistilled, counts, wipe, newId,
    familyWater, addNewSince,
  };
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    // 坏文档：备份后用默认值（缓存语义：只可能过期，不可能错）
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      renameSafe(path, `${path}.bak-${stamp}`);
    } catch { /* 忽略 */ }
    return fallback;
  }
}

function renameSafe(from, to) {
  try { writeFileSync(to, readFileSync(from)); } catch { /* 忽略 */ }
}
