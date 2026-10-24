// 跨设备同步单测：快照构建 / 合并语义（LWW + hits 取 max + 墓碑）/ 编码 / 仓库坐标解析 /
// 设备 id 派生 / 合并结果落库（含备份）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';
import {
  LOCAL_ONLY_FILES, SYNCED_FILES, applySnapshot, buildSnapshot, decodeSnapshot, encodeSnapshot,
  mergeSnapshots, parseRepo, resolveDeviceId, resolveDeviceName, snapshotDigest,
} from '../lib/sync.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

function withStore(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(createStore(dir, silentLog()), dir);
}

const NOW = Date.now();
const days = (n) => NOW - n * 86400000;

function snap(over = {}) {
  return {
    version: 1,
    deviceId: 'dev_a',
    deviceName: 'A',
    updatedAt: NOW,
    records: [],
    scenes: [],
    personas: { chat: null, work: null },
    biases: [],
    deleted: { records: [], biases: [], scenes: [], updatedAt: NOW },
    l0: null,
    ...over,
  };
}

function rec(id, content, extra = {}) {
  return {
    id, content, tags: [], family: 'work', kind: 'fact', sessionId: 's1',
    sceneId: null, hits: 0, createdAt: days(3), updatedAt: days(3), ...extra,
  };
}

// ============ 合并语义 ============

test('合并：不同 id 的记忆取并集', () => {
  const local = snap({ records: [rec('m1', '本机的一条')] });
  const remote = snap({ records: [rec('m2', '远端的一条')], deviceId: 'dev_b' });
  const { snapshot, stats } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records.length, 2);
  assert.equal(stats.recordsAdded, 1);
  assert.equal(stats.recordsKept, 0);
});

test('合并：同 id 取 updatedAt 晚者（远端更新）', () => {
  const local = snap({ records: [rec('m1', '旧内容', { updatedAt: days(5) })] });
  const remote = snap({ records: [rec('m1', '新内容', { updatedAt: days(1) })], deviceId: 'dev_b' });
  const { snapshot, stats } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].content, '新内容');
  assert.equal(stats.recordsUpdated, 1);
});

test('合并：同 id 本机更新则保留本机内容', () => {
  const local = snap({ records: [rec('m1', '本机新', { updatedAt: days(1) })] });
  const remote = snap({ records: [rec('m1', '远端旧', { updatedAt: days(5) })], deviceId: 'dev_b' });
  const { snapshot, stats } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records[0].content, '本机新');
  assert.equal(stats.recordsKept, 1);
  assert.equal(stats.recordsUpdated, 0);
});

test('合并：hits 取 max 而不是累加（跨机不重复膨胀）', () => {
  const local = snap({ records: [rec('m1', '同一条', { hits: 7, updatedAt: days(1) })] });
  const remote = snap({ records: [rec('m1', '同一条', { hits: 5, updatedAt: days(5) })], deviceId: 'dev_b' });
  const { snapshot } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records[0].hits, 7);
  // 反向：远端更高时也取 max
  const local2 = snap({ records: [rec('m1', '同一条', { hits: 3, updatedAt: days(1) })] });
  const remote2 = snap({ records: [rec('m1', '同一条', { hits: 9, updatedAt: days(5) })], deviceId: 'dev_b' });
  const r2 = mergeSnapshots(local2, remote2);
  assert.equal(r2.snapshot.records[0].hits, 9);
});

test('合并：墓碑传播删除（远端删掉的，本机也要删）', () => {
  const local = snap({ records: [rec('m1', '要被删'), rec('m2', '要留着')] });
  const remote = snap({
    records: [],
    deviceId: 'dev_b',
    deleted: { records: ['m1'], biases: [], scenes: [], updatedAt: NOW },
  });
  const { snapshot, stats } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.records[0].id, 'm2');
  assert.equal(stats.recordsRemoved, 1);
});

test('合并：墓碑双向并集（任一端删过就删）', () => {
  const local = snap({
    records: [],
    deleted: { records: ['m1'], biases: [], scenes: [], updatedAt: NOW },
  });
  const remote = snap({
    records: [rec('m2', '远端还有这条')],
    deviceId: 'dev_b',
    deleted: { records: ['m2'], biases: [], scenes: [], updatedAt: NOW },
  });
  const { snapshot } = mergeSnapshots(local, remote);
  assert.equal(snapshot.records.length, 0);
});

test('合并：场景成员取并集（不丢成员）', () => {
  const local = snap({
    scenes: [{ id: 's1', family: 'work', title: '场景一', content: 'c', recordIds: ['m1'], createdAt: days(3), updatedAt: days(1) }],
  });
  const remote = snap({
    scenes: [{ id: 's1', family: 'work', title: '场景一', content: 'c', recordIds: ['m2'], createdAt: days(3), updatedAt: days(5) }],
    deviceId: 'dev_b',
  });
  const { snapshot } = mergeSnapshots(local, remote);
  assert.equal(snapshot.scenes.length, 1);
  assert.deepEqual(snapshot.scenes[0].recordIds.sort(), ['m1', 'm2']);
});

