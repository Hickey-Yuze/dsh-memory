// 冒烟测试（真实模块图）：
// ① node --check 全部 JS；
// ② 经 hooks 桩掉宿主捆绑包后真实 import host.js，用桩 ctx 走完
//    捕获 → L0 落盘 / pre-step 注入 / 路由注册 / systemPrompt 稳定区 的接线。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'lib');

test('node --check 全部 JS 文件', () => {
  const files = [join(ROOT, 'index.js'), ...readdirSync(LIB).filter((f) => f.endsWith('.js')).map((f) => join(LIB, f))];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf-8' });
    assert.equal(result.status, 0, `${file} 语法检查失败:\n${result.stderr}`);
  }
});

test('真实 import host.js + 桩 ctx 全链路接线', async (t) => {
  const dataHome = mkdtempSync(join(tmpdir(), 'dsh-mem-home-'));
  t.after(() => rmSync(dataHome, { recursive: true, force: true }));
  process.env.DSH_HOME = dataHome;

  // 在 host.apply 之前预置一条记忆（store 在 apply 时加载 records.json）
  const dataDir = join(dataHome, 'dsh-memory');
  const { mkdirSync, writeFileSync: writeSeed } = await import('node:fs');
  mkdirSync(dataDir, { recursive: true });
  writeSeed(join(dataDir, 'records.json'), JSON.stringify({
    version: 1,
    records: [{ id: 'm_seed1', content: '用户偏好使用 pnpm 管理依赖', tags: [], sessionId: '', sceneId: null, hits: 0, createdAt: Date.now(), updatedAt: Date.now() }],
  }), 'utf-8');

  const host = await import('../lib/host.js');
  assert.equal(host.name, 'dsh-memory');
  assert.deepEqual(host.inject, []);

  // —— 桩 ctx：记录监听器 / 注入回调 / effect ——
  const listeners = new Map(); // event -> handler[]（真实 cordis 支持多监听）
  const injectedCallbacks = [];
  const effects = [];
  const services = {
    llm: { stream: async function* () {}, listProviders: () => [{ id: 'p' }], listModels: async () => [{ id: 'm' }] },
    tools: { register: () => () => {} },
    webServer: { register: (route) => { registeredRoutes.push(route.path); return () => {}; } },
    agents: { list: () => [fakeAgent] },
  };
  const agentSections = [];
  const fakeAgent = {
    id: 'agent-smoke',
    ctx: { systemPrompt: { context: (s) => { agentSections.push(s); return () => {}; } } },
  };
  const registeredRoutes = [];
  const effectDisposers = [];
  const ctx = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return () => {
        const arr = listeners.get(event) || [];
        const i = arr.indexOf(handler);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    inject(deps, cb) {
      injectedCallbacks.push({ deps, cb });
      return () => {};
    },
    get(name) { return services[name] || undefined; },
    effect(fn, _label) { effects.push(fn); return () => {}; },
  };

  const dispose = host.apply(ctx, {});
  assert.ok(listeners.get('session/event').length >= 2); // 捕获 + 压缩重置
  assert.equal(listeners.has('agent/pre-step'), true);
  assert.equal(injectedCallbacks.length, 3); // llm / tools / webServer（稳定区走 agent 作用域，不再全局注入）

  // 逐个触发注入回调（模拟服务就绪）；effect 工厂立即执行以完成注册
  for (const { deps, cb } of injectedCallbacks) {
    const scope = {
      effect(fn) {
        const d = fn();
        if (typeof d === 'function') effectDisposers.push(d);
        return d;
      },
    };
    for (const dep of deps) scope[dep] = services[dep];
    // cordis 语义回归：inject 回调返回值必须是 disposer 函数或 undefined，
    // 返回其它值（如对象）会触发宿主 "Invalid effect" 并回滚整个注入（路由/工具全灭）
    const ret = cb(scope);
    assert.ok(ret === undefined || typeof ret === 'function', `inject(${deps.join(',')}) 回调返回值非法: ${typeof ret}`);
  }
  assert.ok(registeredRoutes.includes('/api-memory/health'));
  // 主 ctx 的 effect（稳定区 agent 作用域注册 / 嵌入调度）
  for (const fn of effects.splice(0)) {
    const d = fn();
    if (typeof d === 'function') effectDisposers.push(d);
  }
  assert.ok(agentSections.some((s) => s.name === 'dsh-memory:profile')); // agent 作用域稳定区

  // —— 捕获：user / assistant 消息 → L0 落盘 ——
  const session = { id: 'session-smoke', header: { cwd: '/tmp/ws' } };
  for (const handler of listeners.get('session/event')) handler(session, { type: 'user/message', data: { content: [{ type: 'text', text: '我喜欢用 pnpm' }], source: { kind: 'user' } } });
  for (const handler of listeners.get('session/event')) handler(session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '好的\n```js\ncode();\n```' }] } } });
  for (const handler of listeners.get('session/event')) handler(session, { type: 'user/message', data: { content: [{ type: 'text', text: '注入的合成消息' }], source: { kind: 'plugin', plugin: 'dsh-memory' } } });

  assert.equal(existsSync(join(dataDir, 'conversations', 'session-smoke.jsonl')), true);
  const l0 = readFileSync(join(dataDir, 'conversations', 'session-smoke.jsonl'), 'utf-8');
  assert.match(l0, /我喜欢用 pnpm/);
  assert.match(l0, /［代码省略］/);          // 助手代码块被剥离
  assert.ok(!l0.includes('注入的合成消息')); // 插件合成消息不入库

  // 无关查询不注入；命中查询注入合成消息（records.json 已在 apply 前预置）
  const signal = new AbortController().signal;
  const agent = { session };
  const nextFor = (text) => async () => ({ kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text }] }] });
  const unrelated = await listeners.get('agent/pre-step')[0]({ agent, step: 1, signal }, nextFor('完全无关的查询词词词'));
  assert.equal(unrelated.messages.length, 1); // 无命中不注入

  const decision = await listeners.get('agent/pre-step')[0]({ agent, step: 1, signal }, nextFor('pnpm 的偏好是什么'));
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[1].role, 'user');
  assert.match(decision.messages[1].content[0].text, /<recalled-memory>/);
  assert.equal(decision.messages[1].source.plugin, 'dsh-memory');
  // step !== 1 不注入
  const laterStep = await listeners.get('agent/pre-step')[0]({ agent, step: 2, signal }, nextFor('pnpm 的偏好是什么'));
  assert.equal(laterStep.messages.length, 1);

  // —— systemPrompt 稳定区：agent 作用域注册的动态文本函数可用 ——
  const profileSection = agentSections.find((s) => s.name === 'dsh-memory:profile');
  assert.equal(typeof profileSection.text(), 'string'); // 空库画像文本为空串，不抛错

  // —— 卸载可逆 ——
  for (const d of effectDisposers.reverse()) {
    try { d(); } catch { /* 忽略 */ }
  }
  dispose();
});

test('client.js 语法有效（ModuleLoader 工厂结构）', () => {
  const source = readFileSync(join(LIB, 'client.js'), 'utf-8');
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.match(source, /id: "dsh-memory"/);
  assert.match(source, /exports\.apply/);
  // 两处 slot 注册：设置页工作台 + 输入栏会话记忆档位芯片
  assert.match(source, /"settings\.section"/);
  assert.match(source, /"conversation\.input\.left"/);
  assert.match(source, /id: "dsh-memory-mode"/);
  // 禁 JSX / TypeScript 语法 sanity：不应含 <[A-Z] 的 JSX 元素开头
  assert.ok(!/<[A-Z][a-zA-Z]*\s/.test(source.replace(/\/\/[^\n]*/g, '')));
});
