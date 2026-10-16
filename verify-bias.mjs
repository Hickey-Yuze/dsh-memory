// 端到端验证：偏差档案（bias）链路 —— 真实档案只读复现 + 注入行为全通
// 用法：node verify-bias.mjs
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './lib/store.js';
import { createRecall } from './lib/recall.js';
import { createRecallDedupe } from './lib/recall-dedupe.js';
import { createConfig } from './lib/config.js';
import { registerMemoryTools } from './lib/tools.js';

const REAL = join(homedir(), '.dsh', 'dsh-memory');
const log = { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
const line = (t) => console.log(`\n=== ${t} ===`);

// ---------- A. 真实偏差档案体检（只读） ----------
const raw = JSON.parse(readFileSync(join(REAL, 'bias.json'), 'utf-8'));
const biases = raw.biases || [];
line('A. 真实偏差档案');
console.log(`bias.json version=${raw.version} 条数=${biases.length}`);
for (const b of biases) {
  assert.ok(b.id && b.no > 0 && b.deviation && b.fix, `偏差 ${b.id} 结构不完整`);
  console.log(`  B-${b.no} [${b.date}] ${b.kind}｜${b.scene}｜偏差：${b.deviation.slice(0, 24)}…`);
}

// ---------- B. 隔离复现：真实 records + 真实 bias 复制到临时目录 ----------
const dir = mkdtempSync(join(tmpdir(), 'dsh-bias-verify-'));
const recordCount = (JSON.parse(readFileSync(join(REAL, 'records.json'), 'utf-8')).records || []).length;
writeFileSync(join(dir, 'records.json'), readFileSync(join(REAL, 'records.json')));
writeFileSync(join(dir, 'bias.json'), JSON.stringify({ version: 1, biases }));
writeFileSync(join(dir, 'activity.jsonl'), '');
const store = createStore(dir, log);
line('B. 读入');
console.log(`记忆 ${store.getRecords().length} 条（真实 ${recordCount}）· 偏差 ${store.getBiases().length} 条`);
assert.equal(store.getRecords().length, recordCount);
assert.equal(store.getBiases().length, biases.length);
const config = createConfig({}, null);
const ecc = config.effective();
const recall = createRecall({ store, config, log, modes: null, embedding: null, dedupe: createRecallDedupe(dir, log) });
console.log(`召回预算：L1 ${ecc.recall.maxResults} 条 / ${ecc.recall.maxTotalRecallChars} 字；偏差 ${ecc.bias.maxResults} 条 / ${ecc.bias.maxTotalChars} 字 / 阈值 ${ecc.bias.scoreThreshold}`);

// ---------- C. 撞上话题才注入 ----------
line('C. 话题撞上 → 注入');
const hit1 = await recall.recallText('verify-bias-1', '记忆回填落盘之后要不要先重启插件');
console.log(hit1.split('\n').filter((l) => l.includes('B-1') || l.includes('bias-archive')).join('\n') || '（未注入）');
assert.match(hit1, /<bias-archive>/, '撞上偏差话题却没注入');
assert.match(hit1, /B-1/);
const hit2 = await recall.recallText('verify-bias-2', '能不能用关键词规则判断记忆条目的类型');
console.log(hit2.split('\n').filter((l) => l.includes('B-2') || l.includes('bias-archive')).join('\n') || '（未注入）');
assert.match(hit2, /B-2/);
console.log('✔ 相关话题命中对应偏差');

// ---------- D. 无关话题不注入偏差 + 同会话去重 ----------
line('D. 无关话题 / 去重');
const miss = await recall.recallText('verify-bias-3', '今天天气不错');
assert.ok(!miss.includes('<bias-archive>'), '无关话题不该注入偏差块');
const again = await recall.recallText('verify-bias-1', '记忆回填落盘之后要不要先重启插件');
assert.ok(!again.includes('<bias-archive>'), '同一会话内第二次不该重复注入偏差');
console.log(`✔ 无关话题零偏差注入（L1 仍可正常召回 ${miss.split('\n').filter((l) => l.startsWith('- ')).length} 条）；同会话去重生效`);

// ---------- E. L1 零命中也能单独出偏差块 ----------
const dir2 = mkdtempSync(join(tmpdir(), 'dsh-bias-only-'));
writeFileSync(join(dir2, 'bias.json'), JSON.stringify({ version: 1, biases }));
writeFileSync(join(dir2, 'activity.jsonl'), '');
const store2 = createStore(dir2, log);
const recall2 = createRecall({ store: store2, config, log, modes: null, embedding: null, dedupe: createRecallDedupe(dir2, log) });
const alone = await recall2.recallText('verify-bias-4', '记忆回填落盘之后要不要先重启插件');
line('E. 只有偏差、没有记忆时');
console.log(alone.split('\n').slice(0, 3).join('\n'));
assert.match(alone, /<bias-archive>/);
assert.ok(!alone.includes('<recalled-memory>'), 'L1 零命中时不该出现记忆块');
console.log('✔ 偏差块可独立注入');

// ---------- F. 总开关与入档/删除 ----------
line('F. 开关与入档');
const offConfig = createConfig({ bias: { enabled: false } }, null);
const recallOff = createRecall({ store: store2, config: offConfig, log, modes: null, embedding: null, dedupe: createRecallDedupe(dir2, log) });
assert.equal(await recallOff.recallText('verify-bias-5', '记忆回填落盘之后要不要先重启插件'), '', '关掉总开关后不该注入');
const { bias: added, created } = store2.upsertBias({ scene: '验证脚本', deviation: '临时偏差', fix: '删除即可', family: 'work', kind: 'recall-miss' });
assert.ok(created && added.no === biases.length + 1, '自动编号应接在现有编号之后');
assert.equal(store2.getBiases('work').length, 1);
assert.equal(store2.deleteBias(added.id), 1);
console.log(`✔ 总开关生效；入档自动编号 B-${added.no}（${added.kind}），删除正常`);

rmSync(dir, { recursive: true, force: true });
rmSync(dir2, { recursive: true, force: true });

// ---------- G. 模型侧工具 memory_bias（add / list / update / delete） ----------
line('G. 工具 memory_bias');
const dir3 = mkdtempSync(join(tmpdir(), 'dsh-bias-tool-'));
writeFileSync(join(dir3, 'activity.jsonl'), '');
const store3 = createStore(dir3, log);
const config3 = createConfig({}, null);
const tools = [];
registerMemoryTools({ tools: { register: (def) => { tools.push(def); return () => {}; } } }, {
  store: store3, config: config3, log, defineTool: (def) => def,
  getMode: () => 'chat', getRecallOverride: () => null, embedding: null,
});
const tool = tools.find((t) => t.name === 'memory_bias');
assert.ok(tool, '未注册 memory_bias 工具');
console.log(`已注册工具：${tools.map((t) => t.name).join(' / ')}`);
const exec = { sessionId: 'verify-tool' };
const addedBias = tool.execute({ action: 'add', kind: 'recall-miss', scene: '召回漏', deviation: '该召没召到', rootCause: '关键词阈值过高', fix: 'evaluate 阈值', tags: '召回,阈值' }, exec);
assert.equal(addedBias.ok, true);
assert.equal(addedBias.action, 'added');
const biasId = addedBias.biases[0].id;
assert.equal(tool.execute({ action: 'add', deviation: '', fix: 'x' }, exec).ok, false, '缺 deviation 必须拒绝');
const listed = tool.execute({ action: 'list' }, exec);
assert.equal(listed.total, 1);
console.log(tool.output.render({}, listed)[0].text);
const rendered = tool.output.render({}, listed)[0].text;
assert.match(rendered, /B-1/);
assert.match(rendered, /evaluate 阈值/);
const updated = tool.execute({ action: 'update', id: biasId, deviation: '该召没召到（已复核）', fix: '阈值降到 0.4' }, exec);
assert.equal(updated.ok, true);
assert.equal(store3.getBiases().length, 1, 'update 不该新增');
assert.equal(tool.execute({ action: 'delete', id: biasId }, exec).ok, true);
assert.equal(tool.execute({ action: 'delete', id: 'nope' }, exec).ok, false);
console.log('✔ 工具链路 add / list / update / delete 全部正常');

rmSync(dir3, { recursive: true, force: true });
line('结果');
console.log('全部断言通过');