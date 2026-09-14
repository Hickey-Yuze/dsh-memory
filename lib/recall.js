// dsh-memory — 召回注入：agent/pre-step 瀑布流里，在新用户消息进入模型前
// 检索相关 L1 记忆并追加一条合成 user 消息（消息侧注入，用户可在会话流看到）。
// 读侧三级闸门（对齐原版）：总开关 → off 档（完全隐身）→ 会话注入覆盖（只写不读）。
// 族过滤：chat/work 档只检索同族记忆，auto 档跨族检索。
// 检索策略：关键词（默认）/ hybrid（配置了嵌入源且就绪时 RRF 融合）。
// 硬性预算：总超时 recall.timeoutMs、单条/整轮字符上限；任何异常都静默跳过，
// 绝不阻塞或破坏 agent 步骤。同会话去重持久化（recall-dedupe.js）：
// /compact 压缩后自动重置。
// 注：createUserMessage 由 host.js 注入（保持本模块零捆绑包依赖，便于单测）。

import { rankDocs, rankDocsHybrid } from './search.js';

export function createRecall({ store, config, log, modes, embedding, dedupe }) {
  function modeOf(sid) {
    try { return modes ? modes.get(sid) : 'auto'; } catch { return 'auto'; }
  }

  function onCompaction(sid) {
    if (dedupe) dedupe.reset(sid);
    log.info('上下文已压缩，召回去重已重置');
  }

  /** 读侧闸门（消息侧注入与稳定区共用）：总开关 → off 档 → 会话注入覆盖。 */
  function shouldInject(sid) {
    const cfg = config.effective();
    if (!cfg.enabled || !cfg.recall.enabled) return false;
    if (modeOf(sid) === 'off') return false;
    if (modes && !modes.resolvedRecall(sid, true)) return false; // 会话覆盖关（只写不读）
    return true;
  }

  /** 从 decision.messages 里找最后一条真实用户消息的文本（跳过插件合成消息）。 */
  function lastUserText(messages) {
    if (!Array.isArray(messages)) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (!message || message.role !== 'user') continue;
      if (message.source && message.source.kind === 'plugin') continue;
      const parts = [];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
        }
      }
      const text = parts.join('\n').trim();
      if (text) return text;
    }
    return null;
  }

  function formatRecall(hits, { maxCharsPerMemory }) {
    if (hits.length === 0) return '';
    const lines = [];
    for (const { item } of hits) {
      let content = item.content;
      const cap = Math.max(0, Number(maxCharsPerMemory) || 0);
      let truncated = false;
      if (cap > 0 && content.length > cap) {
        content = `${content.slice(0, cap)}…`;
        truncated = true;
      }
      const date = item.updatedAt ? new Date(item.updatedAt).toISOString().slice(0, 10) : '';
      const line = `- ${date ? `[${date}] ` : ''}${content}${truncated ? '（已截断，可用 memory_search 查全文）' : ''}`;
      lines.push(line);
    }
    const head = '<recalled-memory>\n以下是与当前问题可能相关的长期记忆（dsh-memory 自动召回，供参考）：\n';
    const tail = '\n</recalled-memory>';
    return `${head}${lines.join('\n')}${tail}`;
  }

  function enforceTotalBudget(formatted, maxTotal) {
    const max = Math.max(0, Number(maxTotal) || 0);
    if (max <= 0 || formatted.length <= max) return formatted;
    const head = formatted.slice(0, formatted.indexOf('\n') + 1);
    const body = formatted.slice(head.length, formatted.lastIndexOf('</recalled-memory>'));
    const lines = body.split('\n');
    const kept = [];
    let size = head.length + '</recalled-memory>'.length + 40;
    for (const line of lines) {
      if (size + line.length + 1 > max) break;
      kept.push(line);
      size += line.length + 1;
    }
    if (kept.length === 0) return '';
    kept.push('（其余相关记忆因预算截断，可用 memory_search 查询）');
    return `${head}${kept.join('\n')}\n</recalled-memory>`;
  }

  /**
   * 计算本轮注入文本；无命中 / 关闭 / 超时返回 ''。
   * @param sid 会话 id
   * @param query 用户消息文本
   */
  async function recallText(sid, query) {
    const cfg = config.effective();
    if (!cfg.enabled || !cfg.recall.enabled) return '';
    if (!shouldInject(sid)) return ''; // off 档 / 只写覆盖：读侧闸门兜底
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) return '';
    const budget = new Promise((resolve) => {
      if (cfg.recall.timeoutMs > 0) {
        setTimeout(() => {
          log.warn(`召回超时（${cfg.recall.timeoutMs}ms），本轮跳过`);
          resolve('');
        }, cfg.recall.timeoutMs);
      }
    });
    const work = recallTextNow(sid, trimmed, cfg);
    return Promise.race([work, budget]);
  }

  async function recallTextNow(sid, trimmed, cfg) {
    try {
      const mode = modeOf(sid);
      const family = mode === 'chat' || mode === 'work' ? mode : undefined;
      const records = store.getRecords(family).map((r) => ({ ...r, text: r.content }));
      if (records.length === 0) return '';
      const injected = dedupe ? dedupe.seen(sid) : new Map();
      const overFetch = Math.max(1, cfg.recall.maxResults) + Math.min(injected.size, 64); // 先多取，去重后裁剪

      // 检索策略：嵌入源就绪 → hybrid RRF；否则关键词
      let hits;
      let queryVector = null;
      if (embedding && embedding.ready() && !embedding.sourceChanged()) {
        queryVector = await embedding.embedQuery(trimmed);
      }
      if (queryVector) {
        const vectors = new Map();
        for (const r of records) {
          const v = embedding.getVector(r.id);
          if (v) vectors.set(r.id, v);
        }
        hits = rankDocsHybrid(trimmed, records, {
          decayHalfLifeDays: cfg.recall.decayHalfLifeDays,
          limit: overFetch,
          vectorRoute: { queryVector, vectors },
        });
      } else {
        hits = rankDocs(trimmed, records, {
          threshold: cfg.recall.scoreThreshold,
          decayHalfLifeDays: cfg.recall.decayHalfLifeDays,
          limit: overFetch,
        });
      }

      const fresh = hits.filter(({ item }) => !injected.has(`${item.id}:${item.updatedAt}`));
      const selected = fresh.slice(0, Math.max(1, cfg.recall.maxResults));
      if (selected.length === 0) return '';
      if (dedupe) {
        dedupe.mark(sid, selected.map(({ item }) => `${item.id}:${item.updatedAt}`));
      }
      const formatted = enforceTotalBudget(formatRecall(selected, cfg.recall), cfg.recall.maxTotalRecallChars);
      if (formatted) {
        const state = store.getState();
        state.stats.recallInjections = (state.stats.recallInjections || 0) + 1;
        state.stats.recallRecords = (state.stats.recallRecords || 0) + selected.length;
        state.stats.lastRecallAt = Date.now();
        store.saveState();
        for (const { item } of selected) {
          const record = store.getRecord(item.id);
          if (record) record.hits = (record.hits || 0) + 1;
        }
        log.info(`召回注入 ${selected.length} 条 L1（会话 ${sid.slice(0, 12)}…，档位 ${mode}）`);
      }
      return formatted;
    } catch (e) {
      log.warn(`召回检索失败（本轮跳过）: ${e && e.message ? e.message : e}`);
      return '';
    }
  }

  function forgetSession(sid) {
    if (dedupe) dedupe.reset(sid);
  }

  return { recallText, onCompaction, lastUserText, forgetSession, shouldInject, modeOf };
}

