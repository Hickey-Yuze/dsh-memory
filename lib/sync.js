// dsh-memory — 跨设备同步（GitHub 快照式同步）
//
// 场景：Mac 与 Windows 各装一份 dsh-memory，平时只用一台；用完点「上传」，
// 另一台点「同步」把对方那份拉回来合并。两台不同时用。
//
// 为什么是「快照 + 合并」而不是「事件日志」：
//   用户的实际用法是轮流用（不是同时写），所以没必要把 store 改成 append-only
//   事件日志（那是一次大改，且会动到热路径）。快照 + 合并已经能覆盖这个用法。
//
// 为什么不能用文件夹同步（Syncthing / iCloud / Dropbox）：
//   records.json 等是「整表原子写」（tmp → rename）。同步器同步的是文件块，
//   两台各写一次后写的整表覆盖先写的 —— 不是丢几条，是丢两千多条。
//   这里的做法是「显式上传 / 显式拉取 + 语义合并」，绕开整表覆盖。
//
// 远端布局（GitHub 仓库内）：
//   memory-sync/snapshot.json.gz   合并快照（gzip，base64 存进 blob）
//   memory-sync/manifest.json      { version, deviceId, deviceName, updatedAt, records, scenes, ... }
//   memory-sync/devices/<id>.json  各设备最近一次上传的元信息（便于排查）
//
// 合并规则（拉取时）：
//   L1 记忆 / 偏差档案：按 id 并集；同 id 取 updatedAt 晚者；
//                       hits 取 max（本地召回计数，累加会重复膨胀）；
//                       删除靠墓碑（deletedIds）传播。
//   L2 场景：按 id 并集；同 id 取 updatedAt 晚者；成员取并集（避免丢成员）。
//   L3 画像：按族取 updatedAt 晚者（画像是整体重写的，混拼无意义）。
//   L0 会话：按会话文件并集（文件名=会话 id，跨机天然不撞）。
//
// 设备本地（绝不同步）：
//   session-modes.json（会话 id 两边不同）· recall-dedupe.json（同上）
//   vectors.json（对应本机 embedding 配置）· kb-index.json（内含绝对路径）
//   state.json 的 sessions 段（会话 id）、activity/usage/merge-log（本地日志）

import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

export const SYNC_VERSION = 1;
export const SNAPSHOT_PATH = 'memory-sync/snapshot.json.gz';
export const MANIFEST_PATH = 'memory-sync/manifest.json';
export const DEVICES_DIR = 'memory-sync/devices';

/** 会同步的记忆资产（其余一律设备本地）。 */
export const SYNCED_FILES = ['records.json', 'scenes.json', 'persona.json', 'bias.json'];

/** 设备本地、绝不同步的文件（写在这里是为了让设置页能显式告诉用户）。 */
export const LOCAL_ONLY_FILES = [
  'session-modes.json',   // 会话档位：会话 id 两边不同
  'recall-dedupe.json',   // 已注入去重：会话 id 两边不同
  'vectors.json',         // 嵌入向量：对应本机 embedding 配置
  'kb-index.json',        // 知识库索引：内含本机绝对路径
  'state.json',           // 蒸馏水位/统计/会话状态：会话 id 两边不同
  'activity.jsonl',       // 本地活动流
  'usage.jsonl',          // 本地记账
  'merge-log.jsonl',      // 本地合并台账
  'sync-state.json',      // 上次同步结果（各机各自记）
  'config.json',          // 本机配置
];

/** 上次同步结果：只存本机，用来在面板上告诉用户「什么时候、同步了什么」。 */
export const SYNC_STATE_FILE = 'sync-state.json';

export function readSyncState(dataDir) {
  try {
    const raw = readFileSync(join(dataDir, SYNC_STATE_FILE), 'utf8');
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

export function writeSyncState(dataDir, patch) {
  const cur = readSyncState(dataDir);
  const next = { ...cur, ...(patch || {}) };
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, SYNC_STATE_FILE), JSON.stringify(next, null, 2));
  } catch { /* 记录失败不影响同步本身 */ }
  return next;
}

// ============ 设备身份 ============

/**
 * 记录一条删除墓碑 —— 本机删掉的记忆/偏差/场景要能传播到另一台机器，
 * 否则远端会把「已删除」当成「没这条」重新合回来。
 * 墓碑按类型追加，永不清理（体积极小，且清理需要跨机协调，反而会复活旧数据）。
 */
