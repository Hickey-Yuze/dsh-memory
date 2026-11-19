// dsh-memory — 一键更新：在插件的真实安装目录执行 `git pull --ff-only`。
// 参照 dsh-cron-board 的 updater.js 改 ESM；dsh-memory 是纯 ESM 无 build 步骤，故无 pnpm build。

import { execFile } from 'node:child_process';
import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const LOG_LIMIT = 8000;
const PULL_TIMEOUT_MS = 120_000;
const MAX_UP = 8;

/** 非 git 检出（如直接拷目录）时给用户的手动命令。 */
export const MANUAL_UPDATE_CMD = 'cd ~/.dsh/plugins/dsh-memory && git pull';

const HERE = fileURLToPath(import.meta.url);

/** Windows/macOS 通用：标准插件目录 $HOME/.dsh/plugins/dsh-memory */
function standardPluginRoot() {
  try {
    return join(homedir(), '.dsh', 'plugins', 'dsh-memory');
  } catch {
    return null;
  }
}

function realDir(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * 从插件自身位置向上找 git 检出根。
 * @param start 可选起点；给定后只从该目录向上查找（不回落 cwd）。
 * 找不到返回 null —— 说明当前安装不是 git 检出，自动更新不可用。
 */
export function findRepoRoot(start) {
  const seeds = [];
  if (typeof start === 'string' && start !== '') {
    seeds.push(start);
  } else {
    seeds.push(dirname(HERE), process.cwd());
    const std = standardPluginRoot();
    if (std && !seeds.includes(std)) seeds.push(std); // node_modules 拷贝时也能命中标准插件目录
  }
  const visited = new Set();
  for (const rawSeed of seeds) {
    const seed = realDir(rawSeed);
    if (seed === null) continue;
    let dir = seed;
    for (let up = 0; up < MAX_UP; up += 1) {
      if (visited.has(dir)) break;
      visited.add(dir);
      if (existsSync(join(dir, '.git'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      const merged = [String(stdout ?? ''), String(stderr ?? '')]
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .join('\n');
      const log = merged.length > LOG_LIMIT ? merged.slice(merged.length - LOG_LIMIT) : merged;
      const errCode = err?.code;
      const code = err === null || err === undefined ? 0 : typeof errCode === 'number' ? errCode : 1;
      const timedOut = err?.killed === true;
      resolve({ code, log, timedOut });
    });
  });
}

function readVersion(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : '';
  } catch {
    return '';
  }
}

/**
 * 探测宿主是否支持自动重启（插件运行在宿主 Electron 主进程内时可用）。
 * 裸 Node（测试/非宿主环境）下 electron 模块不存在 → false，自动降级为手动重启提示。
 */
export async function canAutoRestart() {
  try {
    const mod = await import('electron');
    const app = mod && (mod.app || (mod.default && mod.default.app));
    return !!(app && typeof app.relaunch === 'function' && typeof app.exit === 'function');
  } catch {
    return false;
  }
}

/**
 * 触发宿主自动重启：与宿主自身 confirmAndRestart 后的动作一致
 * （app.relaunch() 以相同参数重新启动应用，app.exit(0) 立即退出当前进程）。
 * 失败（非 Electron 环境）静默返回 false，调用方降级为手动重启提示。
 */
export async function relaunchHost() {
  try {
    const mod = await import('electron');
    const app = mod && (mod.app || (mod.default && mod.default.app));
    if (!(app && typeof app.relaunch === 'function' && typeof app.exit === 'function')) return false;
    app.relaunch();
    app.exit(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行一键更新：git pull --ff-only（dsh-memory 无 build）。
 * @param start 可选的起点目录（测试用；默认从插件自身位置探测）。
 */
export async function applyUpdate(start) {
  const root = findRepoRoot(start);
  if (root === null) {
    return {
      ok: false,
      changed: false,
      version: '',
      needRestart: false,
      stage: 'locate',
      log: `当前安装不是 git 检出，无法自动更新。\n请手动执行：\n${MANUAL_UPDATE_CMD}`,
    };
  }
  const before = readVersion(root);
  const pull = await run('git', ['-C', root, 'pull', '--ff-only'], root, PULL_TIMEOUT_MS);
  if (pull.code !== 0) {
    const hint = pull.timedOut ? '\ngit pull 超时（网络过慢，或仓库需要认证）。' : '';
    return {
      ok: false,
      changed: false,
      version: before,
      needRestart: false,
      stage: 'pull',
      log: `${pull.log}${hint}`.trim(),
    };
  }
  // 已是最新：git 的固定文案，无需重启
  if (/Already up[ -]to[ -]date|已经是最新的/i.test(pull.log)) {
    return { ok: true, changed: false, version: before, needRestart: false, stage: 'pull', log: pull.log };
  }
  const after = readVersion(root);
  return {
    ok: true,
    changed: true,
    version: after === '' ? before : after,
    needRestart: true,
    stage: 'pull',
    log: `${pull.log}\n\n更新后版本：v${after === '' ? before : after}`.trim(),
  };
}
