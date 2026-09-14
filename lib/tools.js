// dsh-memory — 模型可调用的记忆工具（对齐 dsh-layered-memory 三件套）：
//   memory_search        语义关键词检索 L1 原子记忆（按会话档位过滤族）
//   conversation_search  跨会话检索 L0 原始对话（L0 不分族）
//   memory_read_scene    读取 L2 场景块全文（按会话档位过滤族）
// 工具路径不过滤阈值（召回路径才过滤），让模型自行判断。
// 读侧闸门：off 档会话返回隐身提示；只写覆盖（recall=false）返回只写提示。
// 注：defineTool 由 host.js 注入（保持本模块零捆绑包依赖）；
//     execute 的第二参 exec 用于取会话 id（缺失时退化为全局视图，不阻断）。

import { rankDocs, rankDocsHybrid } from './search.js';

function sessionOf(exec) {
  try {
    if (!exec || typeof exec !== 'object') return null;
    if (exec.agent && typeof exec.agent.id === 'string') return exec.agent.id;
    if (typeof exec.sessionId === 'string') return exec.sessionId;
  } catch { /* 忽略 */ }
  return null;
}

export function registerMemoryTools(ctx, { store, config, log, defineTool, getMode, getRecallOverride, embedding }) {
  function modeOf(sid) {
    try { return getMode && sid ? getMode(sid) : 'auto'; } catch { return 'auto'; }
  }
  /** 读工具闸门：返回 null = 放行；字符串 = 拒答提示。 */
  function readGate(sid) {
    const cfg = config.effective();
    if (!cfg.enabled) return '记忆功能已关闭';
    if (!sid) return null;
    const mode = modeOf(sid);
    if (mode === 'off') return '本会话记忆已暂停（off 档）：捕获与注入均未启用。';
    const override = getRecallOverride ? getRecallOverride(sid) : undefined;
    if (override === false) return '本会话为只写模式：对话照常沉淀为记忆，但不向本会话提供记忆读取。';
    return null;
  }

  const memorySearch = defineTool({
    name: 'memory_search',
    description: 'Search the long-term memory store (L1 atomic memories) for facts, preferences, decisions, and project context about the user. Use when current conversation might benefit from earlier context. Returns the top matches with dates.',
    parameters: {
      query: { type: 'string', required: true, description: 'What to look for, e.g. "用户偏好的构建工具" or "deploy workflow decision".' },
      limit: { type: 'integer', description: 'Max results (default 6, capped at 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                tags: { type: 'array', items: { type: 'string' } },
                family: { type: 'string' },
                updatedAt: { type: 'string' },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.length === 0
          ? '没有命中的长期记忆。'
          : `找到 ${value.results.length} 条相关记忆：\n${value.results.map((r) => `- ${r.updatedAt ? `[${r.updatedAt}] ` : ''}${r.content}`).join('\n')}`,
      }],
    },
    async execute(args, exec) {
      const cfg = config.effective();
      const sid = sessionOf(exec);
      const gate = readGate(sid);
      if (gate) return { results: [], hint: gate };
      const query = String(args.query || '').trim();
      if (query.length < 2) return { results: [], hint: '查询太短' };
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 6));
      const mode = modeOf(sid);
      const family = mode === 'chat' || mode === 'work' ? mode : undefined;
      const records = store.getRecords(family).map((r) => ({ ...r, text: r.content }));
      if (records.length === 0) return { results: [] };
      let hits;
      if (embedding && embedding.ready && embedding.ready()) {
        const queryVector = await embedding.embedQuery(query);
        if (queryVector) {
          const vectors = new Map();
          for (const r of records) {
            const v = embedding.getVector(r.id);
            if (v) vectors.set(r.id, v);
          }
          hits = rankDocsHybrid(query, records, { decayHalfLifeDays: cfg.recall.decayHalfLifeDays, limit, vectorRoute: { queryVector, vectors } });
        }
      }
      if (!hits) {
        hits = rankDocs(query, records, { threshold: 0, decayHalfLifeDays: cfg.recall.decayHalfLifeDays, limit });
      }
      const results = hits.map(({ item }) => ({
        id: item.id,
        content: item.content,
        tags: item.tags || [],
        family: item.family,
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString().slice(0, 10) : undefined,
      }));
      return { results };
    },
    presentCall: (args) => ({ card: 'generic', title: `搜索记忆：${String(args.query || '').slice(0, 40)}`, kind: 'other', rawInput: args }),
  });

  const conversationSearch = defineTool({
    name: 'conversation_search',
    description: 'Search past conversation transcripts (L0) across all sessions for something that was said earlier. Returns matching message excerpts with session id and time.',
    parameters: {
      query: { type: 'string', required: true, description: 'Text to look for in past conversations (verbatim substring works best).' },
      limit: { type: 'integer', description: 'Max results (default 8, capped at 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                role: { type: 'string', required: true },
                time: { type: 'string' },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.results.length === 0
          ? '历史会话中没有找到匹配内容。'
          : `在历史会话中找到 ${value.results.length} 段：\n${value.results.map((r) => `- [${r.time || ''}] ${r.role}: ${r.text}`).join('\n')}`,
      }],
    },
    execute(args, exec) {
      const sid = sessionOf(exec);
      const gate = readGate(sid);
      if (gate) return Promise.resolve({ results: [] }); // 只写/暂停会话不提供 L0 读取
      const query = String(args.query || '').trim();
      if (query.length < 2) return Promise.resolve({ results: [] });
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
      const results = store.searchConversations(query, limit).map((r) => ({
        sessionId: r.sessionId,
        role: r.role,
        time: r.time ? new Date(r.time).toISOString() : undefined,
        text: r.text,
      }));
      return Promise.resolve({ results });
    },
    presentCall: (args) => ({ card: 'generic', title: `搜索历史会话：${String(args.query || '').slice(0, 40)}`, kind: 'other', rawInput: args }),
  });

  const memoryReadScene = defineTool({
    name: 'memory_read_scene',
    description: 'Read one consolidated memory scene (L2): a distilled markdown overview of a topic/project/relationship area. Pass a scene title (or id); a fuzzy substring match is fine.',
    parameters: {
      scene: { type: 'string', required: true, description: 'Scene title or id, e.g. "XX 项目" — see <scene-navigation> for the list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          title: { type: 'string' },
          content: { type: 'string' },
          updatedAt: { type: 'string' },
          recordCount: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found ? `场景「${value.title}」：\n${value.content}` : `没有找到该场景。可用场景：见场景导航或调用 memory_search。`,
      }],
    },
    execute(args, exec) {
      const sid = sessionOf(exec);
      const gate = readGate(sid);
      if (gate) return Promise.resolve({ found: false }); // 只写/暂停会话不提供场景读取
      const mode = modeOf(sid);
      const family = mode === 'chat' || mode === 'work' ? mode : undefined;
      const scene = store.getScene(String(args.scene || ''), family);
      if (!scene) return Promise.resolve({ found: false });
      return Promise.resolve({
        found: true,
        title: scene.title,
        content: scene.content,
        updatedAt: scene.updatedAt ? new Date(scene.updatedAt).toISOString().slice(0, 10) : undefined,
        recordCount: (scene.recordIds || []).length,
      });
    },
    presentCall: (args) => ({ card: 'generic', title: `读取场景：${String(args.scene || '').slice(0, 40)}`, kind: 'other', rawInput: args }),
  });

  const disposers = [
    ctx.tools.register(memorySearch),
    ctx.tools.register(conversationSearch),
    ctx.tools.register(memoryReadScene),
  ];
  log.info('记忆工具已注册: memory_search / conversation_search / memory_read_scene');
  return () => { for (const dispose of disposers) { try { dispose(); } catch { /* 忽略 */ } } };
}
