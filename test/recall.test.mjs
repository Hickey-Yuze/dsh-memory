// 召回单测：命中格式 / 预算截断 / 会话内去重 / 超时跳过 / 最后一条用户消息定位。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecall } from '../lib/recall.js';
import { createConfig } from '../lib/config.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

const NOW = Date.now();
function fakeStore(records, opts = {}) {
  return {
    getRecords: opts.getRecords || (() => records.map((r) => ({ ...r }))),
    getRecord: (id) => records.find((r) => r.id === id) || null,
    getState: () => ({ stats: {} }),
    saveState() {},
  };
}

function makeRecall(records, yaml = {}, storeOverride = null) {
  const config = createConfig(yaml, null);
  const store = storeOverride || fakeStore(records);
  const log = silentLog();
  const recall = createRecall({ store, config, log });
  return { recall, config, store, log };
}

const RECORDS = [
  { id: 'm1', content: '用户偏好使用 pnpm 管理依赖', updatedAt: NOW, hits: 0 },
  { id: 'm2', content: '部署流程是 pnpm build && vercel', updatedAt: NOW - 10 * 86400000, hits: 0 },
  { id: 'm3', content: '用户养了一只叫豆豆的猫', updatedAt: NOW, hits: 0 },
];

test('命中：相关记忆按相关度排序注入，无关的不出现', async () => {
  const { recall } = makeRecall(RECORDS);
  const text = await recall.recallText('s1', '我们项目的部署流程怎么走？pnpm 构建有什么要注意的');
  assert.match(text, /<recalled-memory>/);
  assert.match(text, /部署流程/);
  assert.ok(!text.includes('豆豆'));
});

test('单条截断 + 整轮预算截断', async () => {
  const longRecords = [
    { id: 'm1', content: 'x'.repeat(900), updatedAt: NOW },
    { id: 'm2', content: 'y'.repeat(900), updatedAt: NOW },
  ];
  const { recall } = makeRecall(longRecords, { recall: { maxCharsPerMemory: 100, maxTotalRecallChars: 300, maxResults: 5 } });
  const text = await recall.recallText('s1', 'xxxxxxxxxx');
  assert.match(text, /（已截断，可用 memory_search 查全文）/);
  assert.ok(text.length <= 400);
});

test('会话内去重：同一条记忆不重复注入；压缩后重置', async () => {
  const { recall } = makeRecall(RECORDS);
  const first = await recall.recallText('s1', 'pnpm 部署流程');
  assert.ok(first.includes('<recalled-memory>'));
  const second = await recall.recallText('s1', 'pnpm 部署流程');
  assert.equal(second, '');
  // 换会话不受影响
  const other = await recall.recallText('s2', 'pnpm 部署流程');
  assert.ok(other.length > 0);
  // /compact 重置
  recall.onCompaction('s1');
  const third = await recall.recallText('s1', 'pnpm 部署流程');
  assert.ok(third.includes('<recalled-memory>'));
});

test('超时跳过：绝不阻塞（预算内未完成返回空串）', async () => {
  const slowStore = fakeStore(RECORDS, {
    getRecords: () => new Promise(() => {}), // 永不返回
  });
  const { recall } = makeRecall(RECORDS, { recall: { timeoutMs: 20 } }, slowStore);
  const started = Date.now();
  const text = await recall.recallText('s1', 'pnpm 部署');
  assert.ok(Date.now() - started < 1000);
  assert.equal(text, '');
});

test('关闭 / 空查询 / 无命中 → 空串', async () => {
  const { recall } = makeRecall(RECORDS, { recall: { enabled: false } });
  assert.equal(await recall.recallText('s1', 'pnpm 部署'), '');
  const { recall: recall2 } = makeRecall(RECORDS);
  assert.equal(await recall2.recallText('s1', ''), '');
  assert.equal(await recall2.recallText('s1', '完'), '');
  const { recall: recall3 } = makeRecall([]);
  assert.equal(await recall3.recallText('s1', '完全无关的查询词'), '');
});

test('lastUserText：定位最后一条真实用户消息并跳过插件合成消息', () => {
  const { recall } = makeRecall(RECORDS);
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '第一条' }] },
    { role: 'assistant', content: [{ type: 'text', text: '回答' }] },
    { role: 'user', source: { kind: 'plugin', plugin: 'dsh-memory' }, content: [{ type: 'text', text: '<recalled-memory>合成</recalled-memory>' }] },
    { role: 'user', content: [{ type: 'text', text: '  ' }, { type: 'text', text: '真正的最新问题' }] },
  ];
  assert.equal(recall.lastUserText(messages), '真正的最新问题');
  assert.equal(recall.lastUserText([{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }]), null);
  assert.equal(recall.lastUserText([]), null);
});
