// 知识库索引单测：扫描（扩展名/噪音目录/碎片过滤）→ 分块 → 增量（mtime+size）→ 剔除
// → 检索（relPath/absPath）；召回集成：L1 零命中也注入 <knowledge-index>、同会话去重、
// 知识库检索失败不影响召回。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeIndex } from '../lib/knowledge.js';
import { createConfig } from '../lib/config.js';
import { createRecall } from '../lib/recall.js';
import { createRecallDedupe } from '../lib/recall-dedupe.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

test('知识库：扫描 → 分块 → 增量 → 变化重索引 → 消失剔除 → 检索命中', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-kb-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const vault = join(home, 'vault');
  mkdirSync(join(vault, 'sub'), { recursive: true });
  mkdirSync(join(vault, '.obsidian'), { recursive: true });
  writeFileSync(join(vault, 'a.md'), '分仓决策路径：R1 定向仓优先，R2 省份就近，R3 库存校验，R4 时效优先，R5 全国池兜底。\n\n' + '第二段落：企业整批锁库需要 AB 单配平。\n\n'.repeat(3));
  writeFileSync(join(vault, 'sub', 'b.md'), '负载均衡策略：最小连接数优先，其次加权轮询，兜底随机散列，保障大促期间网关不抖动。\n\n附录：订单表的字段口径以 SCHEMA.md 为准，状态机流转见部署指南附录 B。');
  writeFileSync(join(vault, 'noise.md'), '太短'); // 碎片（<40 字符）不索引
  writeFileSync(join(vault, '.obsidian', 'c.md'), '配置目录里的文件不应被索引。'.repeat(10));
  writeFileSync(join(vault, 'skip.bin'), '扩展名不匹配的文件不应被索引。'.repeat(10));

  const cfg = createConfig({ knowledge: { enabled: true, paths: [vault] } }, null);
  const kb = createKnowledgeIndex(home, { config: cfg, log: silentLog() });
  const r1 = kb.scan();
  assert.equal(r1.skipped, false);
  assert.equal(r1.files, 2, '只索引 a.md 与 sub/b.md');
  assert.ok(r1.chunks >= 2);

  const hits = kb.search('分仓决策路径 全国池兜底', { limit: 3 });
  assert.ok(hits.length > 0);
  assert.equal(hits[0].item.relPath, 'a.md');
  assert.ok(hits[0].item.absPath.includes('vault'));

  assert.equal(kb.scan().indexed, 0, '无变化不重索引');

  const bPath = join(vault, 'sub', 'b.md');
  writeFileSync(bPath, '全新的内容：分仓决策路径已更新为六层规则体系，新增定向仓白名单。'.repeat(10));
  const future = new Date(Date.now() + 5000);
  utimesSync(bPath, future, future); // 显式 bump mtime，规避写盘时间粒度
  assert.equal(kb.scan().indexed, 1);

  rmSync(join(vault, 'a.md'));
  const r4 = kb.scan();
  assert.equal(r4.dropped, 1);
  assert.equal(r4.files, 1);
});

test('召回×知识库：L1 零命中也注入片段块；同会话去重；检索失败不影响', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-kb-recall-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const NOW = Date.now();
  const store = { getRecords: () => [], getRecord: () => null, getState: () => ({ stats: {} }), saveState() {} };
  const config = createConfig({ knowledge: { enabled: true } }, null);
  const log = silentLog();
  const fakeKb = {
    chunkCount: () => 2,
    search: () => [{ item: { id: 'kb:C:/x/a.md#0', text: '分仓决策路径 R5 全国池兜底，跨区调拨需审批', updatedAt: NOW, relPath: 'a.md', absPath: 'C:/x/a.md' }, score: 1 }],
  };
  const recall = createRecall({ store, config, log, modes: null, embedding: null, dedupe: createRecallDedupe(join(home, 'd1'), log), knowledge: fakeKb });

  const first = await recall.recallText('s1', '分仓决策路径是怎么定的');
  assert.match(first, /<knowledge-index>/);
  assert.match(first, /\[a\.md\]/);
  assert.match(first, /完整上下文请用文件工具读取/);
  assert.ok(!first.includes('<recalled-memory>'), 'L1 零命中时不应有记忆块');

  assert.equal(await recall.recallText('s1', '分仓决策路径是怎么定的'), '', '同会话同片段去重');

  const badKb = { chunkCount: () => 1, search: () => { throw new Error('boom'); } };
  const recallBad = createRecall({ store, config, log, modes: null, embedding: null, dedupe: createRecallDedupe(join(home, 'd2'), log), knowledge: badKb });
  assert.equal(await recallBad.recallText('s2', '分仓决策路径是怎么定的'), '', '知识库异常静默跳过');
});
