// 路由单测：以桩 webServer 收集注册路由，直接调用 handler 验证数据面。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRoutes } from '../lib/routes.js';
import { createStore } from '../lib/store.js';
import { createConfig } from '../lib/config.js';
import { createExporter } from '../lib/export.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => ['line-1', 'line-2'], errors: () => [{ ts: Date.now(), message: 'boom' }], lastError: () => ({ ts: Date.now(), message: 'boom' }) };
}

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-routes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = silentLog();
  const store = createStore(dir, log);
  // 与 host.js 相同的 overlay 集成方式：config.json → createConfig 的 overlayStore
  const overlayStore = {
    read() {
      try { return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')); } catch { return {}; }
    },
  };
  const config = createConfig({}, overlayStore);
  const pipeline = { status: () => ({ busy: false, rebuild: null, sessionsInFlight: 0 }), startRebuild: async () => ({ started: false, reason: '无数据' }), cancelRebuild: () => false };
  const registered = [];
  const ctx = {
    effect(fn) {
      const dispose = fn();
      registered.push(...currentRegister);
      return dispose;
    },
    webServer: {
      register(route, _label) {
        currentRegister.push(route);
        return () => {};
      },
    },
  };
  let currentRegister = [];
  const exporter = createExporter({ store, config, log, dataDir: dir });
  registerRoutes(ctx, { store, pipeline, config, log, dataDir: dir, exporter });
  const routes = Object.fromEntries(registered.map((r) => [r.path, r.handler]));
  return { store, routes, dir };
}

function fakeRes() {
  const sink = { status: null, body: null };
  const res = {
    writeHead(status, _headers) { sink.status = status; return res; },
    end(body) { sink.body = JSON.parse(body); },
  };
  return { res, sink };
}

async function callGet(handler, query = '') {
  const { res, sink } = fakeRes();
  const req = new PassThrough();
  req.method = 'GET';
  req.url = `http://localhost${query}`;
  req.end();
  await handler(req, res);
  return sink;
}

async function callPost(handler, body) {
  const { res, sink } = fakeRes();
  const req = new PassThrough();
  req.method = 'POST';
  req.url = 'http://localhost';
  req.headers = { 'x-dsh-memory': '1' }; // 同源客户端自带（宿主端写操作守卫）
  req.end(JSON.stringify(body));
  await handler(req, res);
  return sink;
}

test('health / overview / assets / logs', async (t) => {
  const { store, routes } = await setup(t);
  store.upsertRecord({ content: '用户偏好 pnpm' });
  store.appendConversation('sx', 'user', 'pnpm 的记忆从哪来');
  const health = await callGet(routes['/api-memory/health']);
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.counts.records, 1);
  const overview = await callGet(routes['/api-memory/overview']);
  assert.ok(overview.body.counts.messages >= 1);
  const assets = await callGet(routes['/api-memory/assets'], '?type=memory&q=pnpm');
  assert.equal(assets.body.items.length, 1);
  assert.equal(assets.body.items[0].kind, 'memory');
  const logs = await callGet(routes['/api-memory/logs']);
  assert.deepEqual(logs.body.lines, ['line-1', 'line-2']);
});

test('config 读写 + 节级覆盖', async (t) => {
  const { routes } = await setup(t);
  const before = await callGet(routes['/api-memory/config']);
  assert.equal(before.body.effective.recall.maxResults, 5);
  const after = await callPost(routes['/api-memory/config'], { recall: { maxResults: 3, evil: 'x' } });
  assert.equal(after.body.ok, true);
  assert.equal(after.body.effective.recall.maxResults, 3);
  assert.equal(after.body.overlay.recall.evil, undefined);
  const reread = await callGet(routes['/api-memory/config']);
  assert.equal(reread.body.overlay.recall.maxResults, 3);
});

