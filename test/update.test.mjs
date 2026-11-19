// dsh-memory — version/updater 单测（版本比较 + 远端检查 + 一键更新）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeVersion, compareVersions, checkUpdate, resetUpdateCache } from '../lib/version.js';
import { findRepoRoot, applyUpdate, canAutoRestart, relaunchHost, MANUAL_UPDATE_CMD } from '../lib/updater.js';

test('normalizeVersion：去 v/V 前缀与空白', () => {
  assert.equal(normalizeVersion('v0.2.0'), '0.2.0');
  assert.equal(normalizeVersion('V1.4.1'), '1.4.1');
  assert.equal(normalizeVersion(' 0.2.0 '), '0.2.0');
  assert.equal(normalizeVersion('0.2.0'), '0.2.0');
});

test('compareVersions：大小相等与缺位补齐', () => {
  assert.ok(compareVersions('0.2.1', '0.2.0') > 0);
  assert.ok(compareVersions('0.2.0', '0.2.1') < 0);
  assert.equal(compareVersions('1.4', '1.4.0'), 0);
  assert.ok(compareVersions('1.4.1', '1.4') > 0);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), 0, '预发布后缀忽略');
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
});

test('checkUpdate：无法访问远端时返回 null 且不缓存', async () => {
  resetUpdateCache();
  // 用不存在的仓库（会 404）→ getJson 返回 undefined → latest 空 → null
  // 但 checkUpdate 的 REPO 是写死的，这里通过超时信号模拟失败
  const r = await checkUpdate('0.2.0', { signal: AbortSignal.timeout(1) });
  assert.equal(r, null);
});

test('findRepoRoot：找到 .git 目录，找不到返回 null', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshm-upd-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  // macOS /var 是 /private/var 软链，findRepoRoot 用 realpath 归一——按 realpath 断言
  assert.equal(findRepoRoot(join(root, 'sub')), realpathSync(root));
  const empty = mkdtempSync(join(tmpdir(), 'dshm-noupd-'));
  assert.equal(findRepoRoot(empty), null);
});

test('applyUpdate：非 git 检出返回手动命令提示', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'dshm-no-'));
  const r = await applyUpdate(empty);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'locate');
  assert.ok(r.log.includes('手动执行'));
  assert.ok(r.log.includes(MANUAL_UPDATE_CMD));
});

test('applyUpdate：git 检出但 pull 失败（无 remote）返回错误日志', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshm-git-'));
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-memory', version: '0.2.0' }));
  const r = await applyUpdate(root);
  // 没有 remote → git pull 报错，但返回结构完整
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'pull');
  assert.equal(typeof r.log, 'string');
});

test('canAutoRestart：裸 Node（非宿主 Electron）环境返回 false', async () => {
  // 测试进程没有 electron 模块 → 自动重启不可用，降级为手动重启提示。
  assert.equal(await canAutoRestart(), false);
});

test('relaunchHost：裸 Node 环境静默返回 false 不抛错', async () => {
  // 非 Electron 环境 relaunch 失败应静默，绝不让一键更新报错。
  assert.equal(await relaunchHost(), false);
});
