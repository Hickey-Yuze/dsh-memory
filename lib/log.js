// dsh-memory — 诊断日志：info 级以上镜像到 <dataDir>/memory.log，
// 同时保留内存环形缓冲（供设置页诊断日志直接读取）与近期错误列表。

import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RING_LIMIT = 500;
const ERROR_LIMIT = 20;
const LOG_ROTATE_BYTES = 1024 * 1024;

export function createLogger(dataDir) {
  const ring = [];
  const recentErrors = [];
  let logPath = null;

  function fileLine(line) {
    if (!logPath) return;
    try {
      try {
        const st = statSync(logPath);
        if (st.size > LOG_ROTATE_BYTES) renameSync(logPath, `${logPath}.1`);
      } catch { /* 不存在则直接写 */ }
      appendFileSync(logPath, line, 'utf-8');
    } catch { /* 日志失败绝不影响主流程 */ }
  }

  function push(level, message) {
    const ts = new Date().toISOString();
    const text = typeof message === 'string' ? message : safeJson(message);
    const line = `${ts} [${level}] ${text}`;
    ring.push(line);
    if (ring.length > RING_LIMIT) ring.splice(0, ring.length - RING_LIMIT);
    if (level === 'error') {
      recentErrors.push({ ts, message: text.slice(0, 500) });
      if (recentErrors.length > ERROR_LIMIT) recentErrors.splice(0, recentErrors.length - ERROR_LIMIT);
    }
    if (level !== 'debug') fileLine(`${line}\n`);
    return line;
  }

  return {
    /** 数据目录就绪后接通文件镜像。 */
    attach(dir) {
      try {
        mkdirSync(dir, { recursive: true });
        logPath = join(dir, 'memory.log');
      } catch { logPath = null; }
    },
    debug: (m) => push('debug', m),
    info: (m) => push('info', m),
    warn: (m) => push('warn', m),
    error: (m) => push('error', m),
    tail(n = 200) { return ring.slice(-Math.max(1, Math.min(n, RING_LIMIT))); },
    errors() { return recentErrors.slice(); },
    lastError() { return recentErrors.length > 0 ? recentErrors[recentErrors.length - 1] : null; },
  };
}

function safeJson(value) {
  try {
    // 活对象只取摘要，避免全量 stringify 卡顿
    if (value instanceof Error) return `${value.message}${value.stack ? ` :: ${String(value.stack).split('\n')[1] || ''}` : ''}`;
    if (value && typeof value === 'object') return JSON.stringify(value, (k, v) => (typeof v === 'function' ? '[fn]' : v), 0).slice(0, 800);
    return String(value);
  } catch {
    return String(value);
  }
}

export function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, filePath);
}