export function recordTombstone(dataDir, type, id) {
  if (!['records', 'biases', 'scenes'].includes(type) || !id) return;
  const file = join(dataDir, 'sync-tombstones.json');
  let t = { records: [], biases: [], scenes: [], updatedAt: 0 };
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf-8'));
      t = {
        records: Array.isArray(raw.records) ? raw.records : [],
        biases: Array.isArray(raw.biases) ? raw.biases : [],
        scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
        updatedAt: Number(raw.updatedAt || 0),
      };
    }
  } catch { /* 文件坏了就当空 */ }
  if (!t[type].includes(id)) t[type].push(id);
  t.updatedAt = Date.now();
  try {
    writeFileSync(file, JSON.stringify(t, null, 1), 'utf-8');
  } catch { /* 写不进去就只是这次删除不传播 */ }
}

/**
 * 稳定的设备 id：优先取配置里的 sync.deviceId；没有则用 dataDir 派生一个
 * （同一台机器的 dataDir 路径稳定 → id 稳定；换机 = 新 id = 新身份）。
 */
export function resolveDeviceId(cfg, dataDir) {
  const configured = cfg && cfg.sync && String(cfg.sync.deviceId || '').trim();
  if (configured) return configured;
  const h = createHash('sha256').update(String(dataDir || '')).digest('hex').slice(0, 12);
  return `dev_${h}`;
}

export function resolveDeviceName(cfg, deviceId) {
  const n = cfg && cfg.sync && String(cfg.sync.deviceName || '').trim();
  if (n) return n;
  try {
    return `${hostname() || 'device'}`;
  } catch {
    return deviceId;
  }
}

// ============ 快照构建 ============

/**
 * 从 dataDir 读取要同步的资产，打成一个内存快照对象。
 * 不含任何设备本地文件。
 */
export function buildSnapshot(store, dataDir, { deviceId, deviceName, includeL0 = false } = {}) {
  const records = store.getRecords().map((r) => ({
    id: r.id,
    content: r.content,
    tags: r.tags || [],
    family: r.family,
    kind: r.kind || 'fact',
    sessionId: r.sessionId || '',
    sceneId: r.sceneId || null,
    hits: r.hits || 0,
    createdAt: r.createdAt || 0,
    updatedAt: r.updatedAt || 0,
  }));
  const scenes = store.getScenes().map((s) => ({
    id: s.id,
    family: s.family,
    title: s.title,
    content: s.content,
    recordIds: s.recordIds || [],
    createdAt: s.createdAt || 0,
    updatedAt: s.updatedAt || 0,
  }));
  const personas = store.getPersonas();
  const biases = store.getBiases().map((b) => ({
    id: b.id,
    no: b.no,
    date: b.date,
    kind: b.kind,
    scene: b.scene,
    deviation: b.deviation,
    rootCause: b.rootCause,
    fix: b.fix,
    tags: b.tags || [],
    family: b.family,
    hits: b.hits || 0,
    createdAt: b.createdAt || 0,
    updatedAt: b.updatedAt || 0,
  }));

  const snap = {
    version: SYNC_VERSION,
    deviceId: deviceId || '',
    deviceName: deviceName || '',
    updatedAt: Date.now(),
    records,
    scenes,
    personas: {
      chat: personas.chat ? { content: personas.chat.content, updatedAt: personas.chat.updatedAt } : null,
      work: personas.work ? { content: personas.work.content, updatedAt: personas.work.updatedAt } : null,
    },
    biases,
    deleted: readTombstones(dataDir),
    l0: includeL0 ? collectL0(dataDir) : null,
  };
  return snap;
}

/** 读本地墓碑（删除传播用）。 */
function readTombstones(dataDir) {
  const file = join(dataDir, 'sync-tombstones.json');
  if (!existsSync(file)) return { records: [], biases: [], scenes: [], updatedAt: 0 };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    return {
      records: Array.isArray(raw.records) ? raw.records : [],
      biases: Array.isArray(raw.biases) ? raw.biases : [],
      scenes: Array.isArray(raw.scenes) ? raw.scenes : [],
      updatedAt: Number(raw.updatedAt || 0),
    };
  } catch {
    return { records: [], biases: [], scenes: [], updatedAt: 0 };
  }
}

/** 收集 L0 会话（可选；体积大，默认不同步）。 */
function collectL0(dataDir) {
  const dir = join(dataDir, 'conversations');
  if (!existsSync(dir)) return { files: [] };
  const files = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const p = join(dir, name);
      const st = statSync(p);
      files.push({ name, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
    }
  } catch { /* 忽略 */ }
  return { files };
}

