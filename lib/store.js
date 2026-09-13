// dsh-memory — 存储层（JSONL + JSON 文件，全部落在 dataDir 下）：
//   conversations/<sid>.jsonl   L0 事实源，只增不改
//   records.json                L1 原子记忆（整文档原子写）
//   scenes.json                 L2 场景块
//   persona.json                L3 核心画像
//   state.json                  蒸馏水位 / 统计 / 重建进度
//   activity.jsonl              资产活动流（设置页"最近活动"）
//   usage.jsonl                 蒸馏调用记账（成本/洞察）
// 重建 = 丢弃 L1–L3，从 conversations 全量重导。

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const STATE_VERSION = 1;

function freshState() {
  return {
    version: STATE_VERSION,
    sessions: {},            // sid -> { count, rounds, lastExtractAt, lastActivityAt, backoffUntil }
    stats: {
      newSinceL2: 0,
      newSinceL3: 0,
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
  if (!state || typeof state !== 'object' || state.version !== STATE_VERSION) state = freshState();
  if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
  if (!state.stats) state.stats = freshState().stats;
  if (!state.stats.recallInjections) state.stats.recallInjections = 0;

  let records = loadJson(recordsPath, { version: 1, records: [] }).records || [];
  let scenes = loadJson(scenesPath, { version: 1, scenes: [] }).scenes || [];
  let persona = loadJson(personaPath, { version: 1, content: '', updatedAt: 0 });

  let stateSaveTimer = null;
  function saveStateDebounced() {
    if (stateSaveTimer) return;
    stateSaveTimer = setTimeout(() => {
      stateSaveTimer = null;
      try { writeJsonAtomic(statePath, JSON.stringify(state, null, 1)); } catch (e) { log.warn(`state 保存失败: ${e.message}`); }
    }, 400);
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
    writeJsonAtomic(recordsPath, JSON.stringify({ version: 1, records }, null, 1));
  }

  function upsertRecord(rec) {
    const now = Date.now();
    if (rec.id) {
      const existing = records.find((r) => r.id === rec.id);
      if (existing) {
        existing.content = rec.content;
        existing.tags = Array.isArray(rec.tags) ? rec.tags : existing.tags;
        existing.updatedAt = now;
        existing.sessionId = rec.sessionId || existing.sessionId;
        saveRecords();
        appendActivity('updated', 'memory', existing.id, existing.content);
        return { record: existing, created: false };
      }
    }
    const record = {
      id: rec.id || newId('m'),
      content: String(rec.content || ''),
      tags: Array.isArray(rec.tags) ? rec.tags.filter((t) => typeof t === 'string').slice(0, 6) : [],
      sessionId: rec.sessionId || '',
      sceneId: null,
      hits: 0,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
    saveRecords();
    appendActivity('added', 'memory', record.id, record.content);
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

  function getRecords() { return records.slice(); }
  function getRecord(id) { return records.find((r) => r.id === id) || null; }

  // ============ L2 场景 ============
  function saveScenes() {
    writeJsonAtomic(scenesPath, JSON.stringify({ version: 1, scenes }, null, 1));
  }

  /** 用 LLM 输出的完整场景列表替换现有场景（尽量保持已有 id 稳定）。 */
  function replaceScenes(sceneList) {
    const now = Date.now();
    const byId = new Map(scenes.map((s) => [s.id, s]));
    const next = [];
    const seenIds = new Set();
    for (const item of sceneList) {
      const recordIds = (Array.isArray(item.record_ids) ? item.record_ids : Array.isArray(item.recordIds) ? item.recordIds : [])
        .filter((rid) => typeof rid === 'string' && records.some((r) => r.id === rid));
      let id = typeof item.id === 'string' && byId.has(item.id) ? item.id : null;
      if (!id || seenIds.has(id)) id = newId('s');
      seenIds.add(id);
      const prev = byId.get(id);
      next.push({
        id,
        title: String(item.title || '未命名场景').slice(0, 80),
        content: String(item.content || ''),
        recordIds,
        createdAt: prev ? prev.createdAt : now,
        updatedAt: now,
      });
    }
    scenes = next;
    const sceneIds = new Set(scenes.map((s) => s.id));
    for (const record of records) {
      const owner = scenes.find((s) => s.recordIds.includes(record.id));
      record.sceneId = owner ? owner.id : null;
    }
    saveScenes();
    saveRecords();
    for (const scene of scenes) appendActivity('updated', 'scene', scene.id, scene.title);
    return scenes;
  }

  function getScenes() { return scenes.slice(); }
  function getScene(idOrTitle) {
    const key = String(idOrTitle || '').trim().toLowerCase();
    if (!key) return null;
    return scenes.find((s) => s.id === idOrTitle)
      || scenes.find((s) => s.title.toLowerCase() === key)
      || scenes.find((s) => s.title.toLowerCase().includes(key))
      || null;
  }

  // ============ L3 画像 ============
  function setPersona(content) {
    persona = { version: 1, content: String(content || ''), updatedAt: Date.now() };
    writeJsonAtomic(personaPath, JSON.stringify(persona, null, 1));
    if (persona.content) appendActivity('updated', 'persona', 'persona', '用户画像');
  }
  function getPersona() { return persona && persona.content ? { ...persona } : null; }

  // ============ 活动流 / 记账 ============
  function appendActivity(verb, layer, id, title) {
    try {
      appendFileSync(activityPath, `${JSON.stringify({ ts: Date.now(), verb, layer, id, title: String(title || '').slice(0, 120) })}\n`, 'utf-8');
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
      scenes: scenes.length,
      hasPersona: Boolean(persona && persona.content),
      ...conversationStats(),
    };
  }

  function sessionState(sid) {
    if (!state.sessions[sid]) state.sessions[sid] = { count: 0, rounds: 0, lastExtractAt: 0, lastActivityAt: 0, backoffUntil: 0 };
    return state.sessions[sid];
  }
  function getState() { return state; }
  function saveState() { saveStateNow(); }

  function markDistilled(sid) {
    const s = sessionState(sid);
    s.lastExtractAt = Date.now();
    state.stats.lastDistillAt = Date.now();
    saveStateNow();
  }

  function wipe({ keepConversations = true } = {}) {
    records = [];
    scenes = [];
    persona = { version: 1, content: '', updatedAt: 0 };
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
    getPersona, setPersona,
    // 活动 / 记账
    appendActivity, recentActivity, appendUsage, usageSince,
    // 状态 / 统计 / 维护
    sessionState, getState, saveState, markDistilled, counts, wipe, newId,
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
