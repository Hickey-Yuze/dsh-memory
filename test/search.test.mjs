// 检索单测：CJK 二元组分词 / 命中评分 / 阈值过滤 / 时效衰减半衰期 / 排序。

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, scoreTokens, rankDocs, recencyFactor } from '../lib/search.js';

test('分词：CJK 二元组 + 拉丁词', () => {
  const tokens = tokenize('用户偏好的构建工具 pnpm');
  assert.ok(tokens.has('用户'));
  assert.ok(tokens.has('偏好'));
  assert.ok(tokens.has('构建'));
  assert.ok(tokens.has('pnpm'));
});

test('分词：单个汉字回退一元组', () => {
  const tokens = tokenize('爱');
  assert.ok(tokens.has('爱'));
});

test('评分与排序：命中数高的靠前，阈值过滤', () => {
  const docs = [
    { id: 'a', text: '用户偏好使用 pnpm 管理依赖', updatedAt: Date.now() },
    { id: 'b', text: '项目部署在 Vercel', updatedAt: Date.now() },
    { id: 'c', text: 'pnpm 与 pnpm workspace 的配置', updatedAt: Date.now() },
  ];
  const ranked = rankDocs('pnpm 依赖', docs, { threshold: 0, limit: 10 });
  assert.equal(ranked[0].item.id, 'a'); // pnpm + 依赖 双命中
  assert.ok(ranked.some((r) => r.item.id === 'c'));
  assert.ok(!ranked.some((r) => r.item.id === 'b')); // 零命中被过滤
});

test('时效衰减：老记忆最多损失一半排序分（地板 0.5）', () => {
  const now = Date.now();
  assert.equal(recencyFactor(now, now, 30), 1);
  const fresh = recencyFactor(now - 30 * 86400000, now, 30); // 一个半衰期
  assert.ok(Math.abs(fresh - 0.5) < 0.01);
  const ancient = recencyFactor(now - 1000 * 86400000, now, 30);
  assert.equal(ancient, 0.5); // 地板兜底
  assert.equal(recencyFactor(now, now, 0), 1); // 0 = 关闭
});

test('衰减影响排序但不把高相关老记忆挤出列表', () => {
  const now = Date.now();
  const docs = [
    { id: 'fresh-weak', text: '用户喜欢深色主题', updatedAt: now },
    { id: 'old-strong', text: '用户的部署流程是 pnpm build && vercel deploy', updatedAt: now - 120 * 86400000 },
  ];
  const ranked = rankDocs('部署流程 pnpm build vercel', docs, { threshold: 0, decayHalfLifeDays: 30, now, limit: 2 });
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].item.id, 'old-strong'); // 高相关的老记忆即便衰减仍排首位（地板保证不沉底）
  assert.ok(ranked[0].score >= ranked[0].factor * 0.5);
});

test('scoreTokens：子串部分加权', () => {
  const q = tokenize('pnpm workspace');
  const docTokens = tokenize('pnpmworkspacenote'); // 无独立词元但有子串
  const score = scoreTokens(q, docTokens, 'pnpmworkspacenote');
  assert.ok(score > 0 && score < 2);
});
