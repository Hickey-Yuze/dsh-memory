// store 单测：L0 读写切片 / L1 记录增改删 / L2 场景替换与回填 / L3 画像 / 活动 / 记账 / 清空。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.js';

function silentLog() {
  return { debug() {}, info() {}, warn() {}, error() {}, tail: () => [], errors: () => [], lastError: () => null };
}

function withStore(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mem-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return fn(createStore(dir, silentLog()), dir);
}

test('L0 追加与读取切片', async (t) => {
  await withStore(t, (store) => {
    store.appendConversationMeta('s1', { cwd: '/tmp/ws' });
    for (let i = 1; i <= 8; i++) store.appendConversation('s1', i % 2 === 1 ? 'user' : 'assistant', `消息 ${i}`);
    const tail = store.readConversationTail('s1', 4);
    assert.equal(tail.length, 4);
    assert.equal(tail[3].text, '消息 8');
    const slice = store.readConversationSlice('s1', 2, 2);
    assert.equal(slice.length, 4); // 2 条新 + 2 条背景
    assert.equal(slice[0].text, '消息 5');
    assert.ok(store.conversationStats().messages >= 8);
  });
});

test('L1 记录：新增 / 合并更新 / 删除', async (t) => {
  await withStore(t, (store) => {
    const { record, created } = store.upsertRecord({ content: '用户偏好 pnpm', tags: ['工具'], sessionId: 's1' });
    assert.ok(created && record.id.startsWith('m_'));
    const again = store.upsertRecord({ id: record.id, content: '用户偏好 pnpm 与 node', tags: ['工具'], sessionId: 's1' });
    assert.equal(again.created, false);
    assert.equal(again.record.content, '用户偏好 pnpm 与 node');
    const activity = store.recentActivity(10);
    assert.equal(activity[0].verb, 'updated');
    assert.equal(store.deleteRecord(record.id), 1);
    assert.equal(store.getRecords().length, 0);
  });
});

test('L1 记忆类型：kind 落盘与兜底，存量无 kind 记录读入为 fact', async (t) => {
  await withStore(t, (store, dir) => {
    const f = store.upsertRecord({ content: '用户偏好 pnpm', kind: 'fact' }).record;
    const o = store.upsertRecord({ content: '我推测他会换 Mac', kind: 'opinion' }).record;
    const c = store.upsertRecord({ content: '下次提醒体检', kind: 'commitment' }).record;
    const bad = store.upsertRecord({ content: '类型非法', kind: 'guess' }).record;
    const none = store.upsertRecord({ content: '没写类型' }).record;
    assert.equal(f.kind, 'fact');
    assert.equal(o.kind, 'opinion');
    assert.equal(c.kind, 'commitment');
    assert.equal(bad.kind, 'fact');  // 非法 → fact
    assert.equal(none.kind, 'fact'); // 缺失 → fact
    // 合并更新：传 kind 可改正类型；不传时保留旧类型
    store.upsertRecord({ id: o.id, content: '我推测他会换 Mac（用户已确认）', kind: 'fact' });
    assert.equal(store.getRecord(o.id).kind, 'fact');
    store.upsertRecord({ id: c.id, content: '下次提醒体检（改期）' });
    assert.equal(store.getRecord(c.id).kind, 'commitment');
    // 落盘可见
    const onDisk = JSON.parse(readFileSync(join(dir, 'records.json'), 'utf-8')).records;
    assert.equal(onDisk.find((r) => r.id === o.id).kind, 'fact');
    assert.equal(onDisk.find((r) => r.id === c.id).kind, 'commitment');
    // 存量库（无 kind 列）读入后为 fact，family 语义不受影响
    const legacyDir = mkdtempSync(join(tmpdir(), 'dsh-mem-legacy-'));
    t.after(() => rmSync(legacyDir, { recursive: true, force: true }));
    writeFileSync(join(legacyDir, 'records.json'), JSON.stringify({ version: 2, records: [{ id: 'm_old', content: '老记忆', family: 'work' }] }), 'utf-8');
    const legacy = createStore(legacyDir, silentLog());
    assert.equal(legacy.getRecord('m_old').kind, 'fact');
    assert.equal(legacy.getRecord('m_old').family, 'work');
  });
});