// ============ 合并 ============

/**
 * 合并本地快照与远端快照。
 * 返回 { snapshot, stats } —— stats 记录各类资产的增删改数量。
 */
export function mergeSnapshots(local, remote) {
  const stats = {
    recordsAdded: 0, recordsUpdated: 0, recordsKept: 0, recordsRemoved: 0,
    scenesAdded: 0, scenesUpdated: 0, scenesKept: 0,
    biasesAdded: 0, biasesUpdated: 0, biasesKept: 0,
    personasUpdated: 0,
    tombstonesApplied: 0,
  };
  if (!remote || !Array.isArray(remote.records)) {
    return { snapshot: local, stats, skipped: '远端快照不可用' };
  }

  // —— L1 记忆 ——
  const recMap = new Map();
  for (const r of local.records || []) recMap.set(r.id, r);
  for (const r of remote.records || []) {
    const mine = recMap.get(r.id);
    if (!mine) { recMap.set(r.id, r); stats.recordsAdded += 1; continue; }
    if (Number(r.updatedAt || 0) > Number(mine.updatedAt || 0)) {
      // 远端更新：内容等以远端为准，但 hits 取 max（本地召回计数，累加会膨胀）
      recMap.set(r.id, { ...r, hits: Math.max(Number(mine.hits || 0), Number(r.hits || 0)) });
      stats.recordsUpdated += 1;
    } else {
      // 本地更新：hits 取 max
      mine.hits = Math.max(Number(mine.hits || 0), Number(r.hits || 0));
      stats.recordsKept += 1;
    }
  }

  // —— 墓碑：远端删掉的，本地也要删 ——
  const tombstones = mergeTombstones(local.deleted, remote.deleted, stats);
  for (const id of tombstones.records) {
    if (recMap.has(id)) { recMap.delete(id); stats.recordsRemoved += 1; }
  }

  // —— L2 场景 ——
  const sceneMap = new Map();
  for (const s of local.scenes || []) sceneMap.set(s.id, s);
  for (const s of remote.scenes || []) {
    const mine = sceneMap.get(s.id);
    if (!mine) { sceneMap.set(s.id, s); stats.scenesAdded += 1; continue; }
    if (Number(s.updatedAt || 0) > Number(mine.updatedAt || 0)) {
      // 成员取并集：远端更新场景时，本地独有的成员别丢
      const members = new Set([...(mine.recordIds || []), ...(s.recordIds || [])]);
      sceneMap.set(s.id, { ...s, recordIds: [...members] });
      stats.scenesUpdated += 1;
    } else {
      const members = new Set([...(mine.recordIds || []), ...(s.recordIds || [])]);
      mine.recordIds = [...members];
      stats.scenesKept += 1;
    }
  }
  for (const id of tombstones.scenes) {
    if (sceneMap.has(id)) { sceneMap.delete(id); stats.scenesRemoved += 1; }
  }

  // —— 偏差档案 ——
  const biasMap = new Map();
  for (const b of local.biases || []) biasMap.set(b.id, b);
  for (const b of remote.biases || []) {
    const mine = biasMap.get(b.id);
    if (!mine) { biasMap.set(b.id, b); stats.biasesAdded += 1; continue; }
    if (Number(b.updatedAt || 0) > Number(mine.updatedAt || 0)) {
      biasMap.set(b.id, { ...b, hits: Math.max(Number(mine.hits || 0), Number(b.hits || 0)) });
      stats.biasesUpdated += 1;
    } else {
      mine.hits = Math.max(Number(mine.hits || 0), Number(b.hits || 0));
      stats.biasesKept += 1;
    }
  }
  for (const id of tombstones.biases) {
    if (biasMap.has(id)) { biasMap.delete(id); stats.biasesRemoved += 1; }
  }

  // —— L3 画像：整体重写，取 updatedAt 晚者 ——
  const personas = { chat: null, work: null };
  for (const fam of ['chat', 'work']) {
    const mine = (local.personas && local.personas[fam]) || null;
    const theirs = (remote.personas && remote.personas[fam]) || null;
    if (!mine) { personas[fam] = theirs; if (theirs) stats.personasUpdated += 1; continue; }
    if (!theirs) { personas[fam] = mine; continue; }
    if (Number(theirs.updatedAt || 0) > Number(mine.updatedAt || 0)) {
      personas[fam] = theirs; stats.personasUpdated += 1;
    } else {
      personas[fam] = mine;
    }
  }

  const merged = {
    version: SYNC_VERSION,
    deviceId: local.deviceId || '',
    deviceName: local.deviceName || '',
    updatedAt: Date.now(),
    records: [...recMap.values()],
    scenes: [...sceneMap.values()],
    personas,
    biases: [...biasMap.values()],
    deleted: tombstones,
    l0: (local.l0 && local.l0.files && local.l0.files.length)
      ? local.l0
      : (remote.l0 || null),
    mergedFrom: [local.deviceId, remote.deviceId].filter(Boolean),
  };
  return { snapshot: merged, stats };
}