/** 挂载 pre-step 注入（prepend: true 保证最先有机会改写 decision）。 */
export function attachRecall(ctx, { recall, config, log, createUserMessage }) {
  return ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    let decision;
    try {
      decision = await next();
    } catch (e) {
      throw e;
    }
    try {
      if (!decision || decision.kind === 'reject' || signal.aborted) return decision;
      if (step !== 1) return decision; // 只在每轮第一步（新用户消息之后）注入
      const cfg = config.effective();
      if (!cfg.enabled || !cfg.recall.enabled) return decision;
      if (!agent || !agent.session || typeof agent.session.id !== 'string') return decision;
      const sid = agent.session.id;
      if (!recall.shouldInject(sid)) return decision; // off 档 / 只写覆盖
      // decision.messages 会在 pre-step 之前被 claim，我们取下一步真正发给模型的消息列表
      const query = recall.lastUserText(decision.messages);
      if (!query) return decision;
      const text = await recall.recallText(sid, query);
      if (!text) return decision;
      return {
        ...decision,
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'dsh-memory', form: 'snapshot', sections: [{ name: 'dsh-memory', text }] },
        })],
      };
    } catch (e) {
      log.warn(`召回注入失败（跳过本轮）: ${e.message || e}`);
      return decision;
    }
  }, { prepend: true });
}