test('sync/status：含定时上传/同步 cron 字段', async (t) => {
  const { routes } = await setup(t);
  // 未配置时默认为空
  const st0 = await callGet(routes['/api-memory/sync/status']);
  assert.equal(st0.body.uploadCron, '');
  assert.equal(st0.body.downloadCron, '');
  // 写入 cron 后 status 回显
  const w = await callPost(routes['/api-memory/config'], { sync: { enabled: true, repo: 'h/y', token: 't', uploadCron: '0 4 * * *', downloadCron: '30 4 * * 0' } });
  assert.equal(w.body.ok, true);
  const st1 = await callGet(routes['/api-memory/sync/status']);
  assert.equal(st1.body.uploadCron, '0 4 * * *');
  assert.equal(st1.body.downloadCron, '30 4 * * 0');
  // 下次执行时间：每天 04:00 / 每周日 04:30
  assert.equal(typeof st1.body.nextUpload, 'number');
  assert.equal(st1.body.nextUploadText, '每天 04:00');
  assert.equal(st1.body.nextDownloadText, '每周 日 04:30');
  assert.equal(st1.body.nextUploadError, null);
  assert.equal(st1.body.nextDownloadError, null);
});

test('sync/status：非法 cron 返回错误提示', async (t) => {
  const { routes } = await setup(t);
  const w = await callPost(routes['/api-memory/config'], { sync: { enabled: true, repo: 'h/y', token: 't', uploadCron: '99 4 * * *' } });
  assert.equal(w.body.ok, true);
  const st1 = await callGet(routes['/api-memory/sync/status']);
  assert.equal(st1.body.nextUpload, null);
  assert.ok(st1.body.nextUploadError, '非法 cron 应返回错误文案');
});

test('cron/next：实时预览下次执行时间', async (t) => {
  const { routes } = await setup(t);
  const ok = await callGet(routes['/api-memory/cron/next'], '?expr=' + encodeURIComponent('3 23 * * *'));
  assert.equal(ok.body.ok, true);
  assert.equal(typeof ok.body.at, 'number');
  assert.equal(ok.body.text, '每天 23:03');
  const bad = await callGet(routes['/api-memory/cron/next'], '?expr=' + encodeURIComponent('99 23 * * *'));
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.error);
  const empty = await callGet(routes['/api-memory/cron/next']);
  assert.equal(empty.body.ok, false);
});

test('config 节内合并：token 不被未提交字段覆盖清空', async (t) => {
  const { routes } = await setup(t);
  // 先写入含 token 的 sync 节
  const w1 = await callPost(routes['/api-memory/config'], { sync: { enabled: true, repo: 'h/y', token: 'secret-token', uploadCron: '0 4 * * *', downloadCron: '30 4 * * *' } });
  assert.equal(w1.body.ok, true);
  // 再写只改 repo（不带 token）——token 必须保留
  const w2 = await callPost(routes['/api-memory/config'], { sync: { repo: 'h/z' } });
  assert.equal(w2.body.ok, true);
  assert.equal(w2.body.overlay.sync.token, 'secret-token', '未提交 token 不应被清空');
  assert.equal(w2.body.overlay.sync.repo, 'h/z', '已提交字段应更新');
  assert.equal(w2.body.overlay.sync.uploadCron, '0 4 * * *', '节内合并应保留其他既有字段');
  // 显式提交空 token 才算清空
  const w3 = await callPost(routes['/api-memory/config'], { sync: { token: '' } });
  assert.equal(w3.body.ok, true);
  assert.equal(w3.body.overlay.sync.token, '', '显式提交空 token 才清空');
});

test('rebuild / records/delete / wipe', async (t) => {  const { store, routes } = await setup(t);
  const rec = store.upsertRecord({ content: 'to-delete' }).record;
  const status = await callGet(routes['/api-memory/rebuild']);
  assert.equal(status.body.status.busy, false);
  const del = await callPost(routes['/api-memory/records/delete'], { id: rec.id });
  assert.equal(del.body.ok, true);
  assert.equal(store.getRecords().length, 0);
  const wipe = await callPost(routes['/api-memory/wipe'], { scope: 'assets' });
  assert.equal(wipe.body.ok, true);
  const bad = await callPost(routes['/api-memory/records/delete'], {});
  assert.equal(bad.body.ok, false);
});

test('update/check：返回当前版本与检查结果（结构完整，远端失败静默 null）', async (t) => {
  const { routes } = await setup(t);
  const r = await callGet(routes['/api-memory/update/check']);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  // value 可能是 null（网络不可用）或 {current, latest, hasUpdate, url}
  if (r.body.value !== null) {
    assert.equal(typeof r.body.value.current, 'string');
    assert.equal(typeof r.body.value.latest, 'string');
    assert.equal(typeof r.body.value.hasUpdate, 'boolean');
  }
});