function mergeTombstones(local, remote, stats) {
  const out = { records: [], biases: [], scenes: [], updatedAt: Date.now() };
  const seen = { records: new Set(), biases: new Set(), scenes: new Set() };
  for (const src of [remote, local]) {
    const t = src || {};
    for (const id of t.records || []) if (!seen.records.has(id)) { seen.records.add(id); out.records.push(id); }
    for (const id of t.biases || []) if (!seen.biases.has(id)) { seen.biases.add(id); out.biases.push(id); }
    for (const id of t.scenes || []) if (!seen.scenes.has(id)) { seen.scenes.add(id); out.scenes.push(id); }
  }
  stats.tombstonesApplied = out.records.length + out.biases.length + out.scenes.length;
  return out;
}

// ============ 应用合并结果到本地 ============

/**
 * 把合并后的快照写回本地 store。
 * 写之前自动备份（records.json.bak-sync-<ts> 等），可回滚。
 */
export function applySnapshot(store, dataDir, snapshot, opts = {}) {
  // 一次性落盘：upsertRecord/deleteRecord 每次都整表写，几千条会挂几十秒到几分钟
  // （用户体感=点了同步没反应）。这里把整段收敛成一次写。
  store.beginBatch();
  try {
    return applySnapshotInner(store, dataDir, snapshot, opts);
  } finally {
    store.endBatch();
  }
}

function applySnapshotInner(store, dataDir, snapshot, { log } = {}) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const backups = [];
  for (const f of SYNCED_FILES) {
    const src = join(dataDir, f);
    if (!existsSync(src)) continue;
    try {
      const dst = join(dataDir, `${f}.bak-sync-${stamp}`);
      writeFileSync(dst, readFileSync(src));
      backups.push(dst);
    } catch (e) {
      if (log) log.warn(`同步备份失败 ${f}: ${e && e.message ? e.message : e}`);
    }
  }

  // L1：走 upsert 语义（保留 id），已删除的走 deleteRecord
  const existing = new Set(store.getRecords().map((r) => r.id));
  const incoming = new Map((snapshot.records || []).map((r) => [r.id, r]));
  for (const r of snapshot.records || []) {
    if (!existing.has(r.id)) {
      const { record } = store.upsertRecord({ ...r });
      if (record) {
        record.createdAt = r.createdAt || record.createdAt;
        record.updatedAt = r.updatedAt || record.updatedAt;
        record.hits = Math.max(Number(record.hits || 0), Number(r.hits || 0));
        record.sceneId = r.sceneId || null;
      }
    } else {
      // 同 id 已在本地：只更新内容字段（不覆盖本机 hits 计数之外的东西）
      store.upsertRecord({
        id: r.id,
        content: r.content,
        tags: r.tags,
        family: r.family,
        kind: r.kind,
        sessionId: r.sessionId,
        updatedAt: r.updatedAt,
      });
      const cur = store.getRecord(r.id);
      if (cur) {
        cur.hits = Math.max(Number(cur.hits || 0), Number(r.hits || 0));
        cur.sceneId = r.sceneId || null;
        cur.createdAt = r.createdAt || cur.createdAt;
      }
    }
  }
  // 墓碑：远端删掉的，本机也要删（删完把墓碑合并进本地墓碑文件，避免下次又被合回来）
  const deleted = snapshot.deleted || { records: [], biases: [], scenes: [] };
  for (const r of store.getRecords()) {
    if (!incoming.has(r.id) && (deleted.records || []).includes(r.id)) {
      store.deleteRecord(r.id);
    }
  }

  // L2：replaceScenes 会整族替换 → 先按族取出本地族 + 远端族合并
  for (const fam of ['chat', 'work']) {
    const merged = (snapshot.scenes || []).filter((s) => s.family === fam);
    if (!merged.length) continue;
    store.replaceScenes(merged, fam);
  }

  // L3
  for (const fam of ['chat', 'work']) {
    const p = snapshot.personas && snapshot.personas[fam];
    if (p && p.content) {
      const cur = store.getPersona(fam);
      if (!cur || Number(p.updatedAt || 0) > Number(cur.updatedAt || 0)) {
        store.setPersona(fam, p.content);
      }
    }
  }

  // 偏差档案
  for (const b of snapshot.biases || []) {
    const cur = store.getBias(b.id);
    if (!cur) store.upsertBias({ ...b });
    else if (Number(b.updatedAt || 0) > Number(cur.updatedAt || 0)) {
      store.upsertBias({ ...b, id: b.id });
    }
  }
  for (const id of snapshot.deleted?.biases || []) store.deleteBias(id);

  // 墓碑落盘
  try {
    writeFileSync(join(dataDir, 'sync-tombstones.json'), JSON.stringify(snapshot.deleted || {
      records: [], biases: [], scenes: [], updatedAt: Date.now(),
    }, null, 1), 'utf-8');
  } catch (e) {
    if (log) log.warn(`墓碑写入失败: ${e && e.message ? e.message : e}`);
  }

  return { backups };
}

