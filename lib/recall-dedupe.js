// dsh-memory — 召回去重持久化（对齐 dsh-layered-memory recall-dedupe.ts 语义）：
// 同会话已注入过的记忆不再重复注入。内存 Set 权威 + 写穿 recall-dedupe.json，
// LRU 200 会话 / 单会话 512 id / 90 天过期；I/O 失败降级内存态。
// 粒度 = `${id}@${updatedAt}`（更新后的记忆天然获得新键、解除压制）；
// /compact 压缩或清空时 reset（模型上下文丢失 → 可重新注入），resume 不重置。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const MAX_SESSIONS = 200;
const MAX_IDS_PER_SESSION = 512;
const EXPIRE_MS = 90 * 24 * 3600_000;

export function createRecallDedupe(dataDir, log) {
  const filePath = join(dataDir, 'recall-dedupe.json');
  const sessions = new Map(); // sid -> Map<key, ts>
  let saveTimer = null;
  let failed = false;

  try {
    const raw = existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf-8')) : null;
    if (raw && raw.sessions && typeof raw.sessions === 'object') {
      const now = Date.now();
      for (const [sid, keys] of Object.entries(raw.sessions)) {
        if (!keys || typeof keys !== 'object') continue;
        const set = new Map();
        for (const [key, ts] of Object.entries(keys)) {
          if (now - (Number(ts) || 0) <= EXPIRE_MS) set.set(key, Number(ts) || now);
        }
        if (set.size > 0) sessions.set(sid, set);
      }
    }
  } catch {
    log.warn('recall-dedupe.json 读取失败（空表起步）');
  }

  function persist() {
    try {
      const now = Date.now();
      for (const [sid, set] of sessions) {
        for (const [key, ts] of set) {
          if (now - ts > EXPIRE_MS) set.delete(key);
        }
        if (set.size === 0) sessions.delete(sid);
      }
      while (sessions.size > MAX_SESSIONS) {
        const oldest = sessions.keys().next().value;
        sessions.delete(oldest);
      }
      const obj = {};
      for (const [sid, set] of sessions) obj[sid] = Object.fromEntries(set);
      writeJsonAtomic(filePath, JSON.stringify({ version: 1, sessions: obj }));
      failed = false;
    } catch (e) {
      if (!failed) {
        failed = true;
        log.warn(`召回去重持久化失败（降级内存态）: ${e.message || e}`);
      }
    }
  }

  function persistDebounced() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 500);
    if (typeof saveTimer.unref === 'function') saveTimer.unref();
  }

  return {
    /** 该会话已注入过的键集合（只读视图）。 */
    seen(sid) {
      return sessions.get(sid) || new Map();
    },
    has(sid, key) {
      return sessions.get(sid)?.has(key) || false;
    },
    /** 标记模型真实看到的记忆（预算截断后只标前缀）。 */
    mark(sid, keys) {
      let set = sessions.get(sid);
      if (!set) { set = new Map(); sessions.set(sid, set); }
      const now = Date.now();
      for (const key of keys) set.set(key, now);
      // 单会话上限：淘汰最旧
      while (set.size > MAX_IDS_PER_SESSION) {
        let oldestKey = null;
        let oldestAt = Infinity;
        for (const [key, ts] of set) {
          if (ts < oldestAt) { oldestKey = key; oldestAt = ts; }
        }
        if (!oldestKey) break;
        set.delete(oldestKey);
      }
      persistDebounced();
    },
    /** 压缩/清空：该会话压制全部解除。 */
    reset(sid) {
      if (sessions.delete(sid)) persistDebounced();
    },
    flush() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      persist();
    },
  };
}
