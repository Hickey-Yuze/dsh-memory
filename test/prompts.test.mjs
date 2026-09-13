// Prompt 解析单测：宽松 JSON 抽取（栅栏/尾逗号/垃圾）与 L1/L2/L3 结构校验。

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLoose, parseL1Output, parseL2Output, parseL3Output, buildL1Prompt, buildL2Prompt, buildL3Prompt } from '../lib/prompts.js';

test('extractJsonLoose：栅栏 / 前后杂讯 / 尾逗号 / 纯垃圾', () => {
  assert.deepEqual(extractJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonLoose('好的，结果如下：{"a":[1,2,]} 以上'), { a: [1, 2] });
  assert.equal(extractJsonLoose('完全没有 JSON'), null);
  assert.equal(extractJsonLoose('{"broken": '), null);
});

test('parseL1Output：合法条目保留，脏条目丢弃，上限生效', () => {
  const items = parseL1Output(JSON.stringify({
    memories: [
      { content: '用户偏好 pnpm', tags: ['工具', 123] },
      { content: '' },                       // 空 → 丢
      'not-an-object',                       // 脏 → 丢
      { content: '  有空白  ', tags: [] },
    ],
  }), { maxMemories: 8 });
  assert.equal(items.length, 2);
  assert.equal(items[0].content, '用户偏好 pnpm');
  assert.deepEqual(items[0].tags, ['工具']);
  assert.equal(items[1].content, '有空白');
  const capped = parseL1Output(JSON.stringify({ memories: Array.from({ length: 20 }, (_, i) => ({ content: `m${i}` })) }), { maxMemories: 8 });
  assert.equal(capped.length, 8);
  assert.equal(parseL1Output('不是 JSON'), null);
});

test('parseL2Output：结构校验', () => {
  const parsed = parseL2Output(JSON.stringify({
    scenes: [
      { id: 's_exist', title: '工具链', content: '# 工具', record_ids: ['a', 42, 'b'] },
      { title: '', content: '无标题' }, // 丢
    ],
    dropped_ids: ['c'],
  }));
  assert.equal(parsed.scenes.length, 1);
  assert.deepEqual(parsed.scenes[0].record_ids, ['a', 'b']);
  assert.deepEqual(parsed.droppedIds, ['c']);
  assert.equal(parseL2Output('{"scenes":[]}'), null);
});

test('parseL3Output：画像长度下限', () => {
  assert.equal(parseL3Output(JSON.stringify({ persona: '太短' })), null);
  const persona = parseL3Output(JSON.stringify({ persona: '用户是前端工程师，长期维护 XX 项目，偏好 TypeScript 与 pnpm。' }));
  assert.match(persona, /前端工程师/);
});

test('Prompt 构造：包含记录与已有场景，输入截断生效', () => {
  const { system, user } = buildL1Prompt({
    slice: [{ r: 'user', text: '我们用 pnpm 吧' }, { r: 'assistant', text: '好的' }],
    backgroundCount: 0,
    existingPool: [{ id: 'm_1', content: '旧记忆' }],
    maxMemories: 8,
  });
  assert.match(system, /已有记忆候选|JSON/);
  assert.match(user, /pnpm/);
  assert.match(user, /\[m_1\] 旧记忆/);

  const l2 = buildL2Prompt({ records: [{ id: 'm_1', content: 'x', updatedAt: 0 }], existingScenes: [{ id: 's_1', title: 'T', recordIds: [], updatedAt: 0 }], maxScenes: 12, sceneContextLimit: 3, maxInputChars: 200000 });
  assert.match(l2.user, /\[m_1\]/);
  assert.match(l2.user, /\[s_1\] T/);

  const l3 = buildL3Prompt({ oldPersona: '旧画像', records: [{ content: '记忆一' }], maxInputChars: 200000 });
  assert.match(l3.user, /旧画像/);
  assert.match(l3.user, /记忆一/);

  const clipped = buildL3Prompt({ oldPersona: 'x'.repeat(300000), records: [], maxInputChars: 50000 });
  assert.ok(clipped.user.length <= 50100);
});
