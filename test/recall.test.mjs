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
  const biases = opts.biases || [];
  return {
    getRecords: opts.getRecords || ((family) => records.filter((r) => !family || r.family === family || !r.family && family === 'chat').map((r) => ({ ...r }))),
    getRecord: (id) => records.find((r) => r.id === id) || null,
    getBiases: (family) => biases.filter((b) => !family || b.family === family).map((b) => ({ ...b })),
    getBias: (id) => biases.find((b) => b.id === id) || null,
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

test('记忆类型标注：opinion / commitment 显式标注，fact 与存量记录零标记', async () => {
  const kindRecords = [
    { id: 'f1', content: '用户偏好 pnpm 管理依赖', family: 'chat', kind: 'fact', updatedAt: NOW },
    { id: 'o1', content: '我判断用户下季度会换 Mac 笔记本', family: 'chat', kind: 'opinion', updatedAt: NOW },
    { id: 'c1', content: '约定下周回访部署结果', family: 'chat', kind: 'commitment', updatedAt: NOW },
  ];
  const { recall } = makeRecall(kindRecords);
  const op = await recall.recallText('s1', '他会不会换 Mac 笔记本');
  assert.match(op, /（我的判断·非用户事实）/);
  const cm = await recall.recallText('s2', '下周回访部署结果');
  assert.match(cm, /（双方约定）/);
  const ft = await recall.recallText('s3', 'pnpm 管理依赖偏好');
  assert.ok(ft.includes('用户偏好 pnpm'));
  assert.ok(!/（我的判断|（双方约定/.test(ft)); // fact 行不加标记
  // 存量记录（无 kind 字段）→ 零标记，注入文本与升级前逐字一致
  const { recall: legacy } = makeRecall([{ id: 'l1', content: '用户偏好 pnpm 管理依赖', family: 'chat', updatedAt: NOW }]);
  const legacyText = await legacy.recallText('s4', 'pnpm 管理依赖偏好');
  assert.ok(legacyText.includes('<recalled-memory>'));
  assert.ok(!/（我的判断|（双方约定/.test(legacyText));
});

test('偏差档案：话题撞上才注入（L1 零命中也能单独注入），阈值外不出现', async () => {
  const biases = [
    { id: 'b1', no: 1, date: '2026-10-15', kind: 'judgment', scene: 'dsh-memory 存量改盘', deviation: '以为重启够快就不会被覆盖', rootCause: '插件内存里是旧 kind', fix: '改盘前先在 config overlay 关掉 extract.enabled', family: 'chat', updatedAt: NOW, hits: 0 },
    { id: 'b2', no: 2, date: '2026-10-15', kind: 'judgment', scene: '黄金矿工 绳子不显示', deviation: '改完就以为好了', fix: '必须跑 verify-rope-fix.mjs 用指纹核验', family: 'chat', updatedAt: NOW, hits: 0 },
  ];
  const { recall } = makeRecall([], {}, fakeStore([], { biases }));
  const hit = await recall.recallText('s1', '黄金矿工的绳子还是躺在地上');
  assert.match(hit, /<bias-archive>/);
  assert.match(hit, /B-2/);
  assert.match(hit, /verify-rope-fix\.mjs/);
  assert.ok(!hit.includes('B-1'), '不相关的偏差不该被注入');
  assert.ok(!hit.includes('<recalled-memory>'), 'L1 零命中时只出偏差块');
  // 同一会话内去重：第二次不再注入
  assert.equal(await recall.recallText('s1', '黄金矿工的绳子还是躺在地上'), '');
  // 无关话题 → 既不注入偏差也不注入 L1
  assert.equal(await recall.recallText('s2', '今天天气不错'), '');
  // 总开关关掉 → 偏差块不出现
  const { recall: off } = makeRecall([], { bias: { enabled: false } }, fakeStore([], { biases }));
  assert.equal(await off.recallText('s3', '黄金矿工的绳子还是躺在地上'), '');
});

test('超时降级：可选层卡住时仍注入 L1，不整轮丢弃', async () => {
  const log = silentLog();
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-recall-'));
  const config = createConfig({ recall: { timeoutMs: 80 }, knowledge: { enabled: true } }, null);
  const store = fakeStore(RECORDS);
  const dedupe = createRecallDedupe(dir, log);
  const knowledge = { chunkCount: () => 5, search: () => new Promise(() => {}) }; // 知识库永不返回
  const recall = createRecall({ store, config, log, modes: null, embedding: null, dedupe, knowledge });
  try {
    const started = Date.now();
    const text = await recall.recallText('s1', 'pnpm 部署流程要注意什么');
    assert.ok(Date.now() - started < 1000);
    assert.notEqual(text, '');
    assert.match(text, /部署流程/); // 同步层照常注入，只有知识库被放弃
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
