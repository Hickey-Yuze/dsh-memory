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
  registerRoutes(ctx, { store, pipeline, config, log, dataDir: dir });
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

test('rebuild / records/delete / wipe', async (t) => {
  const { store, routes } = await setup(t);
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
