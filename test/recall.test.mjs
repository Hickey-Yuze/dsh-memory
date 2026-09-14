// 召回单测：命中格式 / 预算截断 / 会话内去重（持久化）/ 超时跳过 / 最后一条用户消息定位
// / 档位门控（off 隐身、只写覆盖）/ 分族过滤 / hybrid 检索。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecall } from '../lib/recall.js';
import { createRecallDedupe } from '../lib/recall-dedupe.js';
import { createConfig } from '../lib/config.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

const NOW = Date.now();
function fakeStore(records, opts = {}) {
  return {
    getRecords: opts.getRecords || ((family) => records.filter((r) => !family || r.family === family || !r.family && family === 'chat').map((r) => ({ ...r }))),
    getRecord: (id) => records.find((r) => r.id === id) || null,
    getState: () => ({ stats: {} }),
    saveState() {},
  };
}

function makeRecall(records, yaml = {}, storeOverride = null, extras = {}) {
  const config = createConfig(yaml, null);
  const store = storeOverride || fakeStore(records);
  const log = silentLog();
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-recall-'));
  const dedupe = createRecallDedupe(dir, log);
  const modes = extras.modes || null;
  const embedding = extras.embedding || null;
  const recall = createRecall({ store, config, log, modes, embedding, dedupe });
  return { recall, config, store, log, dedupe, dir };
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

test('位置线索：指针型记忆注入时附带先读文件行动提示；无线索不附', async () => {
  // 真机教训：模型记住知识库位置却不读内容，最后编数据
  const pointerRecords = [
    { id: 'kb1', content: '用户的知识库位于 C:\\Users\\华硕\\Desktop\\Yuze\\knowledge，用户明确要求记住该路径', updatedAt: NOW, hits: 0 },
    { id: 'm1', content: '用户偏好使用 pnpm 管理依赖', updatedAt: NOW, hits: 0 },
  ];
  const { recall } = makeRecall(pointerRecords);
  const text = await recall.recallText('s1', '我想用知识库查点东西');
  assert.match(text, /知识库/);
  assert.match(text, /位置≠内容/);
  assert.match(text, /先用文件工具/);
  assert.ok(text.lastIndexOf('先用文件工具') < text.lastIndexOf('</recalled-memory>')); // 提示在块内末尾
  // 无位置线索的普通记忆：不附提示
  const { recall: plain } = makeRecall(RECORDS);
  const normal = await plain.recallText('s2', 'pnpm 部署流程');
  assert.ok(normal.includes('<recalled-memory>'));
  assert.ok(!normal.includes('位置≠内容'));
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

test('档位门控：off 隐身、只写覆盖拦截，shouldInject 与 recallText 一致', async () => {
  const entries = new Map();
  const modes = {
    get: (sid) => entries.get(sid)?.mode ?? 'auto',
    getRecall: (sid) => entries.get(sid)?.recall,
    resolvedRecall: (sid, globalRecall) => { const o = entries.get(sid)?.recall; return typeof o === 'boolean' ? o : globalRecall; },
  };
  const { recall } = makeRecall(RECORDS, {}, null, { modes });
  assert.equal(recall.shouldInject('s1'), true);
  assert.ok((await recall.recallText('s1', 'pnpm 部署流程')).includes('<recalled-memory>'));
  entries.set('s1', { mode: 'off' });
  assert.equal(recall.shouldInject('s1'), false);
  assert.equal(await recall.recallText('s1', 'pnpm 部署流程'), '');
  entries.set('s1', { mode: 'chat', recall: false });
  assert.equal(recall.shouldInject('s1'), false); // 只写不读
  entries.set('s1', { mode: 'chat', recall: true });
  assert.equal(recall.shouldInject('s1'), true); // 强制开
  entries.set('s1', { mode: 'chat', recall: null });
  assert.equal(recall.shouldInject('s1'), true); // 覆盖清除跟随全局
});

test('分族过滤：chat 档只召回 chat 族记录，auto 档跨族', async () => {
  const famRecords = [
    { id: 'w1', content: '项目部署流程是 pnpm build && vercel', family: 'work', updatedAt: NOW },
    { id: 'c1', content: '个人部署日记：pnpm 部署到 vercel', family: 'chat', updatedAt: NOW },
  ];
  const entries = new Map();
  const modes = { get: (sid) => entries.get(sid)?.mode ?? 'auto', getRecall: () => undefined, resolvedRecall: (_sid, g) => g };
  const { recall } = makeRecall(famRecords, {}, null, { modes });
  entries.set('s1', { mode: 'work' });
  const workText = await recall.recallText('s1', 'pnpm 部署流程');
  assert.ok(workText.includes('项目部署流程'));
  assert.ok(!workText.includes('个人部署日记'));
  entries.set('s1', { mode: 'auto' });
  const autoText = await recall.recallText('s2', 'pnpm 部署流程');
  assert.ok(autoText.includes('项目部署流程') && autoText.includes('个人部署日记'));
});

test('hybrid 检索：嵌入源就绪时走 RRF 融合（向量路补关键词漏召回）', async () => {
  // 向量让「负载」命中「负载均衡」记录（关键词二元组也能命中，这里验证融合路径不炸且有序）
  const embedding = {
    ready: () => true,
    sourceChanged: () => false,
    embedQuery: async () => [1, 0],
    getVector: (id) => (id === 'm1' ? [1, 0] : id === 'm2' ? [0.9, 0.1] : null),
  };
  const { recall } = makeRecall(RECORDS, {}, null, { embedding });
  const text = await recall.recallText('s1', 'pnpm 部署流程');
  assert.match(text, /<recalled-memory>/);
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
