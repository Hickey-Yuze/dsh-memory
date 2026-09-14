// dsh-memory — 会话记忆档位（对齐 dsh-layered-memory 0.4.0 语义）：
//   MemoryMode = auto（双族自动）| chat（个人）| work（工作）| off（本会话对记忆系统隐身）。
// 按会话持久化到 session-modes.json（内存 Map 权威 + 写穿，串行化原子写）：
//   mode            档位；off 档捕获/召回/稳定区/工具全部静默（完全隐身）
//   recall          会话级注入覆盖（#38 只写不读）：true/false 强制开/关；缺省跟随全局。
//                   只影响读侧三闸门（召回注入 / 稳定区 / 读工具），捕获与蒸馏零感知
//   resume          暂停恢复快照：进 off 档记录暂停前的范围与注入覆盖，切回非 off 清空
// 存储失败只降级内存态（warn 不崩）；条目 90 天过期、上限 500 条（按 updatedAt 淘汰）。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './log.js';

const MODES = ['auto', 'chat', 'work', 'off'];
const PRUNE_MS = 90 * 24 * 3600_000;
const MAX_ENTRIES = 500;

export function isMemoryMode(v) {
  return typeof v === 'string' && MODES.includes(v);
}

/** 写入与召回同档的核心不变量：off 只影响读写闸门，档位决定族过滤范围。 */
export function familyOf(mode) {
  return mode === 'work' ? 'work' : mode === 'chat' ? 'chat' : 'auto';
}