test('合并：L3 画像取 updatedAt 晚者（整体重写，不混拼）', () => {
  // 本机较旧 → 远端较新 → 远端胜
  const local = snap({ personas: { chat: { content: '本机画像', updatedAt: days(5) }, work: null } });
  const remote = snap({
    personas: { chat: { content: '远端画像', updatedAt: days(1) }, work: null },
    deviceId: 'dev_b',
  });
  const { snapshot, stats } = mergeSnapshots(local, remote);
  assert.equal(snapshot.personas.chat.content, '远端画像');
  assert.equal(stats.personasUpdated, 1);

  // 本机较新 → 本机胜
  const local2 = snap({ personas: { chat: { content: '本机新', updatedAt: days(1) }, work: null } });
  const remote2 = snap({
    personas: { chat: { content: '远端旧', updatedAt: days(5) }, work: null },
    deviceId: 'dev_b',
  });
  const r2 = mergeSnapshots(local2, remote2);
  assert.equal(r2.snapshot.personas.chat.content, '本机新');
});

test('合并：远端快照不可用时原样返回本地', () => {
  const local = snap({ records: [rec('m1', '只有本机')] });
  const { snapshot, skipped } = mergeSnapshots(local, null);
  assert.equal(snapshot.records.length, 1);
  assert.ok(skipped);
});

// ============ 编码 ============

test('编码：gzip 往返 + 摘要是内容的 sha256', () => {
  const s = snap({ records: [rec('m1', '要压缩的内容')] });
  const gz = encodeSnapshot(s);
  assert.ok(gz.length > 0);
  const back = decodeSnapshot(gz);
  assert.equal(back.records[0].content, '要压缩的内容');
  assert.equal(snapshotDigest(s), snapshotDigest(decodeSnapshot(gz)));
});

test('编码：压缩确实变小（真实库量级）', () => {
  const many = [];
  for (let i = 0; i < 500; i++) many.push(rec(`m${i}`, `第 ${i} 条记忆：用户在讨论某个具体的工作项目细节与决策过程`.repeat(3)));
  const gz = encodeSnapshot(snap({ records: many }));
  const raw = Buffer.byteLength(JSON.stringify(snap({ records: many })), 'utf-8');
  assert.ok(gz.length < raw / 3, `压缩后 ${gz.length} 应远小于 ${raw}`);
});

// ============ 仓库坐标与设备 id ============

test('仓库坐标：多种写法都归一到 owner/repo', () => {
  assert.deepEqual(parseRepo({ sync: { repo: 'Hickey-Yuze/dsh-memory-sync' } }), { owner: 'Hickey-Yuze', repo: 'dsh-memory-sync' });
  assert.deepEqual(parseRepo({ sync: { repo: 'https://github.com/Hickey-Yuze/dsh-memory-sync' } }), { owner: 'Hickey-Yuze', repo: 'dsh-memory-sync' });
  assert.deepEqual(parseRepo({ sync: { repo: 'https://github.com/Hickey-Yuze/dsh-memory-sync.git' } }), { owner: 'Hickey-Yuze', repo: 'dsh-memory-sync' });
  assert.deepEqual(parseRepo({ sync: { repo: 'git@github.com:Hickey-Yuze/dsh-memory-sync.git' } }), { owner: 'Hickey-Yuze', repo: 'dsh-memory-sync' });
});

test('仓库坐标：不合法时报错（不静默用错仓库）', () => {
  assert.throws(() => parseRepo({ sync: { repo: '' } }), /未配置/);
  assert.throws(() => parseRepo({ sync: { repo: 'onlyname' } }), /不合法/);
});