// ============ 序列化 ============

export function encodeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot);
  return gzipSync(Buffer.from(json, 'utf-8'), { level: 6 });
}

export function decodeSnapshot(buffer) {
  const json = gunzipSync(Buffer.from(buffer)).toString('utf-8');
  return JSON.parse(json);
}

export function snapshotDigest(snapshot) {
  const json = JSON.stringify(snapshot);
  return createHash('sha256').update(json).digest('hex');
}

// ============ GitHub Git Data API ============

/**
 * 直接走 GitHub REST API（不用 git CLI —— Windows 上不一定装了 git，
 * 而插件本来就在跑 Node，fetch 就有）。
 *
 * 上传：blob → tree → commit → ref update
 * 下载：读 ref → commit → tree → blob
 */

function ghHeaders(cfg) {
  const token = cfg && cfg.sync && String(cfg.sync.token || '').trim();
  if (!token) throw new Error('未配置 GitHub token（设置页 → 维护 → 跨设备同步）');
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'dsh-memory-sync',
    authorization: `Bearer ${token}`,
  };
}

function ghApiBase(cfg) {
  const base = cfg && cfg.sync && String(cfg.sync.apiBase || '').trim();
  return (base || 'https://api.github.com').replace(/\/+$/, '');
}

/** 仓库坐标：owner/repo（也可带 .git 后缀）。 */
export function parseRepo(cfg) {
  const raw = cfg && cfg.sync && String(cfg.sync.repo || '').trim();
  if (!raw) throw new Error('未配置同步仓库（设置页 → 维护 → 跨设备同步）');
  const cleaned = raw.replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//, '').replace(/^git@github\.com:/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error(`仓库坐标不合法：${raw}（应为 owner/repo）`);
  return { owner: parts[0], repo: parts[1] };
}

async function ghFetch(cfg, path, options = {}) {
  const url = `${ghApiBase(cfg)}${path}`;
  const res = await fetch(url, { ...options, headers: { ...ghHeaders(cfg), ...(options.headers || {}) } });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data && data.message ? data.message : `HTTP ${res.status}`;
    const err = new Error(`GitHub API ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * 读某个路径上的 blob。
 * 不存在（404）→ 返回 null（远端还没快照，这是正常状态，不是错误）；
 * 其他错误（401/403/500）→ 抛出，带上状态码。
 */
async function readRemoteFile(cfg, path) {
  const { owner, repo } = parseRepo(cfg);
  const ref = cfg && cfg.sync && String(cfg.sync.branch || '').trim() || 'main';
  const url = `${ghApiBase(cfg)}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  // 用 raw media type 直接拿字节：默认的 JSON 形式会把内容 base64 再套一层 JSON，
  // 实测同一个 643KB 快照 887KB/39s → 643KB/27s，少等十来秒。
  const res = await fetch(url, { headers: { ...ghHeaders(cfg), accept: 'application/vnd.github.raw' } });
  if (res.status === 404) return null;   // 远端没有这个文件 = 还没上传过
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j && j.message ? `: ${j.message}` : ''; } catch { /* 非 JSON 响应 */ }
    const err = new Error(`GitHub API ${res.status}${detail}`);
    err.status = res.status;
    throw err;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // 目录路径会返回 JSON 数组（不是文件字节）→ 当作不存在
  const ct = String(res.headers.get('content-type') || '');
  if (ct.includes('application/json')) {
    try {
      const j = JSON.parse(buf.toString('utf-8'));
      if (Array.isArray(j) || (j && j.type && j.type !== 'file')) return null;
    } catch { /* 当字节用 */ }
  }
  return buf.length ? buf : null;
}

