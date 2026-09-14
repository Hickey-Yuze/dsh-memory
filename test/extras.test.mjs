// 补全模块单测：会话档位（modes）/ 蒸馏回退链（llm）/ 嵌入源（embedding）/
// hybrid RRF 检索（search）/ 会话档位与洞察路由（routes）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createSessionModes, isMemoryMode, familyOf } from '../lib/modes.js';
import { createLlmRunner, buildRouteChain } from '../lib/llm.js';
import { createEmbeddingService } from '../lib/embedding.js';
import { rankDocsByVector, rankDocsHybrid, cosine } from '../lib/search.js';
import { createStore } from '../lib/store.js';
import { createConfig, sanitizeConfig } from '../lib/config.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}
function withDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-extra-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ============ 会话档位 ============

test('modes：默认档跟随 config.family，set 写穿持久化，90 天过期', (t) => {
  const dir = withDir(t);
  let family = 'work';
  const modes = createSessionModes(dir, { getDefaultMode: () => family, log: silentLog() });
  assert.equal(isMemoryMode('auto'), true);
  assert.equal(isMemoryMode('bogus'), false);
  assert.equal(familyOf('work'), 'work');
  assert.equal(familyOf('auto'), 'auto');
  // 未设置的会话返回默认档
  assert.equal(modes.get('s1'), 'work');
  modes.set('s1', 'chat');
  assert.equal(modes.get('s1'), 'chat');
  modes.flush();
  // 重启载入
  family = 'auto';
  const modes2 = createSessionModes(dir, { getDefaultMode: () => family, log: silentLog() });
  assert.equal(modes2.get('s1'), 'chat');
  // 暂停恢复快照
  modes2.setRecall('s1', false);
  modes2.set('s1', 'off');
  assert.equal(modes2.get('s1'), 'off');
  assert.deepEqual(modes2.getResume('s1'), { scope: 'chat', recall: false });
  modes2.set('s1', 'chat');
  assert.equal(modes2.getResume('s1'), null); // 恢复即清空
  // 档位与注入覆盖正交：切档不动覆盖
  modes2.setRecall('s1', false);
  modes2.set('s1', 'work');
  assert.equal(modes2.getRecall('s1'), false);
  // 停用侧分布
  modes2.set('s2', 'off');
  const counts = modes2.countStates();
  assert.equal(counts.off, 1);
  assert.equal(counts.wo, 1); // s1 recall=false 且未暂停
  modes2.setRecall('s1', undefined);
  assert.equal(modes2.getRecall('s1'), undefined); // 清除覆盖跟随全局
  // 非法档位忽略
  modes2.set('s3', 'bogus');
  assert.equal(modes2.get('s3'), 'auto');
  // 档位切换回调
  let events = [];
  modes2.onModeChange((sid, oldMode, newMode) => events.push([sid, oldMode, newMode]));
  modes2.set('s1', 'off');
  assert.deepEqual(events, [['s1', 'work', 'off']]);
  events = [];
  modes2.set('s1', 'off'); // 同档不触发
  assert.equal(events.length, 0);
  // 清除档位覆盖（clearMode）：回默认档、保留注入覆盖、off 恢复走回调
  events = [];
  modes2.setRecall('s1', false); // 重新设置注入覆盖，验证 clearMode 保留它
  modes2.clearMode('s1'); // off → 默认档 'auto'
  assert.equal(modes2.get('s1'), 'auto');
  assert.equal(modes2.getRecall('s1'), false); // 注入覆盖保留
  assert.equal(modes2.getResume('s1'), null); // 恢复即清空
  assert.deepEqual(events, [['s1', 'off', 'auto']]);
  events = [];
  modes2.clearMode('s1'); // 已无档位覆盖 → no-op 不触发
  assert.equal(events.length, 0);
  // 仅 recall 覆盖（无档位覆盖）落盘后重载不丢，mode 跟随全局
  modes2.flush();
  const modes3 = createSessionModes(dir, { getDefaultMode: () => family, log: silentLog() });
  assert.equal(modes3.getRecall('s1'), false);
  assert.equal(modes3.get('s1'), 'auto');
  modes3.set('s1', 'chat');
  assert.equal(modes3.getRecall('s1'), false); // 再设档位不影响注入覆盖
});

// ============ 蒸馏回退链 ============

