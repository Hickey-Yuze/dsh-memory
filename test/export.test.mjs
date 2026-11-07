// 定时整理导出单测：cron 解析 / 场景目录归类 / md 渲染 / 增量幂等 / 导出器状态。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import { parseCron, cronMatches, nextRun } from '../lib/cron.js';
import { createExporter, pickSceneDir, renderSceneMd } from '../lib/export.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

function withStore(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-export-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(createStore(dir, silentLog()), dir);
}

// ---------- cron 解析 ----------

test('cron：解析 5 段基本表达式', () => {
  const spec = parseCron('0 3 * * *');
  assert.ok(spec);
  assert.ok(spec.minutes.has(0));
  assert.ok(spec.hours.has(3));
});

test('cron：步长与离散值', () => {
  const spec = parseCron('*/15 9,18 * * 1-5');
  assert.ok(spec.minutes.has(0) && spec.minutes.has(15) && spec.minutes.has(45));
  assert.ok(spec.hours.has(9) && spec.hours.has(18));
  assert.ok(spec.weekdays.has(1) && spec.weekdays.has(5) && !spec.weekdays.has(6));
});

test('cron：空表达式返回 null（未启用）', () => {
  assert.equal(parseCron(''), null);
  assert.equal(parseCron('   '), null);
});

test('cron：非法表达式抛错', () => {
  assert.throws(() => parseCron('0 3 * *'), /5 段/);       // 4 段
  assert.throws(() => parseCron('60 * * * *'), /越界/);    // 分越界
  assert.throws(() => parseCron('0 25 * * *'), /越界/);    // 时越界
  assert.throws(() => parseCron('abc * * * *'), /无法解析/); // 乱值
});

test('cron：匹配语义（日/周或关系）', () => {
  const daily = parseCron('0 3 * * *');
  assert.ok(cronMatches(daily, new Date(2026, 10, 6, 3, 0)));    // 任意日 03:00
  assert.ok(!cronMatches(daily, new Date(2026, 10, 6, 3, 5)));
  const weeklySun = parseCron('30 9 * * 0');
  assert.ok(cronMatches(weeklySun, new Date(2026, 10, 8, 9, 30)));  // 周日
  assert.ok(!cronMatches(weeklySun, new Date(2026, 10, 6, 9, 30))); // 周五
  const workdays = parseCron('0 8 * * 1-5');
  assert.ok(cronMatches(workdays, new Date(2026, 10, 6, 8, 0)));   // 周五
  assert.ok(!cronMatches(workdays, new Date(2026, 10, 7, 8, 0)));  // 周六
});

test('cron：下次触发时间', () => {
  const spec = parseCron('0 3 * * *');
  const n = nextRun(spec, new Date(2026, 10, 6, 2, 30).getTime());
  assert.equal(new Date(n).getHours(), 3);
  assert.equal(new Date(n).getMinutes(), 0);
  // 永不触发（2 月 30 日）→ null
  assert.equal(nextRun(parseCron('0 0 30 2 *'), Date.now()), null);
});

// ---------- 场景目录归类 ----------

test('归类：同名精确命中', () => {
  const r = pickSceneDir('苹果日报', ['苹果日报', '项目管理']);
  assert.equal(r.dir, '苹果日报');
  assert.equal(r.created, false);
});

test('归类：互相包含命中', () => {
  const r = pickSceneDir('Yuze-agent 开发', ['yuze-agent', '钉钉']);
  assert.equal(r.dir, 'yuze-agent');
  assert.equal(r.created, false);
});

test('归类：词重叠命中', () => {
  const r = pickSceneDir('黄金矿工游戏开发', ['游戏开发', '简历']);
  assert.equal(r.dir, '游戏开发');
  assert.equal(r.created, false);
});

test('归类：找不到新建', () => {
  const r = pickSceneDir('全新主题场景', ['苹果日报']);
  assert.equal(r.dir, '全新主题场景');
  assert.equal(r.created, true);
});

test('归类：无已有目录新建', () => {
  const r = pickSceneDir('场景甲', []);
  assert.equal(r.dir, '场景甲');
  assert.equal(r.created, true);
});

test('归类：非法文件名清理', () => {
  const r = pickSceneDir('a/b:c*d', []);
  assert.equal(r.dir.includes('/'), false);
  assert.ok(!/[:*]/.test(r.dir));
});

// ---------- md 渲染 ----------

test('渲染：结构化文档（frontmatter + 提炼正文 + 支撑记忆）', () => {
  const md = renderSceneMd(
    { id: 's1', title: '测试场景', family: 'work' },
    [
      { content: '第一条记忆', kind: 'fact', updatedAt: 1700000000000 },
      { content: '推测内容', kind: 'opinion', updatedAt: 1700000001000 },
    ],
    '## 要点\n\n- **关键决策**：测试决策',
    '团队工作准则',
  );
  assert.ok(md.includes('title: 测试场景'));
  assert.ok(md.includes('type: knowledge'));
  assert.ok(md.includes('# 测试场景'));
  assert.ok(md.includes('## 要点'));
  assert.ok(md.includes('**关键决策**'));
  assert.ok(md.includes('## 支撑记忆'));
  assert.ok(md.includes('第一条记忆'));
  assert.ok(md.includes('（推测）'));
});

