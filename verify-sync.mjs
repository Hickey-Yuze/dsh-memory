// 跨设备同步端到端验证：起一个假 GitHub API（内存 Git），
// 让「Mac 设备」和「Windows 设备」两套 store 通过它上传/下载，验证合并结果。
//
// 用法：node verify-sync.mjs
// 不联网、不需要 token。

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './lib/store.js';
import { buildSnapshot, mergeSnapshots, uploadSnapshot, downloadSnapshot, applySnapshot, resolveDeviceId, recordTombstone, encodeSnapshot } from './lib/sync.js';

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push({ name, err: e }); console.log(`  ✖ ${name}\n    ${e.message}`); }
}
function section(t) { console.log(`\n== ${t}`); }

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

// ---------- 假 GitHub API（内存 git：blobs / trees / commits / refs / contents） ----------
function startFakeGitHub() {
  const blobs = new Map();     // sha -> Buffer
  const trees = new Map();     // sha -> { tree: [entries] }
  const commits = new Map();   // sha -> { tree, parents }
  const refs = new Map();      // 'heads/main' -> sha
  let seq = 0;
  const sha = (p) => `${p}${String(++seq).padStart(38, '0')}`;

  function treeOf(commitSha) {
    const c = commits.get(commitSha);
    if (!c) return null;
    return trees.get(c.tree);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(body);
    };
    // raw media type：直接回字节（对应真实 GitHub 的 application/vnd.github.raw）
    const sendRaw = (code, buf) => {
      res.writeHead(code, { 'content-type': 'application/octet-stream' });
      res.end(buf);
    };
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = {};
    try { body = raw.length ? JSON.parse(raw.toString('utf-8')) : {}; } catch { /* ignore */ }

    // GET /repos/:o/:r/contents/:path?ref=branch
    let m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m && req.method === 'GET') {
      const path = decodeURIComponent(m[1]);
      const ref = url.searchParams.get('ref') || 'main';
      const head = refs.get(`heads/${ref}`);
      if (!head) return send(404, { message: 'Not Found' });
      const t = treeOf(head);
      const entry = t && t.tree.find((e) => e.path === path);
      if (!entry) return send(404, { message: 'Not Found' });
      const buf = blobs.get(entry.sha);
      if (String(req.headers.accept || '').includes('application/vnd.github.raw')) return sendRaw(200, buf);
      return send(200, {
        type: 'file', path, sha: entry.sha, size: buf.length,
        encoding: 'base64', content: buf.toString('base64'),
      });
    }

    // POST /repos/:o/:r/git/blobs
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/blobs$/);
    if (m && req.method === 'POST') {
      const buf = Buffer.from(String(body.content || ''), 'base64');
      const s = sha('b');
      blobs.set(s, buf);
      return send(201, { sha: s });
    }

    // GET /repos/:o/:r/git/ref/heads/:branch
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/);
    if (m && req.method === 'GET') {
      const key = `heads/${decodeURIComponent(m[1])}`;
      const head = refs.get(key);
      if (!head) return send(404, { message: 'Not Found' });
      return send(200, { ref: `refs/${key}`, object: { sha: head, type: 'commit' } });
    }

    // POST /repos/:o/:r/git/trees
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/trees$/);
    if (m && req.method === 'POST') {
      const s = sha('t');
      trees.set(s, { tree: body.tree || [] });
      return send(201, { sha: s });
    }

    // POST /repos/:o/:r/git/commits
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/commits$/);
    if (m && req.method === 'POST') {
      const s = sha('c');
      commits.set(s, { tree: body.tree, parents: body.parents || [] });
      return send(201, { sha: s });
    }

    // GET /repos/:o/:r/git/commits/:sha
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/commits\/([0-9a-f]+)$/);
    if (m && req.method === 'GET') {
      const c = commits.get(m[1]);
      if (!c) return send(404, { message: 'Not Found' });
      return send(200, { sha: m[1], tree: { sha: c.tree } });
    }

    // PATCH /repos/:o/:r/git/refs/heads/:branch
    m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/);
    if (m && req.method === 'PATCH') {
      const key = `heads/${decodeURIComponent(m[1])}`;
      const head = refs.get(key);
      if (head && !commits.has(body.sha)) return send(422, { message: 'Invalid sha' });
      refs.set(key, body.sha);
      return send(200, { ref: `refs/${key}`, object: { sha: body.sha } });
    }

    return send(404, { message: `unhandled ${req.method} ${url.pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, refs, blobs });
    });
  });
}

const NOW = Date.now();
const days = (n) => NOW - n * 86400000;

async function main() {
  console.log('跨设备同步端到端验证（假 GitHub API，不联网）');
  const gh = await startFakeGitHub();
  const cfg = {
    sync: {
      repo: 'Hickey-Yuze/dsh-memory-sync',
      branch: 'main',
      token: 'fake-token',
      apiBase: `http://127.0.0.1:${gh.port}`,
    },
  };

  const dirA = mkdtempSync(join(tmpdir(), 'dsh-mem-syncA-'));
  const dirB = mkdtempSync(join(tmpdir(), 'dsh-mem-syncB-'));
  const storeA = createStore(dirA, silentLog());
  const storeB = createStore(dirB, silentLog());
  const devA = resolveDeviceId({}, dirA);
  const devB = resolveDeviceId({}, dirB);

  section('① Mac 上传 → Windows 同步');
  storeA.upsertRecord({ content: 'Mac 独有：用户在推进黄金矿工项目', family: 'work', kind: 'fact' });
  storeA.upsertRecord({ content: 'Mac 独有：偏好 pnpm', family: 'chat', kind: 'opinion' });
  storeA.setPersona('work', '## 工作准则\n- Mac 写的');
  storeA.upsertBias({ kind: 'judgment', scene: '黄金矿工', deviation: '误判', rootCause: '只看了单个版本', fix: '两两对比后再下结论' });
  // Windows 端本来也有自己的东西（否则没有可备份的文件）
  storeB.upsertRecord({ content: 'Win 原有：用户在做日历模块', family: 'work', kind: 'fact' });

  const snapA = buildSnapshot(storeA, dirA, { deviceId: devA, deviceName: 'Mac mini' });
  const up = await uploadSnapshot(cfg, snapA, { deviceId: devA, deviceName: 'Mac mini' });
  check('上传返回 commit 与字节数', () => {
    assert.ok(up.commitSha && up.commitSha.length >= 7);
    assert.ok(up.bytes > 0);
    assert.equal(up.manifest.records, 2);
  });

  const remote = await downloadSnapshot(cfg);
  check('远端快照可下载并解码', () => {
    assert.ok(remote, '远端快照应存在');
    assert.equal(remote.records.length, 2);
    assert.ok(remote.records.some((r) => /黄金矿工/.test(r.content)));
    assert.equal(remote.biases.length, 1);
  });

  const mergedB = mergeSnapshots(buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' }), remote);
  const resB = applySnapshot(storeB, dirB, mergedB.snapshot, { log: silentLog() });
  check('Windows 端合并后拿到 Mac 的记忆（且保留自己的）', () => {
    assert.equal(storeB.getRecords().length, 3);
    assert.ok(storeB.getRecords().some((r) => /黄金矿工/.test(r.content)));
    assert.ok(storeB.getRecords().some((r) => /日历模块/.test(r.content)));
    assert.equal(storeB.getPersona('work').content, '## 工作准则\n- Mac 写的');
    assert.equal(storeB.getBiases().length, 1);
  });
  check('落库前有备份可回滚', () => {
    assert.ok(resB.backups.length > 0);
    for (const b of resB.backups) assert.ok(existsSync(b), `备份应存在: ${b}`);
  });

  section('② Windows 追加自己的记忆 → 上传 → Mac 同步（双向）');
  storeB.upsertRecord({ content: 'Win 独有：用户在做跨端同步', family: 'work', kind: 'fact' });
  const snapB = buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' });
  const snapB2 = mergeSnapshots(snapB, remote);
  await uploadSnapshot(cfg, snapB2.snapshot, { deviceId: devB, deviceName: 'Win' });

  const remote2 = await downloadSnapshot(cfg);
  check('Windows 上传后远端含两台机器的记忆', () => {
    assert.equal(remote2.records.length, 4);
    assert.ok(remote2.records.some((r) => /黄金矿工/.test(r.content)));
    assert.ok(remote2.records.some((r) => /跨端同步/.test(r.content)));
    assert.ok(remote2.records.some((r) => /日历模块/.test(r.content)));
  });

  const mergedA = mergeSnapshots(buildSnapshot(storeA, dirA, { deviceId: devA, deviceName: 'Mac mini' }), remote2);
  applySnapshot(storeA, dirA, mergedA.snapshot, { log: silentLog() });
  check('Mac 同步后拿到 Windows 那条，两边一致', () => {
    assert.equal(storeA.getRecords().length, 4);
    assert.ok(storeA.getRecords().some((r) => /跨端同步/.test(r.content)));
  });

  section('③ 同一 id 内容冲突：晚更新者胜');
  // Mac 上把「黄金矿工」那条改新
  const gRecord = storeA.getRecords().find((r) => /黄金矿工/.test(r.content));
  storeA.upsertRecord({ id: gRecord.id, content: '黄金矿工项目：Mac 改了内容', family: 'work', kind: 'fact' });
  const snapA2 = buildSnapshot(storeA, dirA, { deviceId: devA, deviceName: 'Mac mini' });
  await uploadSnapshot(cfg, snapA2, { deviceId: devA, deviceName: 'Mac mini' });
  const remote3 = await downloadSnapshot(cfg);
  const mergedB2 = mergeSnapshots(buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' }), remote3);
  check('Mac 的较新内容覆盖 Windows 的旧内容', () => {
    const g = mergedB2.snapshot.records.find((r) => r.id === gRecord.id);
    assert.match(g.content, /Mac 改了内容/);
  });
  check('hits 取 max 而非累加', () => {
    const local = buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' });
    const r = local.records.find((x) => x.id === gRecord.id);
    const merged = mergeSnapshots(local, remote3);
    const m = merged.snapshot.records.find((x) => x.id === gRecord.id);
    assert.equal(m.hits, Math.max(r.hits, (remote3.records.find((x) => x.id === gRecord.id) || {}).hits || 0));
  });

  section('④ 删除传播：Mac 删一条 → Windows 同步后也删');
  const winRecord = storeA.getRecords().find((r) => /跨端同步/.test(r.content));
  storeA.deleteRecord(winRecord.id);
  recordTombstone(dirA, 'records', winRecord.id);   // 生产里由 /api-memory/records/delete 自动记
  const snapA3 = buildSnapshot(storeA, dirA, { deviceId: devA, deviceName: 'Mac mini' });
  await uploadSnapshot(cfg, snapA3, { deviceId: devA, deviceName: 'Mac mini' });
  const remote4 = await downloadSnapshot(cfg);
  const mergedB3 = mergeSnapshots(buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' }), remote4);
  applySnapshot(storeB, dirB, mergedB3.snapshot, { log: silentLog() });
  check('Windows 端该条被删除且不会复活', () => {
    assert.equal(storeB.getRecord(winRecord.id), null);
  });
  check('墓碑也合并进 Windows 的本地墓碑（下次同步不会复活）', () => {
    const t = JSON.parse(readFileSync(join(dirB, 'sync-tombstones.json'), 'utf-8'));
    assert.ok(t.records.includes(winRecord.id));
  });

  section('⑤ 幂等：同一份快照重复同步结果不变');
  const before = JSON.stringify(storeB.getRecords().map((r) => [r.id, r.content, r.hits]).sort());
  const again = mergeSnapshots(buildSnapshot(storeB, dirB, { deviceId: devB, deviceName: 'Win' }), remote4);
  applySnapshot(storeB, dirB, again.snapshot, { log: silentLog() });
  const after = JSON.stringify(storeB.getRecords().map((r) => [r.id, r.content, r.hits]).sort());
  check('重复同步不产生变化', () => { assert.equal(after, before); });

  section('⑥ 远端为空 / 不可用时的降级');
  const emptyCfg = { sync: { ...cfg.sync, branch: 'no-such-branch' } };
  const none = await downloadSnapshot(emptyCfg);
  check('远端无快照返回 null（不抛错）', () => { assert.equal(none, null); });
  const localOnly = mergeSnapshots(buildSnapshot(storeA, dirA, { deviceId: devA }), null);
  check('远端不可用时保留本机数据', () => {
    assert.equal(localOnly.snapshot.records.length, storeA.getRecords().length);
    assert.ok(localOnly.skipped);
  });

  section('⑦ 体积体检（真实库量级）');
  check('压缩后体积 < 未压缩的 70%（小样本 gzip 收益有限）', () => {
    const many = [];
    for (let i = 0; i < 500; i++) {
      many.push({
        id: `m${i}`, content: `第 ${i} 条记忆：用户在讨论某个具体的工作项目细节与决策过程，需要记录下来备查。`,
        tags: ['工作'], family: 'work', kind: 'fact', sessionId: 's1', sceneId: null,
        hits: 3, createdAt: NOW, updatedAt: NOW,
      });
    }
    const s = { version: 1, deviceId: 'd', deviceName: 'D', updatedAt: NOW, records: many, scenes: [], personas: { chat: null, work: null }, biases: [], deleted: { records: [], biases: [], scenes: [], updatedAt: NOW }, l0: null };
    const raw = Buffer.byteLength(JSON.stringify(s), 'utf-8');
    const gz = encodeSnapshot(s).length;
    assert.ok(gz < raw * 0.7, `gz=${gz} raw=${raw}`);
  });
  check('真实库量级（2000 条）压缩后 < 2MB', () => {
    const many = [];
    for (let i = 0; i < 2000; i++) {
      many.push({
        id: `m${i}`, content: `第 ${i} 条记忆：用户在讨论某个具体的工作项目细节与决策过程，需要记录下来备查以便后续检索与复用。`,
        tags: ['工作', '决策'], family: 'work', kind: 'fact', sessionId: 's1', sceneId: 'sc1',
        hits: 3, createdAt: NOW, updatedAt: NOW,
      });
    }
    const s = { version: 1, deviceId: 'd', deviceName: 'D', updatedAt: NOW, records: many, scenes: [], personas: { chat: null, work: null }, biases: [], deleted: { records: [], biases: [], scenes: [], updatedAt: NOW }, l0: null };
    const raw = Buffer.byteLength(JSON.stringify(s), 'utf-8');
    const gz = encodeSnapshot(s).length;
    console.log(`    （2000 条：原始 ${(raw / 1024 / 1024).toFixed(2)}MB → 压缩 ${(gz / 1024 / 1024).toFixed(2)}MB，${(raw / gz).toFixed(1)}×）`);
    assert.ok(gz < 2 * 1024 * 1024, `gz=${gz}`);
  });

  gh.server.close();
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });

  console.log(`\n通过 ${passed} / ${passed + failures.length}`);
  if (failures.length) {
    console.log('\n失败项：');
    for (const f of failures) console.log(` - ${f.name}: ${f.err.message}`);
    process.exit(1);
  }
}

function require_gz(snapshot) {
  return encodeSnapshot(snapshot).length;
}

main().catch((e) => { console.error(e); process.exit(1); });