test('update/apply：返回更新结果结构（非 git 检出返回手动命令）', async (t) => {
  const { routes } = await setup(t);
  const r = await callPost(routes['/api-memory/update/apply'], {});
  assert.equal(r.body.ok, true);
  assert.equal(typeof r.body.value.ok, 'boolean');
  assert.equal(typeof r.body.value.changed, 'boolean');
  assert.equal(typeof r.body.value.needRestart, 'boolean');
  assert.equal(typeof r.body.value.stage, 'string');
  assert.equal(typeof r.body.value.log, 'string');
});

test('export：status + 手动触发导出', async (t) => {
  const { store, routes, dir } = await setup(t);
  // 未配置目标目录 → status 返回配置为空，run 返回错误
  const st0 = await callGet(routes['/api-memory/export']);
  assert.equal(st0.body.status.enabled, false);
  const run0 = await callPost(routes['/api-memory/export'], {});
  assert.equal(run0.body.ok, false);
  assert.match(run0.body.error, /导出目录/);
});

test('export：配置 targetDir 后手动导出成功', async (t) => {
  const { store, routes, dir } = await setup(t);
  const targetDir = mkdtempSync(join(tmpdir(), 'dsh-mem-export-route-'));
  t.after(() => rmSync(targetDir, { recursive: true, force: true }));
  const cfgWrite = await callPost(routes['/api-memory/config'], { export: { enabled: true, cron: '0 3 * * *', targetDir } });
  assert.equal(cfgWrite.body.ok, true);
  const r1 = store.upsertRecord({ content: '路由导出测试记忆', family: 'work', kind: 'fact' });
  store.replaceScenes([{ id: 's1', family: 'work', title: '路由测试', content: '', recordIds: [r1.record.id] }], 'work');
  const run = await callPost(routes['/api-memory/export'], {});
  assert.equal(run.body.ok, true);
  assert.equal(run.body.files, 1);
  assert.equal(run.body.records, 1);
  const st = await callGet(routes['/api-memory/export']);
  assert.equal(st.body.status.enabled, true);
  assert.equal(st.body.status.cron, '0 3 * * *');
  assert.ok(st.body.status.lastExportAt > 0);
});

test('sync/test-proxy：空参数 / 非法格式 / 解析结果', async (t) => {
  const { routes } = await setup(t);
  // 空参数 → 400
  const empty = await callGet(routes['/api-memory/sync/test-proxy']);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.ok, false);
  assert.match(empty.body.error, /未填写代理地址/);
  // 非法格式 → 400
  const bad = await callGet(routes['/api-memory/sync/test-proxy'], '?proxy=abc://x');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /无法解析代理地址/);
  // 合法格式但连不上（本机无该代理）→ 返回 ok:false 且带错误与 ms
  const noConn = await callGet(routes['/api-memory/sync/test-proxy'], '?proxy=socks5://127.0.0.1:1');
  assert.equal(noConn.body.ok, false);
  assert.match(noConn.body.error, /代理连接失败|代理连通/);
  assert.equal(noConn.body.kind, 'socks5');
  assert.ok(noConn.body.ms != null);
});

// ============ 写操作守卫：跨站请求不能清库 ============

import { mutationAllowed, MUTATION_HEADER } from '../lib/routes.js';

const gateReq = (method, headers = {}) => ({ method, headers: { host: '127.0.0.1:43120', ...headers } });

test('写操作守卫：读放行，写必须带同源头，跨源一律拒', () => {
  assert.equal(mutationAllowed(gateReq('GET')).ok, true);
  assert.equal(mutationAllowed(gateReq('HEAD')).ok, true);

  const noHeader = mutationAllowed(gateReq('POST', { origin: 'https://evil.example' }));
  assert.equal(noHeader.ok, false);
  assert.match(noHeader.reason, /x-dsh-memory/);

  const crossOrigin = mutationAllowed(gateReq('POST', { [MUTATION_HEADER]: '1', origin: 'https://evil.example' }));
  assert.equal(crossOrigin.ok, false);
  assert.match(crossOrigin.reason, /跨源/);

  assert.equal(mutationAllowed(gateReq('POST', { [MUTATION_HEADER]: '1', origin: 'http://127.0.0.1:43120' })).ok, true);
  assert.equal(mutationAllowed(gateReq('POST', { [MUTATION_HEADER]: '1' })).ok, true);
  assert.equal(mutationAllowed(gateReq('DELETE', { [MUTATION_HEADER]: '1' })).ok, true);
});
