// 配置单测：脏值清洗 / 三层合并优先级 / 数据目录解析。

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, sanitizeConfig, mergeConfig, createConfig } from '../lib/config.js';

test('sanitizeConfig：未知键与错误类型被丢弃', () => {
  const clean = sanitizeConfig({
    enabled: true,
    evil: 'x',
    recall: { maxResults: 3, injected: 'hack', timeoutMs: 'not-a-number' },
    llm: { provider: 'p', model: 'm', temperature: Number.NaN },
  });
  assert.deepEqual(clean, {
    enabled: true,
    recall: { maxResults: 3 },
    llm: { provider: 'p', model: 'm' },
  });
});

test('mergeConfig：默认值 ⊕ YAML ⊕ overlay 优先级', () => {
  const merged = mergeConfig(DEFAULTS, { recall: { maxResults: 3 } }, { recall: { maxResults: 8, enabled: false }, extract: { minMessages: 2 } });
  assert.equal(merged.recall.maxResults, 8);
  assert.equal(merged.recall.enabled, false);
  assert.equal(merged.extract.minMessages, 2);
  assert.equal(merged.capture.maxMessageChars, DEFAULTS.capture.maxMessageChars); // 未触及键保持默认
  assert.equal(merged.recall.timeoutMs, DEFAULTS.recall.timeoutMs);
});

test('createConfig：overlay 即时生效且不覆盖 dataDir', () => {
  const dir = { current: { recall: { maxResults: 9 } } };
  const cfg = createConfig({ recall: { maxResults: 2 } }, { read: () => dir.current });
  assert.equal(cfg.effective().recall.maxResults, 9);
  dir.current = { dataDir: '/tmp/evil', recall: { maxResults: 1 } };
  // overlay 里的 dataDir 由 host 层删除；这里模拟 host 行为
  const overlay = { ...dir.current };
  delete overlay.dataDir;
  const cfg2 = createConfig({}, { read: () => overlay });
  assert.equal(cfg2.effective().recall.maxResults, 1);
  assert.equal(cfg2.effective().dataDir, DEFAULTS.dataDir);
});

test('resolveDataDir：默认 $DSH_HOME/dsh-memory，显式 dataDir 优先', () => {
  const oldHome = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = '/tmp/fake-dsh';
    const cfg = createConfig({}, null);
    assert.equal(cfg.resolveDataDir(), '/tmp/fake-dsh/dsh-memory');
    const cfg2 = createConfig({ dataDir: '/custom/mem' }, null);
    assert.equal(cfg2.resolveDataDir(), '/custom/mem');
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
  }
});