test('L2 场景替换：recordIds 校验与 sceneId 回填', async (t) => {
  await withStore(t, (store) => {
    const a = store.upsertRecord({ content: 'A' }).record;
    const b = store.upsertRecord({ content: 'B' }).record;
    const scenes = store.replaceScenes([
      { id: null, title: '工具链', content: 'A 与 B 概述', record_ids: [a.id, b.id, 'm_不存在'] },
    ]);
    assert.equal(scenes.length, 1);
    assert.ok(scenes[0].id.startsWith('s_'));
    assert.deepEqual(scenes[0].recordIds, [a.id, b.id]); // 未知 id 被剔除
    assert.equal(store.getRecord(a.id).sceneId, scenes[0].id);
    assert.equal(store.getScene('工具链').id, scenes[0].id); // 标题模糊匹配
  });
});

test('L3 画像（分族）+ 活动 + 记账 + 清空', async (t) => {
  const dir0 = join(tmpdir(), 'dsh-mem-wipe-');
  const dir = mkdtempSync(dir0);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir, silentLog());
  store.setPersona('chat', '用户是前端工程师');
  assert.match(store.getPersona('chat').content, /前端/);
  assert.equal(store.getPersona('work'), null);
  store.setPersona('work', '团队当前聚焦记忆插件开发');
  assert.match(store.getPersona('work').content, /记忆插件/);
  const personas = store.getPersonas();
  assert.ok(personas.chat.content && personas.work.content);
  // v1 单文档画像迁移到 chat 桶
  writeFileSync(join(dir, 'persona.json'), JSON.stringify({ version: 1, content: '旧版画像内容', updatedAt: 123 }), 'utf-8');
  const storeMigrated = createStore(dir, silentLog());
  assert.match(storeMigrated.getPersona('chat').content, /旧版画像/);
  assert.equal(storeMigrated.getPersona('work'), null);
  store.upsertRecord({ content: 'x' });
  store.appendUsage({ layer: 'l1', purpose: 'extract', provider: 'p', model: 'm', inChars: 100, outputTokens: 5, ok: true });
  store.appendUsage({ layer: 'l1', purpose: 'extract', provider: 'p', model: 'm', inChars: 10, ok: false, error: 'boom' });
  assert.equal(store.usageSince(7).length, 2);
  const state = store.getState();
  assert.equal(state.stats.distillCalls, 2);
  assert.equal(state.stats.distillFailures, 1);
  assert.ok(existsSync(join(dir, 'records.json')));
  store.wipe({ keepConversations: true });
  assert.equal(store.getRecords().length, 0);
  assert.equal(store.getPersona('chat'), null);
  // L0 保留
  store.appendConversation('keep', 'user', 'hello');
  store.wipe({ keepConversations: true });
  assert.ok(readFileSync(join(dir, 'conversations', 'keep.jsonl'), 'utf-8').includes('hello'));
  // 坏 JSON 记录文件不致命
  store.upsertRecord({ content: 'y' });
  const { writeFileSync: wf } = await import('node:fs');
  wf(join(dir, 'records.json'), '{corrupt', 'utf-8');
  const store2 = createStore(dir, silentLog());
  assert.equal(store2.getRecords().length, 0); // 回退空集而不是崩溃
});

test('L1/L2 分族：family 标签、同族过滤、跨族场景隔离', async (t) => {
  await withStore(t, (store) => {
    const c = store.upsertRecord({ content: '个人偏好', family: 'chat' }).record;
    const w = store.upsertRecord({ content: '项目决策', family: 'work' }).record;
    const legacy = store.upsertRecord({ content: '旧记录无族标签' }).record; // 兜底 chat
    assert.equal(store.getRecords('chat').length, 2);
    assert.equal(store.getRecords('work').length, 1);
    assert.equal(store.getRecords().length, 3);
    // 场景替换只动目标族
    store.replaceScenes([{ title: '工作场景', content: 'x', record_ids: [w.id] }], 'work');
    store.replaceScenes([{ title: '个人场景', content: 'y', record_ids: [c.id] }], 'chat');
    assert.equal(store.getScenes('work').length, 1);
    assert.equal(store.getScenes('chat').length, 1);
    assert.equal(store.getScene('工作场景', 'chat'), null); // 跨族查不到
    assert.equal(store.getScene('工作场景', 'work').family, 'work');
    assert.equal(store.getRecord(w.id).sceneId, store.getScenes('work')[0].id);
    assert.equal(store.getRecord(legacy.id).family, 'chat');
    // 跨族 record_ids 不会进场景（recordIds 校验带族）
    store.replaceScenes([{ title: '越权场景', content: 'z', record_ids: [c.id] }], 'work');
    assert.deepEqual(store.getScenes('work')[0].recordIds, []);
    // 分族水位
    store.addNewSince('work', 3);
    assert.equal(store.familyWater('work').newSinceL2, 3);
    assert.equal(store.familyWater('chat').newSinceL2, 0);
    void legacy;
  });
});