// ---------- 导出器：增量幂等 ----------

test('导出器：配置缺失返回错误', async () => {
  const cfg = { effective: () => ({ export: { enabled: true, cron: '', targetDir: '' } }) };
  const exporter = createExporter({ store: null, config: cfg, log: silentLog(), dataDir: '/tmp/x' });
  const result = await exporter.runExport();
  assert.equal(result.ok, false);
  assert.match(result.error, /导出目录/);
});

test('导出器：全量导出（按项目合并）+ 增量跳过 + 增量重生成', async (t) => {
  await withStore(t, async (store, dir) => {
    const targetDir = mkdtempSync(join(tmpdir(), 'dsh-mem-export-target-'));
    t.after(() => rmSync(targetDir, { recursive: true, force: true }));
    const cfg = { effective: () => ({ export: { enabled: true, cron: '', targetDir } }) };

    // 造两个场景 + 成员记忆（无 LLM → 规则降级：场景标题作项目名）
    const r1 = store.upsertRecord({ content: '黄金矿工项目推进', family: 'work', kind: 'fact' });
    const r2 = store.upsertRecord({ content: '钉钉日报配置', family: 'work', kind: 'commitment' });
    const scenes = [
      { id: 's1', family: 'work', title: '游戏开发', content: '游戏相关', recordIds: [r1.record.id] },
      { id: 's2', family: 'work', title: '钉钉配置', content: '日报', recordIds: [r2.record.id] },
    ];
    store.replaceScenes(scenes, 'work');

    const exporter = createExporter({ store, config: cfg, log: silentLog(), dataDir: dir });
    const first = await exporter.runExport();
    assert.equal(first.ok, true);
    assert.equal(first.files, 2);
    assert.equal(first.scenes, 2);

    // 目录结构：targetDir/<项目>/README.md + 根目录总索引
    const subDirs = readdirSync(targetDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(subDirs.includes('游戏开发'));
    assert.ok(subDirs.includes('钉钉配置'));
    const md = readFileSync(join(targetDir, '游戏开发', 'README.md'), 'utf-8');
    assert.ok(md.includes('# 游戏开发'));
    assert.ok(md.includes('黄金矿工项目推进'));
    const indexMd = readFileSync(join(targetDir, 'README.md'), 'utf-8');
    assert.ok(indexMd.includes('游戏开发'));
    assert.ok(indexMd.includes('钉钉配置'));

    // 增量：没有新内容 → 第二次跳过
    const second = await exporter.runExport();
    assert.equal(second.skipped, true);
    assert.equal(second.files, 0);

    // 新增记忆进已有场景 → 增量只重生成该项目文档
    await new Promise((r) => setTimeout(r, 5)); // 确保 updatedAt > lastExportAt（同毫秒竞态）
    const nr = store.upsertRecord({ content: '黄金矿工新增关卡', family: 'work', kind: 'fact' });
    const s1 = store.getScenes('work').find((s) => s.title === '游戏开发');
    store.replaceScenes([{ ...s1, recordIds: [...s1.recordIds, nr.record.id] }], 'work');
    const third = await exporter.runExport();
    assert.equal(third.files, 1);
    assert.equal(third.records, 2); // 场景 s1 现在 2 条成员
  });
});

test('导出器：归类到已有项目目录（语义匹配，不新建）', async (t) => {
  await withStore(t, async (store, dir) => {
    const targetDir = mkdtempSync(join(tmpdir(), 'dsh-mem-export-target-'));
    t.after(() => rmSync(targetDir, { recursive: true, force: true }));
    // 预先建好一个目录（模拟知识库已有结构：项目）
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(targetDir, '项目'), { recursive: true });
    const cfg = { effective: () => ({ export: { enabled: true, cron: '', targetDir } }) };
    const r1 = store.upsertRecord({ content: '游戏开发项目讨论', family: 'work', kind: 'fact' });
    store.replaceScenes([{ id: 's1', family: 'work', title: '游戏开发项目', content: '', recordIds: [r1.record.id] }], 'work');
    const exporter = createExporter({ store, config: cfg, log: silentLog(), dataDir: dir });
    await exporter.runExport();
    // 场景「游戏开发项目」与已有「项目」目录字符重叠 ≥2 → 归入「项目」，不新建场景目录
    const inProject = readdirSync(join(targetDir, '项目'));
    assert.ok(inProject.includes('README.md'));
    const subDirs = readdirSync(targetDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(!subDirs.includes('游戏开发项目')); // 没有新建场景目录
  });
});

test('导出器：status 返回配置与上次结果', async (t) => {
  await withStore(t, async (store, dir) => {
    const targetDir = mkdtempSync(join(tmpdir(), 'dsh-mem-export-target-'));
    t.after(() => rmSync(targetDir, { recursive: true, force: true }));
    const cfg = { effective: () => ({ export: { enabled: true, cron: '0 3 * * *', targetDir } }) };
    const exporter = createExporter({ store, config: cfg, log: silentLog(), dataDir: dir });
    const st = exporter.status();
    assert.equal(st.enabled, true);
    assert.equal(st.cron, '0 3 * * *');
    assert.equal(st.targetDir, targetDir);
    assert.equal(st.lastExportAt, 0);
  });
});