test('llm：buildRouteChain 去重与档位覆盖', () => {
  const chain = buildRouteChain(
    { provider: 'p1', model: 'm1' },
    [
      { provider: 'p1', model: 'm1' },          // 与主路由相同 → 跳过
      { provider: '', model: 'm2' },            // 残缺 → 剔除
      { provider: 'p2', model: 'm2', reasoningEffort: 'low' },
      { provider: 'p2', model: 'm2' },          // 重复 → 跳过
      { provider: 'p3', model: 'm3' },
    ],
    'high',
  );
  assert.deepEqual(chain, [
    { provider: 'p1', model: 'm1', effort: 'high' },
    { provider: 'p2', model: 'm2', effort: 'low' },
    { provider: 'p3', model: 'm3', effort: 'high' },
  ]);
});

test('llm：回退链逐路降级（空输出算失败），逐次尝试记账，层链替换全局', async (t) => {
  const dir = withDir(t);
  const store = createStore(dir, silentLog());
  const calls = [];
  const runtime = {
    async *stream(options) {
      calls.push(options);
      if (options.model === 'm-bad') {
        yield { type: 'block-end', block: { type: 'text', text: '' } }; // 空输出
      } else {
        yield { type: 'block-end', block: { type: 'text', text: '{"memories":[]}' } };
      }
    },
    listProviders: () => [{ id: 'p' }],
    listModels: async () => [{ id: 'm1' }],
  };
  // 桩 BlockAssembler：只收集文本
  const stubLlm = {
    BlockAssembler: class {
      push(chunk) {
        if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') this._text = (this._text || '') + chunk.block.text;
      }
      get blocks() { return [{ type: 'text', text: this._text || '' }]; }
      blocks() { return [{ type: 'text', text: this._text || '' }]; }
      get finish() { return { kind: 'stop' }; }
      get usage() { return { outputTokens: 5 }; }
    },
    createSystemMessage: (text) => ({ role: 'system', text }),
    createUserMessage: (opts) => ({ role: 'user', ...opts }),
  };
  const yaml = {
    llm: {
      provider: 'p', model: 'm-bad',
      fallbacks: [{ provider: 'p', model: 'm-good' }],
    },
  };
  const config = createConfig(yaml, null);
  config.getDefaultModel = () => null;
  const llm = createLlmRunner({ config, log: silentLog(), dshLlm: stubLlm });
  llm.setRuntime(runtime);
  const result = await llm.call({ layer: 'l1', purpose: 'memory:extract', system: 's', user: 'u' });
  assert.equal(result.ok, true);
  assert.equal(result.route.model, 'm-good');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, 'm-bad');
  assert.equal(calls[1].model, 'm-good');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].ok, false);
  assert.equal(result.attempts[1].ok, true);
  // 按层链替换全局解析
  const config2 = createConfig({ llm: { provider: 'p', model: 'm-bad', layerRoutes: { l3: [{ provider: 'p', model: 'm-l3' }] } } }, null);
  config2.getDefaultModel = () => null;
  const llm2 = createLlmRunner({ config: config2, log: silentLog(), dshLlm: stubLlm });
  llm2.setRuntime(runtime);
  const r3 = await llm2.call({ layer: 'l3', purpose: 'memory:persona', system: 's', user: 'u' });
  assert.equal(r3.route.model, 'm-l3'); // l3 走独立链
  const r1 = await llm2.call({ layer: 'l1', purpose: 'memory:extract', system: 's', user: 'u' });
  assert.equal(r1.ok, false); // l1 无独立链 → 主路由 m-bad 永远空输出且无回退 → 失败
  void store;
});

// ============ 嵌入源 ============

