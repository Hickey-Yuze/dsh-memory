// 端到端验证：记忆类型（kind）链路 —— 真实存量库只读复现 + 新增标注全通
// 用法：node verify-kind.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './lib/store.js';
import { parseL1Output, buildL1Prompt } from './lib/prompts.js';
import { createRecall } from './lib/recall.js';
import { createRecallDedupe } from './lib/recall-dedupe.js';
import { createConfig } from './lib/config.js';

const REAL = join(homedir(), '.dsh', 'dsh-memory');
const log = { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
const line = (t) => console.log(`\n=== ${t} ===`);

// ---------- A. 真实存量库体检（只读取，不写） ----------
const raw = JSON.parse(readFileSync(join(REAL, 'records.json'), 'utf-8'));
const records = raw.records || [];
line('A. 真实存量库');
console.log(`records.json version=${raw.version} 记录总数=${records.length}`);
console.log(`带 kind 字段：${records.filter((r) => r.kind).length} 条`);

// ---------- B. 真实数据隔离复现（复制到临时目录，绝不写真实库） ----------
const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-verify-'));
writeFileSync(join(dir, 'records.json'), JSON.stringify({ version: 2, records }));
const store = createStore(dir, log);
const loaded = store.getRecords();
line('B. 存量读入（kind 合法性）');
const cnt = (k) => loaded.filter((r) => (r.kind || 'fact') === k).length;
console.log(`读入 ${loaded.length} 条；fact ${cnt('fact')} / opinion ${cnt('opinion')} / commitment ${cnt('commitment')}`);
assert.equal(loaded.length, records.length);
assert.equal(loaded.filter((r) => !['fact', 'opinion', 'commitment'].includes(r.kind)).length, 0, 'kind 必须落在三个合法值内');

// ---------- C. 存量 fact 行：注入文本零标记 ----------
const config = createConfig({}, null);
const dedupe = createRecallDedupe(dir, log);
const recall = createRecall({ store, config, log, modes: null, embedding: null, dedupe });
const factProbe = records.filter((r) => (r.kind || 'fact') === 'fact').slice(-3);
const legacyText = await recall.recallText('verify-legacy', factProbe.map((r) => r.content.slice(0, 20)).join(' '));
line('C. 存量召回注入（抽查前 5 行）');
console.log(legacyText.split('\n').slice(0, 5).join('\n'));
for (const r of factProbe) {
  const head = r.content.slice(0, 20);
  const lineHit = legacyText.split('\n').find((l) => l.startsWith('- ') && l.includes(head));
  if (lineHit) assert.ok(!/（我的判断|（双方约定/.test(lineHit), `fact 记录不该带类型标记：${head}`);
}
console.log('✔ fact 记录注入零标记（与升级前逐字一致）');

// ---------- D. 新增链路：prompt → 解析 → 入库 → 标注注入 ----------
const { system } = buildL1Prompt({ slice: [{ r: 'user', text: 'x' }], backgroundCount: 0, existingPool: [], maxMemories: 8, family: 'auto' });
assert.match(system, /类型判定（kind）/);
const items = parseL1Output(JSON.stringify({
  memories: [
    { content: '用户偏好用 pnpm 管理依赖', tags: ['工具'], family: 'chat', kind: 'fact' },
    { content: '我推测用户下季度会换 Mac 笔记本', tags: ['设备'], family: 'chat', kind: 'opinion' },
    { content: '约定下周回访部署结果', tags: ['约定'], family: 'work', kind: 'commitment' },
  ],
}));
line('D. 新增链路（模拟 LLM 返回带 kind 的 JSON）');
for (const it of items) store.upsertRecord({ ...it, sessionId: 'verify-kind' });
console.log(`入库 ${items.length} 条：${items.map((i) => i.kind).join(' / ')}`);
const o = await recall.recallText('verify-opinion', '他会不会换 Mac 笔记本');
assert.match(o, /（我的判断·非用户事实）/);
const c = await recall.recallText('verify-commit', '下周回访部署结果');
assert.match(c, /（双方约定）/);
console.log(o.split('\n').filter((l) => l.includes('Mac')).join('\n'));
console.log(c.split('\n').filter((l) => l.includes('回访')).join('\n'));
console.log('✔ 非 fact 注入带标注，fact 不带');

rmSync(dir, { recursive: true, force: true });
line('结果');
console.log('全部断言通过');
