// store 单测：L0 读写切片 / L1 记录增改删 / L2 场景替换与回填 / L3 画像 / 活动 / 记账 / 清空。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

test('L3 画像 + 活动 + 记账 + 清空', async (t) => {
  const dir0 = join(tmpdir(), 'dsh-mem-wipe-');
  const dir = mkdtempSync(dir0);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createStore(dir, silentLog());
  store.setPersona('用户是前端工程师');
  assert.match(store.getPersona().content, /前端/);
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
  assert.equal(store.getPersona(), null);
  // L0 保留
  store.appendConversation('keep', 'user', 'hello');
  store.wipe({ keepConversations: true });
  assert.ok(readFileSync(join(dir, 'conversations', 'keep.jsonl'), 'utf-8').includes('hello'));
  // 坏 JSON 记录文件不致命
  store.upsertRecord({ content: 'y' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'records.json'), '{corrupt', 'utf-8');
  const store2 = createStore(dir, silentLog());
  assert.equal(store2.getRecords().length, 0); // 回退空集而不是崩溃
});