export function createSessionModes(dataDir, { getDefaultMode, log }) {
  const file = join(dataDir, 'session-modes.json');
  const entries = new Map(); // sid -> { mode, recall, resume, updatedAt }
  let persistFailed = false;
  let writeTimer = null;
  let onModeChange = null;

  try {
    const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
    if (raw && raw.sessions && typeof raw.sessions === 'object') {
      const now = Date.now();
      let count = 0;
      for (const [sid, entry] of Object.entries(raw.sessions)) {
        // 条目存活的两种形态：有效档位覆盖，或仅注入（recall）覆盖——mode 缺省 = 跟随全局
        const hasMode = isMemoryMode(entry.mode);
        if (!hasMode && typeof entry.recall !== 'boolean') continue;
        if (now - (entry.updatedAt || 0) > PRUNE_MS) continue;
        entries.set(sid, {
          mode: hasMode ? entry.mode : undefined,
          recall: typeof entry.recall === 'boolean' ? entry.recall : undefined,
          resume: entry.resume && MODES.slice(0, 3).includes(entry.resume.scope)
            && (typeof entry.resume.recall === 'boolean' || entry.resume.recall === null)
            ? { scope: entry.resume.scope, recall: entry.resume.recall }
            : undefined,
          updatedAt: entry.updatedAt || now,
        });
        count++;
      }
      if (count > 0) log.info(`会话档位载入 ${count} 条`);
    }
  } catch {
    log.warn('session-modes.json 读取失败（空表起步）');
  }

  function persist() {
    try {
      const now = Date.now();
      for (const [sid, e] of entries) {
        if (now - e.updatedAt > PRUNE_MS) entries.delete(sid);
      }
      while (entries.size > MAX_ENTRIES) {
        let oldestSid = null;
        let oldestAt = Infinity;
        for (const [sid, e] of entries) {
          if (e.updatedAt < oldestAt) { oldestSid = sid; oldestAt = e.updatedAt; }
        }
        if (!oldestSid) break;
        entries.delete(oldestSid);
      }
      const sessions = {};
      for (const [sid, e] of entries) sessions[sid] = e;
      writeJsonAtomic(file, JSON.stringify({ version: 1, sessions }, null, 1));
      persistFailed = false;
    } catch (e) {
      if (!persistFailed) {
        persistFailed = true;
        log.warn(`会话档位持久化失败（降级内存态）: ${e.message || e}`);
      }
    }
  }

  function persistDebounced() {
    if (writeTimer) return;
    writeTimer = setTimeout(() => { writeTimer = null; persist(); }, 300);
    if (typeof writeTimer.unref === 'function') writeTimer.unref();
  }

  function defaultMode() {
    try {
      const mode = getDefaultMode ? getDefaultMode() : 'auto';
      return MODES.includes(mode) && mode !== 'off' ? mode : 'auto';
    } catch {
      return 'auto';
    }
  }

  return {
    /** 同步读取：未设置过的会话返回默认档（config.family）。 */
    get(sessionId) {
      return entries.get(sessionId)?.mode ?? defaultMode();
    },
    /** 会话级注入覆盖原始值：undefined = 未覆盖，跟随全局。 */
    getRecall(sessionId) {
      return entries.get(sessionId)?.recall;
    },
    /** 解析后的注入开关：会话覆盖 ?? 全局开关（部署级 cfg.recall.enabled 不经此处）。 */
    resolvedRecall(sessionId, globalRecall) {
      const override = entries.get(sessionId)?.recall;
      return typeof override === 'boolean' ? override : globalRecall;
    },
    /** 暂停恢复快照（无则 null）。 */
    getResume(sessionId) {
      return entries.get(sessionId)?.resume ?? null;
    },
    /** 设置会话档位（写穿持久化；切换回调同步通知管线落袋/挂起）。 */
    set(sessionId, mode) {
      if (!isMemoryMode(mode)) return;
      const old = this.get(sessionId);
      const prev = entries.get(sessionId);
      const recall = prev?.recall;
      let resume = prev?.resume;
      if (mode === 'off' && old !== 'off') {
        resume = { scope: old === 'off' ? 'auto' : old, recall: recall ?? null };
      } else if (mode !== 'off' && old === 'off') {
        resume = undefined; // 恢复
      }
      entries.set(sessionId, { mode, recall, resume, updatedAt: Date.now() });
      persistDebounced();
      if (old !== mode && onModeChange) {
        try { onModeChange(sessionId, old, mode); } catch (e) { log.warn(`档位切换回调失败: ${e.message || e}`); }
      }
    },
    /** 清除会话档位覆盖（跟随全局默认档；保留注入覆盖；off → 默认档走切换回调通知管线恢复）。 */
    clearMode(sessionId) {
      const prev = entries.get(sessionId);
      if (!prev || !isMemoryMode(prev.mode)) return;
      const old = prev.mode;
      const def = defaultMode();
      entries.set(sessionId, { mode: undefined, recall: prev.recall, resume: undefined, updatedAt: Date.now() });
      persistDebounced();
      if (old !== def && onModeChange) {
        try { onModeChange(sessionId, old, def); } catch (e) { log.warn(`档位切换回调失败: ${e.message || e}`); }
      }
    },
    /** 设置会话级注入覆盖（undefined = 清除覆盖跟随全局）。 */
    setRecall(sessionId, recall) {
      const entry = entries.get(sessionId);
      entries.set(sessionId, {
        mode: entry?.mode,
        recall: typeof recall === 'boolean' ? recall : undefined,
        resume: entry?.resume,
        updatedAt: Date.now(),
      });
      persistDebounced();
    },
    /** 档位切换回调（管线注册：切片落袋/挂起）。 */
    onModeChange(cb) { onModeChange = cb; },
    /** 停用侧分布（工作台洞察）：off = 档位暂停；wo = 只写（recall=false 且未暂停）。 */
    countStates() {
      let off = 0;
      let wo = 0;
      for (const e of entries.values()) {
        if (e.mode === 'off') off++;
        else if (e.recall === false) wo++;
      }
      return { off, wo };
    },
    /** 全部条目快照（设置页会话档位列表）。 */
    all() {
      return [...entries.entries()].map(([sid, e]) => ({ sid, ...e }));
    },
    /** 等待在途写完成（测试/停机用）。 */
    flush() {
      if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
      persist();
    },
  };
}