test('偏差档案：入档 / 自动编号 / 更新 / 分族 / 落盘重开 / 重建不丢', async (t) => {
  await withStore(t, (store, dir) => {
    const a = store.upsertBias({ scene: 'dsh-memory 存量改盘', deviation: '以为重启够快就不会被覆盖', rootCause: '插件内存里是旧 kind', fix: '先关 extract.enabled 再落盘', family: 'chat', tags: ['dsh-memory'] });
    assert.ok(a.created && a.bias.id.startsWith('b_'));
    assert.equal(a.bias.no, 1);
    assert.equal(a.bias.kind, 'judgment'); // 缺省 kind 归一
    assert.equal(a.bias.date.length, 10);
    const w = store.upsertBias({ scene: '项目决策', deviation: '改完没跑验证', fix: '跑 npm test', family: 'work', kind: 'recall-miss' });
    assert.equal(w.bias.no, 2);
    assert.equal(w.bias.kind, 'recall-miss');
    // 分族过滤
    assert.equal(store.getBiases('chat').length, 1);
    assert.equal(store.getBiases('work').length, 1);
    assert.equal(store.getBiases().length, 2);
    // 更新：同 id 合并且不新增
    const upd = store.upsertBias({ id: a.bias.id, deviation: '以为重启够快就不会被覆盖', fix: '先关 extract.enabled 再落盘再重启' });
    assert.equal(upd.created, false);
    assert.equal(upd.bias.no, 1);
    assert.equal(store.getBiases().length, 2);
    assert.equal(store.getBias(a.bias.id).fix, '先关 extract.enabled 再落盘再重启');
    // 字段裁剪与非法 kind / 超量标签兜底
    const junk = store.upsertBias({ deviation: 'x'.repeat(900), fix: 'y', kind: '不存在的类型', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    assert.equal(junk.bias.deviation.length, 400);
    assert.equal(junk.bias.kind, 'judgment');
    assert.equal(junk.bias.tags.length, 6);
    // 落盘 + 重开：编号连续、内容保留
    assert.ok(existsSync(join(dir, 'bias.json')));
    const reopened = createStore(dir, silentLog());
    assert.equal(reopened.getBiases().length, 3);
    assert.equal(reopened.getBiases()[1].no, 2);
    assert.equal(reopened.getBiases()[1].kind, 'recall-miss');
    assert.equal(reopened.counts().biases, 3);
    // 全量重建（wipe）不丢偏差档案：它不是从对话派生的
    reopened.wipe({ keepConversations: true });
    assert.equal(reopened.getBiases().length, 3);
    // 删除
    assert.equal(reopened.deleteBias(a.bias.id), 1);
    assert.equal(reopened.deleteBias('不存在'), 0);
    assert.equal(reopened.getBiases().length, 2);
    assert.equal(reopened.counts().biases, 2);
  });
});

test('合并近重复：hits 累加、tags 并集、kind 取非 fact、内容取最长、场景引用改指保留者', async (t) => {
  await withStore(t, (store) => {
    const a = store.upsertRecord({ content: '用户偏好 pnpm', tags: ['甲'], family: 'work' });
    const b = store.upsertRecord({ content: '用户偏好 pnpm，CI 里也跑 pnpm test', tags: ['乙'], family: 'work', kind: 'commitment' });
    const c = store.upsertRecord({ content: '用户偏好 pnpm 与 workspace 多包', tags: ['丙'], family: 'work' });
    a.record.hits = 5;
    b.record.hits = 2;
    store.replaceScenes([{ title: '工具链', content: 'x', record_ids: [b.record.id, c.record.id] }], 'work');
    const merged = store.mergeRecords(a.record.id, [b.record.id, c.record.id]);
    assert.equal(merged.dropped, 2);
    assert.equal(merged.record.hits, 7);
    assert.equal(merged.record.kind, 'commitment');
    assert.match(merged.record.content, /CI 里也跑/);
    assert.deepEqual(merged.record.tags, ['甲', '乙', '丙']);
    assert.equal(store.getRecords('work').length, 1);
    assert.equal(store.getRecord(b.record.id), null);
    assert.deepEqual(store.getScene('工具链').recordIds, [a.record.id]);
    assert.equal(store.mergeRecords('m_不存在', ['x']), null);
  });
});

test('撤销合并：恢复被并入记录、保留者字段回退、场景引用回滚、台账用完即清', async (t) => {
  await withStore(t, (store) => {
    const a = store.upsertRecord({ content: '用户偏好 pnpm', tags: ['甲'], family: 'work' });
    const b = store.upsertRecord({ content: '用户偏好 pnpm，CI 里也跑 pnpm test', tags: ['乙'], family: 'work', kind: 'commitment' });
    const c = store.upsertRecord({ content: '用户偏好 pnpm 与 workspace 多包', tags: ['丙'], family: 'work' });
    a.record.hits = 5;
    const snapshot = { content: a.record.content, tags: [...a.record.tags], kind: a.record.kind, hits: a.record.hits };
    store.replaceScenes([{ title: '工具链', content: 'x', record_ids: [b.record.id, c.record.id] }], 'work');
    const merged = store.mergeRecords(a.record.id, [b.record.id, c.record.id]);
    assert.ok(merged.batchId, '合并应产出批次号');
    assert.equal(store.listMerges().length, 1);
    assert.equal(store.listMerges()[0].dropped, 2);
    assert.equal(store.getRecords('work').length, 1);
    assert.deepEqual(store.getScene('工具链').recordIds, [a.record.id]);

    const undone = store.undoMerge();
    assert.equal(undone.batches, 1);
    assert.equal(undone.restored, 2);
    assert.equal(store.getRecords('work').length, 3);
    assert.equal(store.getRecord(b.record.id).kind, 'commitment');
    assert.equal(store.getRecord(c.record.id).content, '用户偏好 pnpm 与 workspace 多包');
    assert.equal(store.getRecord(a.record.id).content, snapshot.content);
    assert.deepEqual(store.getRecord(a.record.id).tags, snapshot.tags);
    assert.equal(store.getRecord(a.record.id).kind, snapshot.kind);
    assert.equal(store.getRecord(a.record.id).hits, snapshot.hits);
    assert.deepEqual(store.getScene('工具链').recordIds, [b.record.id, c.record.id], '场景引用应回滚');
    assert.equal(store.listMerges().length, 0, '台账已清');

    assert.deepEqual(store.undoMerge(), { batches: 0, restored: 0 });
    assert.deepEqual(store.undoMerge('mg_不存在'), { batches: 0, restored: 0 });
  });
});

test('撤销合并：all 一次回滚多批（后并的先撤）', async (t) => {
  await withStore(t, (store) => {
    const a = store.upsertRecord({ content: '同一条记忆 A 版本一', family: 'work' });
    const b = store.upsertRecord({ content: '同一条记忆 A 版本二', family: 'work' });
    store.mergeRecords(a.record.id, [b.record.id]);
    const c = store.upsertRecord({ content: '同一条记忆 C 版本一', family: 'work' });
    const d = store.upsertRecord({ content: '同一条记忆 C 版本二', family: 'work' });
    store.mergeRecords(c.record.id, [d.record.id]);
    assert.equal(store.getRecords('work').length, 2);
    const undone = store.undoMerge('all');
    assert.equal(undone.batches, 2);
    assert.equal(undone.restored, 2);
    assert.equal(store.getRecords('work').length, 4);
    assert.equal(store.listMerges().length, 0);
  });
});

test('L2 跳过标记：不再入队，内容更新后重新入队', async (t) => {
  await withStore(t, (store) => {
    const { record } = store.upsertRecord({ content: '零散记忆', tags: [], sessionId: 's1' });
    assert.equal(store.getPendingRecords('chat').length, 1);
    assert.equal(store.markL2Skipped([record.id]), 1);
    assert.equal(store.getPendingRecords('chat').length, 0, '跳过标记后不再进待整合队列');
    assert.equal(store.markL2Skipped([record.id]), 0, '重复标记不应计数');
    store.upsertRecord({ id: record.id, content: '零散记忆（补充）', tags: [], sessionId: 's1' });
    assert.equal(store.getPendingRecords('chat').length, 1, '内容更新后应重新参与整合');
  });
});