test('设备 id：同一 dataDir 稳定，不同 dataDir 不同', () => {
  const a1 = resolveDeviceId({}, '/data/a');
  const a2 = resolveDeviceId({}, '/data/a');
  const b1 = resolveDeviceId({}, '/data/b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b1);
  assert.match(a1, /^dev_[0-9a-f]{12}$/);
});

test('设备 id：配置里显式指定时优先', () => {
  assert.equal(resolveDeviceId({ sync: { deviceId: 'dev_custom' } }, '/data/a'), 'dev_custom');
});

test('设备名：配置优先，否则用主机名（不为空）', () => {
  assert.equal(resolveDeviceName({ sync: { deviceName: 'Mac mini' } }, 'dev_a'), 'Mac mini');
  assert.ok(resolveDeviceName({}, 'dev_a').length > 0);
});

// ============ 快照构建 ============

test('构建快照：只含跨机资产，不含设备本地文件', () => {
  const s = snap();
  assert.ok(SYNCED_FILES.includes('records.json'));
  assert.ok(SYNCED_FILES.includes('scenes.json'));
  assert.ok(LOCAL_ONLY_FILES.includes('session-modes.json'));
  assert.ok(LOCAL_ONLY_FILES.includes('kb-index.json'));
  assert.ok(LOCAL_ONLY_FILES.includes('state.json'));
  assert.ok(!SYNCED_FILES.includes('session-modes.json'));
  assert.ok(s);
});

test('构建快照：从 store 取出 L1/L2/L3/偏差', async (t) => {
  await withStore(t, (store, dir) => {
    store.upsertRecord({ content: '用户偏好 pnpm', family: 'work', kind: 'fact' });
    store.upsertRecord({ content: '用户养了猫', family: 'chat', kind: 'opinion' });
    store.setPersona('work', '## 工作准则\n- 一条');
    store.upsertBias({ kind: 'judgment', scene: '场景', deviation: '错在这', rootCause: '因为', fix: '下次这样' });
    const s = buildSnapshot(store, dir, { deviceId: 'dev_x', deviceName: 'X' });
    assert.equal(s.records.length, 2);
    assert.equal(s.personas.work.content, '## 工作准则\n- 一条');
    assert.equal(s.biases.length, 1);
    assert.equal(s.deviceId, 'dev_x');
    assert.equal(s.l0, null); // 默认不同步 L0
  });
});

// ============ 落库 ============

test('落库：合并结果写回 store，远端新增的记忆进来', async (t) => {
  await withStore(t, (store, dir) => {
    store.upsertRecord({ content: '本机的一条', family: 'work' });
    const incoming = snap({
      records: [rec('m_remote', '远端的一条')],
      scenes: [{ id: 's_new', family: 'work', title: '远端场景', content: 'c', recordIds: [], createdAt: NOW, updatedAt: NOW }],
      personas: { chat: null, work: { content: '远端画像', updatedAt: NOW } },
      biases: [{ id: 'b_remote', no: 9, date: '2026-10-25', kind: 'judgment', scene: 's', deviation: 'd', rootCause: 'r', fix: 'f', tags: [], family: 'work', hits: 0, createdAt: NOW, updatedAt: NOW }],
    });
    const { backups } = applySnapshot(store, dir, incoming, { log: silentLog() });
    assert.equal(store.getRecords().length, 2);
    assert.ok(store.getRecords().some((r) => r.id === 'm_remote'));
    assert.equal(store.getScenes('work').length, 1);
    assert.equal(store.getPersona('work').content, '远端画像');
    assert.equal(store.getBiases().length, 1);
    assert.ok(backups.length > 0, '应生成备份');
    for (const b of backups) assert.ok(existsSync(b));
  });
});

test('落库：写前备份可用（备份内容 = 落库前状态）', async (t) => {
  await withStore(t, (store, dir) => {
    store.upsertRecord({ content: '落库前的内容', family: 'work' });
    const before = store.getRecords().length;
    const incoming = snap({ records: [rec('m_x', '新来的')] });
    const { backups } = applySnapshot(store, dir, incoming, { log: silentLog() });
    assert.equal(store.getRecords().length, before + 1);
    const recBak = backups.find((b) => b.endsWith('records.json.bak-sync-' ) || b.includes('records.json.bak-sync-'));
    assert.ok(recBak, '应有 records.json 备份');
    const bak = JSON.parse(readFileSync(recBak, 'utf-8'));
    assert.equal(bak.records.length, before);
    assert.equal(bak.records[0].content, '落库前的内容');
  });
});

test('落库：墓碑里的记录被删除', async (t) => {
  await withStore(t, (store, dir) => {
    const { record } = store.upsertRecord({ content: '要被远端删掉', family: 'work' });
    const incoming = snap({
      records: [],
      deleted: { records: [record.id], biases: [], scenes: [], updatedAt: NOW },
    });
    applySnapshot(store, dir, incoming, { log: silentLog() });
    assert.equal(store.getRecord(record.id), null);
  });
});

test('落库：墓碑落盘，重开后仍在（删除不会复活）', async (t) => {
  await withStore(t, (store, dir) => {
    const { record } = store.upsertRecord({ content: '删了', family: 'work' });
    const incoming = snap({ deleted: { records: [record.id], biases: [], scenes: [], updatedAt: NOW } });
    applySnapshot(store, dir, incoming, { log: silentLog() });
    const tomb = join(dir, 'sync-tombstones.json');
    assert.ok(existsSync(tomb));
    const parsed = JSON.parse(readFileSync(tomb, 'utf-8'));
    assert.deepEqual(parsed.records, [record.id]);
  });
});

test('落库：同 id 已存在时 hits 取 max（不因同步归零或累加）', async (t) => {
  await withStore(t, (store, dir) => {
    const { record } = store.upsertRecord({ content: '同一条', family: 'work' });
    store.getRecord(record.id).hits = 8;
    const incoming = snap({ records: [rec(record.id, '同一条', { hits: 3, updatedAt: NOW })] });
    applySnapshot(store, dir, incoming, { log: silentLog() });
    assert.equal(store.getRecord(record.id).hits, 8);
  });
});