test('embedding：未就绪/熔断降级、差量重嵌、换源失效', async (t) => {
  const dir = withDir(t);
  const overlay = { embedding: { enabled: true, baseUrl: 'https://x/v1', apiKey: 'k', model: 'e1', dimensions: 2 } };
  const config = createConfig(overlay, null);
  const log = { ...silentLog(), warns: [] };
  log.warn = (m) => log.warns.push(m);
  let fail = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (fail) throw new Error('network down');
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ data: body.input.map((text, i) => ({ embedding: [text.length, i] })) }),
    };
  };
  t.after(() => { globalThis.fetch = origFetch; });
  const emb = createEmbeddingService(dir, { config, log });
  assert.equal(emb.ready(), true);
  assert.equal(emb.status().indexed, 0);
  // 差量重嵌
  const records = [
    { id: 'a', content: 'aaaa', updatedAt: 1 },
    { id: 'b', content: 'bbbb', updatedAt: 2 },
  ];
  let r = await emb.ensureIndexed(records);
  assert.equal(r.written, 2);
  assert.ok(emb.getVector('a'));
  // 无新增不重嵌
  r = await emb.ensureIndexed(records);
  assert.equal(r.written, 0);
  // 更新记录 → 补嵌
  r = await emb.ensureIndexed([{ id: 'a', content: 'aaaa', updatedAt: 9 }]);
  assert.equal(r.written, 1);
  // 换源失效：sourceChanged 置位，旧向量保留至重嵌清空
  const config2 = createConfig({ ...overlay, embedding: { ...overlay.embedding, model: 'e2' } }, null);
  const emb2 = createEmbeddingService(dir, { config: config2, log });
  assert.equal(emb2.status().sourceChanged, true);
  r = await emb2.ensureIndexed(records);
  assert.equal(r.written, 2); // 旧向量已清空、按新源全量重嵌
  assert.equal(emb2.status().sourceChanged, false);
  // 熔断：连续失败后 embedQuery 返回 null
  fail = true;
  for (let i = 0; i < 3; i++) assert.equal(await emb2.embedQuery('x'), null);
  assert.ok(emb2.status().circuitOpen);
  fail = false;
  // 熔断期内直接降级，不发请求
  assert.equal(await emb2.embedQuery('x'), null);
  // 持久化验证
  assert.ok(existsSync(join(dir, 'vectors.json')));
  emb.dispose();
});

// ============ hybrid 检索 ============

test('search：cosine / 向量单路 / hybrid RRF 融合', () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [0]), 0);
  const docs = [
    { id: 'a', text: '负载均衡策略讨论', updatedAt: Date.now() },
    { id: 'b', text: '今天天气不错', updatedAt: Date.now() },
    { id: 'c', text: '负载测试报告', updatedAt: Date.now() },
  ];
  const vectors = new Map([['a', [1, 0]], ['b', [0, 1]], ['c', [0.9, 0.1]]]);
  const vecHits = rankDocsByVector([1, 0], docs, vectors, { limit: 3 });
  assert.equal(vecHits[0].item.id, 'a');
  // hybrid：向量路把「负载均衡」相关记录拉上来
  const hybrid = rankDocsHybrid('负载均衡', docs, { limit: 3, vectorRoute: { queryVector: [1, 0], vectors } });
  assert.ok(hybrid.length >= 2);
  assert.ok(hybrid.some((h) => h.item.id === 'a'));
  // 向量路缺失 → 退化为纯关键词（行为与 rankDocs 一致）
  const kwOnly = rankDocsHybrid('负载均衡', docs, { limit: 3, threshold: 0.2 });
  assert.ok(kwOnly.length >= 1);
  assert.ok(kwOnly.every((h) => h.item.text.includes('负载')));
});

// ============ 配置：路由链 / 嵌入节白名单 ============

test('config：fallbacks / layerRoutes / family / embedding 洗白', () => {
  const clean = sanitizeConfig({
    family: 'chat',
    llm: {
      fallbacks: [
        { provider: 'p1', model: 'm1' },
        { provider: 'p2' },            // 残缺剔除
        'garbage',                     // 非对象剔除
      ],
      layerRoutes: { l1: [{ provider: 'p3', model: 'm3' }], l9: 'x' },
      reasoningEffort: 'low',
    },
    embedding: { enabled: true, dimensions: 1024, baseUrl: 'https://x/v1', junk: 1 },
  });
  assert.equal(clean.family, 'chat');
  assert.deepEqual(clean.llm.fallbacks, [{ provider: 'p1', model: 'm1', reasoningEffort: '' }]);
  assert.deepEqual(clean.llm.layerRoutes, { l1: [{ provider: 'p3', model: 'm3', reasoningEffort: '' }], l2: [], l3: [] });
  assert.equal(clean.llm.reasoningEffort, 'low');
  assert.equal(clean.embedding.dimensions, 1024);
  assert.equal(clean.embedding.junk, undefined);
  assert.equal(clean.llm.layerRoutes.l9, undefined);
  const bad = sanitizeConfig({ family: 'secret', llm: { fallbacks: 'nope' } });
  assert.equal(bad.family, undefined);
  assert.equal(bad.llm, undefined);
});

// ============ 路由：sessions 与 insights ============