/** 上传：一次 commit 写入多个文件（Git Data API）。 */
async function writeRemoteFiles(cfg, files, message) {
  const { owner, repo } = parseRepo(cfg);
  const branch = cfg && cfg.sync && String(cfg.sync.branch || '').trim() || 'main';

  // 1) 建 blobs
  const treeEntries = [];
  for (const [path, content] of Object.entries(files)) {
    const b64 = Buffer.from(content).toString('base64');
    const blob = await ghFetch(cfg, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: b64, encoding: 'base64' }),
    });
    treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 2) 读当前 ref（拿到 base commit + base tree）
  // 远端已有提交（例如建仓时勾了 README）必须接在它的后面，否则新提交没有父级，
  // PATCH ref 会被 GitHub 判为「Update is not a fast forward」。
  let baseTree = null;
  let baseCommit = null;
  try {
    const refData = await ghFetch(cfg, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (refData && refData.object) {
      baseCommit = refData.object.sha;
      const commit = await ghFetch(cfg, `/repos/${owner}/${repo}/git/commits/${baseCommit}`);
      if (commit && commit.tree) baseTree = commit.tree.sha;
    }
  } catch (e) {
    // 404 = 分支还不存在（首次上传），从空树开始；401/403/网络等必须显式失败，
    // 否则会静默变成无父提交，最后报一个看不懂的 422。
    if (!(e && e.status === 404)) throw e;
  }

  // 3) 建 tree
  const tree = await ghFetch(cfg, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
  });

  // 4) 建 commit
  const commit = await ghFetch(cfg, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: message || 'dsh-memory sync',
      tree: tree.sha,
      parents: baseCommit ? [baseCommit] : undefined,
    }),
  });

  // 5) 更新 ref（分支还不存在时用 POST 创建，否则 PATCH 会 404）
  try {
    await ghFetch(cfg, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (e) {
    if (!(e && e.status === 404)) throw e;
    await ghFetch(cfg, `/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  return { commitSha: commit.sha, treeSha: tree.sha, files: treeEntries.length };
}

/** 上传快照到远端。 */
export async function uploadSnapshot(cfg, snapshot, { deviceId, deviceName, log } = {}) {
  const gz = encodeSnapshot(snapshot);
  const digest = snapshotDigest(snapshot);
  const manifest = {
    version: SYNC_VERSION,
    deviceId,
    deviceName,
    updatedAt: snapshot.updatedAt || Date.now(),
    digest,
    records: (snapshot.records || []).length,
    scenes: (snapshot.scenes || []).length,
    biases: (snapshot.biases || []).length,
    bytes: gz.length,
  };
  const res = await writeRemoteFiles(cfg, {
    [SNAPSHOT_PATH]: gz,
    [MANIFEST_PATH]: Buffer.from(JSON.stringify(manifest, null, 1), 'utf-8'),
    [`${DEVICES_DIR}/${deviceId}.json`]: Buffer.from(JSON.stringify({
      deviceId, deviceName, updatedAt: manifest.updatedAt, digest,
    }, null, 1), 'utf-8'),
  }, `dsh-memory sync from ${deviceName || deviceId} @ ${new Date().toISOString()}`);
  if (log) log.info(`同步上传完成: ${res.files} 个文件 / ${(gz.length / 1024).toFixed(0)}KB / commit ${res.commitSha.slice(0, 8)}`);
  return { ...res, manifest, bytes: gz.length };
}

/** 下载远端快照（不存在返回 null）。 */
export async function downloadSnapshot(cfg, { log } = {}) {
  const buf = await readRemoteFile(cfg, SNAPSHOT_PATH);
  if (!buf) return null;
  let snapshot;
  try {
    snapshot = decodeSnapshot(buf);
  } catch (e) {
    throw new Error(`远端快照解码失败：${e && e.message ? e.message : e}`);
  }
  if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('远端快照格式不合法');
  if (log) log.info(`同步下载完成: ${(snapshot.records || []).length} 条记忆 / ${(snapshot.scenes || []).length} 个场景`);
  return snapshot;
}

/** 读远端 manifest（用于设置页显示远端状态）。 */
export async function readRemoteManifest(cfg) {
  try {
    const buf = await readRemoteFile(cfg, MANIFEST_PATH);
    if (!buf) return null;
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return null;
  }
}