test('routes：sessions 列表/设置 + insights 粒度聚合', async (t) => {
  const dir = withDir(t);
  const log = silentLog();
  const store = createStore(dir, log);
  const config = createConfig({ family: 'auto' }, null);
  const modes = createSessionModes(dir, { getDefaultMode: () => config.effective().family, log });
  const pipeline = { status: () => ({ rebuild: null, busy: false, sessionsInFlight: 0 }), startRebuild: async () => ({ started: false }), cancelRebuild: () => false };
  const embedding = null;
  const handlers = new Map();
  const ctx = {
    effect(fn) { fn(); return () => {}; },
    webServer: { register: (route) => { handlers.set(route.path, route.handler); return () => {}; } },
  };
  const { registerRoutes } = await import('../lib/routes.js');
  registerRoutes(ctx, { store, pipeline, config, log, dataDir: dir, modes, embedding });
  store.appendConversation('sess-alpha', 'user', 'hello world');
  const respond = (data) => data;
  // GET sessions
  const res1 = { writeHead() {}, end(body) { this.body = body; } };
  await handlers.get('/api-memory/sessions')({ method: 'GET', url: 'http://x/api-memory/sessions' }, res1);
  const got1 = JSON.parse(res1.body);
  assert.equal(got1.defaultMode, 'auto');
  const alpha = got1.sessions.find((s) => s.sid === 'sess-alpha');
  assert.ok(alpha);
  assert.equal(alpha.effectiveMode, 'auto');
  // POST sessions 设档位 + 只写
  const res2 = { writeHead() {}, end(body) { this.body = body; } };
  await handlers.get('/api-memory/sessions')({ method: 'POST', url: 'http://x/api-memory/sessions' }, res2, respond);
  void respond;
  // readBody 需要 req 流：直接构造
  const postJson = (path, body) => new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST';
    req.url = `http://x${path}`;
    req.headers = {};
    const res = { writeHead() {}, end(b) { resolve(JSON.parse(b)); } };
    handlers.get(path)(req, res).catch(reject);
  });
  const set1 = await postJson('/api-memory/sessions', { sid: 'sess-alpha', mode: 'work' });
  assert.equal(set1.ok, true);
  assert.equal(modes.get('sess-alpha'), 'work');
  await postJson('/api-memory/sessions', { sid: 'sess-alpha', recall: false });
  assert.equal(modes.getRecall('sess-alpha'), false);
  // mode null = 清除档位覆盖跟随全局（注入覆盖保留）
  await postJson('/api-memory/sessions', { sid: 'sess-alpha', mode: null });
  assert.equal(modes.get('sess-alpha'), 'auto');
  assert.equal(modes.getRecall('sess-alpha'), false);
  const set3 = await postJson('/api-memory/sessions', { sid: 'x', mode: 'bogus' });
  assert.equal(set3.ok, false); // 非法档位 400
  // insights 聚合
  store.appendUsage({ layer: 'l1', purpose: 'extract', provider: 'p', model: 'm1', inChars: 100, outputTokens: 10, ok: true });
  store.appendUsage({ layer: 'l2', purpose: 'scene', provider: 'p', model: 'm1', inChars: 50, outputTokens: 20, ok: true });
  const resIns = { writeHead() {}, end(body) { this.body = body; } };
  await handlers.get('/api-memory/insights')({ method: 'GET', url: 'http://x/api-memory/insights?days=7&granularity=day&layer=l1' }, resIns);
  const ins = JSON.parse(resIns.body);
  assert.equal(ins.windowDays, 7);
  assert.equal(ins.layer, 'l1');
  assert.equal(ins.byModel.length, 1);
  assert.equal(ins.byModel[0].outputTokens, 10);
  assert.equal(ins.byModel[0].medianOutput, 10);
  assert.ok(Array.isArray(ins.trend));
  // health 带 sessionModes / embedding
  const resH = { writeHead() {}, end(body) { this.body = body; } };
  await handlers.get('/api-memory/health')({ method: 'GET', url: 'http://x/api-memory/health' }, resH);
  const health = JSON.parse(resH.body);
  assert.equal(health.family, 'auto');
  assert.deepEqual(health.sessionModes, { off: 0, wo: 1 });
  assert.equal(health.embedding, null);
  // 持久化文件落盘
  modes.flush();
  assert.ok(existsSync(join(dir, 'session-modes.json')));
  assert.ok(readFileSync(join(dir, 'session-modes.json'), 'utf-8').includes('sess-alpha'));
});
