// dsh-memory — 模型可调用的记忆工具（对齐 dsh-layered-memory 三件套）：
//   memory_search        语义关键词检索 L1 原子记忆（按会话档位过滤族）
//   conversation_search  跨会话检索 L0 原始对话（L0 不分族）
//   memory_read_scene    读取 L2 场景块全文（按会话档位过滤族）
// 工具路径不过滤阈值（召回路径才过滤），让模型自行判断。
// 读侧闸门：off 档会话返回隐身提示；只写覆盖（recall=false）返回只写提示。
// 注：defineTool 由 host.js 注入（保持本模块零捆绑包依赖）；
//     execute 的第二参 exec 用于取会话 id（缺失时退化为全局视图，不阻断）。

import { rankDocs, rankDocsHybrid } from './search.js';
import * as audit from './audit.js';

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
                kind: { type: 'string' },
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
          : `找到 ${value.results.length} 条相关记忆：\n${value.results.map((r) => `- ${r.updatedAt ? `[${r.updatedAt}] ` : ''}${r.kind === 'opinion' ? '（我的判断）' : r.kind === 'commitment' ? '（双方约定）' : ''}${r.content}`).join('\n')}`,
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
        kind: item.kind,
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

  // 记忆体检：只读体检，用来回答「这条为什么没被召回」「哪几条该合并」。
  const memoryAudit = defineTool({
    name: 'memory_audit',
    description: 'Audit long-term memory health (记忆体检，只读): recall coverage, head monopoly (a few records hogging every recall), near-duplicate groups that should be merged, sleeping records never recalled for N days, and the recall-quality test card (test=true: does recall actually surface the right memory?). Use when the user asks why something was or was not recalled, or before cleaning up the memory store.',
    parameters: {
      family: { type: 'string', description: 'chat（个人）| work（工作）；省略＝当前档位，auto 档＝全部' },
      sleepDays: { type: 'integer', description: '多久没被召回算沉睡（默认 14 天）' },
      groups: { type: 'integer', description: '最多返回多少组近重复（默认 20，上限 50）' },
      test: { type: 'boolean', description: 'true＝只跑记忆测试卡（抽旧记忆、只提示一半、看召回准不准）' },
      sample: { type: 'integer', description: '测试卡抽多少条考题（默认 10）' },
      minAgeDays: { type: 'integer', description: '测试卡只考多旧的记忆（默认 90 天）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          summary: { type: 'string' },
          neverRecalled: { type: 'integer' },
          coveragePct: { type: 'number' },
          manyHits: { type: 'integer' },
          sleeping: { type: 'integer' },
          groups: { type: 'integer' },
          mergeable: { type: 'integer' },
          top: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                hits: { type: 'integer' },
                excerpt: { type: 'string' },
              },
            },
          },
          duplicates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                keepId: { type: 'string' },
                size: { type: 'integer' },
                mergedHits: { type: 'integer' },
                excerpt: { type: 'string' },
                dropIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          test: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'integer' },
              hit: { type: 'integer' },
              half: { type: 'integer' },
              miss: { type: 'integer' },
              score: { type: 'number' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string' },
                    hint: { type: 'string' },
                    answer: { type: 'string' },
                    rank: { type: 'integer' },
                    verdict: { type: 'string' },
                  },
                },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const lines = [value.summary || ''];
        if (value.test && Array.isArray(value.test.items) && value.test.items.length > 0) {
          lines.push('记忆测试卡（只给一半提示，看召回准不准）:');
          for (const t of value.test.items) {
            const mark = t.verdict === 'hit' ? '命中' : t.verdict === 'half' ? '半对' : '记错';
            lines.push(`- [${mark}] 提示「${t.hint}」→ 排第 ${t.rank || '—'} 名｜答案：${String(t.answer || '').slice(0, 60)}`);
          }
        }
        if (Array.isArray(value.top) && value.top.length > 0) {
          lines.push('头部（命中最多）:');
          for (const t of value.top) lines.push(`- ${t.hits} 次｜${t.excerpt || ''}`);
        }
        if (Array.isArray(value.duplicates) && value.duplicates.length > 0) {
          lines.push('近重复（建议合并）:');
          for (const g of value.duplicates) lines.push(`- ${g.size} 条 → 保留 ${g.keepId}（合并后 hits ${g.mergedHits}）｜${g.excerpt || ''}`);
        }
        if (value.hint) lines.push(value.hint);
        return [{ type: 'text', text: lines.filter(Boolean).join('\n') }];
      },
    },
    execute(args) {
      const cfg = config.effective();
      if (!cfg.enabled) return { ok: false, hint: '记忆功能已关闭' };
      const argFamily = args.family === 'chat' || args.family === 'work' ? args.family : undefined;
      const records = store.getRecords(argFamily);
      if (records.length === 0) return { ok: false, hint: '没有记忆可体检。' };
      const acfg = cfg.audit || {};
      // test=true → 只跑记忆测试卡（抽旧记忆、只提示一半、看召回准不准）
      if (args.test === true || args.test === 'true') {
        const test = audit.buildRecallTest(records, {
          family: argFamily,
          sampleSize: Number(args.sample) > 0 ? Number(args.sample) : (acfg.recallTestSample || undefined),
          minAgeDays: Number(args.minAgeDays) > 0 ? Number(args.minAgeDays) : (acfg.recallTestMinAgeDays || undefined),
          topK: acfg.recallTestTopK || undefined,
          scoreThreshold: cfg.recall ? cfg.recall.scoreThreshold : undefined,
          decayHalfLifeDays: cfg.recall ? cfg.recall.decayHalfLifeDays : undefined,
        });
        return {
          ok: true,
          summary: audit.recallTestSummary(test),
          test: {
            total: test.total,
            hit: test.hit,
            half: test.half,
            miss: test.miss,
            score: test.score,
            items: test.items.map((t) => ({
              id: t.id, hint: t.hint, answer: t.answer, rank: t.rank, verdict: t.verdict,
            })),
          },
          hint: test.total === 0
            ? `没有够旧的记忆可测（池龄下限 ${test.minAgeDays} 天，可用 ${test.poolSize} 条）。`
            : undefined,
        };
      }
      const report = audit.auditHealth(records, {
        sleepDays: Number(args.sleepDays) > 0 ? Number(args.sleepDays) : undefined,
        maxGroups: Number(args.groups) > 0 ? Math.min(50, Number(args.groups)) : 20,
        samples: 5,
        topN: 5,
      });
      const dupLimit = Number(args.groups) > 0 ? Math.min(50, Number(args.groups)) : 20;
      return {
        ok: true,
        summary: audit.auditSummary(report),
        neverRecalled: report.coverage.zero,
        coveragePct: report.coverage.hitPct,
        manyHits: report.head.manyHits,
        sleeping: report.sleeping.count,
        groups: report.duplicates.groupCount,
        mergeable: report.duplicates.mergable,
        top: report.head.top.map((t) => ({ id: t.id, hits: t.hits, excerpt: t.content.slice(0, 60) })),
        duplicates: report.duplicates.groups.slice(0, dupLimit).map((g) => ({
          keepId: g.keepId,
          size: g.size,
          mergedHits: g.mergedHits,
          excerpt: g.suggestedContent.slice(0, 60),
          dropIds: g.members.filter((m) => m.id !== g.keepId).map((m) => m.id),
        })),
        hint: report.duplicates.mergable > 0
          ? `有 ${report.duplicates.mergable} 条可合并（设置页「洞察 → 记忆体检」可逐组确认，或调 memory_audit 后由用户决定）。`
          : undefined,
      };
    },
    presentCall: () => ({ card: 'generic', title: '记忆体检', kind: 'other' }),
  });

  // 偏差档案：让模型在「被纠正」的当下就把教训写下来，而不是等用户提醒。
  function renderBiasLines(list) {
    if (!Array.isArray(list) || list.length === 0) return '偏差档案为空。';
    return list.map((b) => `- B-${b.no} [${b.date || ''}] ${b.kind || 'judgment'}｜场景：${b.scene || '—'}｜偏差：${b.deviation || ''}｜修正：${b.fix || ''}`).join('\n');
  }

  const memoryBias = defineTool({
    name: 'memory_bias',
    description: 'Read or write my judgment-bias archive (偏差档案 B-序号): records of times my own inference or recall was wrong, plus the fix so I stop repeating it. Call action="add" right after the user corrects me (wrong assumption, missed recall, noisy recall, wrong memory family). Call action="list" to review past biases.',
    parameters: {
      action: { type: 'string', required: true, description: '"add" | "list" | "update" | "delete"' },
      id: { type: 'string', description: 'update/delete 时指定偏差 id' },
      kind: { type: 'string', description: 'judgment（判断错）| recall-miss（该召没召）| recall-noise（召来噪音）| route（族/档位路由错）；默认 judgment' },
      scene: { type: 'string', description: '什么情境下出错的（以后按话题匹配，写具体）' },
      deviation: { type: 'string', description: '错在哪，一句话' },
      rootCause: { type: 'string', description: '为什么错' },
      fix: { type: 'string', description: '下次怎么做（可执行规则）' },
      tags: { type: 'string', description: '标签，逗号分隔' },
      limit: { type: 'integer', description: 'list 时最多返回几条（默认 10，上限 50）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          action: { type: 'string' },
          total: { type: 'integer' },
          biases: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                no: { type: 'integer' },
                date: { type: 'string' },
                kind: { type: 'string' },
                scene: { type: 'string' },
                deviation: { type: 'string' },
                fix: { type: 'string' },
                hits: { type: 'integer' },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [value.hint, renderBiasLines(value.biases)].filter(Boolean).join('\n'),
      }],
    },
    execute(args, exec) {
      const cfg = config.effective();
      if (!cfg.enabled) return { ok: false, hint: '记忆功能已关闭' };
      const sid = sessionOf(exec);
      const mode = modeOf(sid);
      if (mode === 'off') return { ok: false, hint: '本会话记忆已暂停（off 档）：偏差档案不可读写。' };
      const family = mode === 'chat' || mode === 'work' ? mode : undefined;
      const action = String(args.action || 'list').trim().toLowerCase();
      const view = (b) => ({ id: b.id, no: b.no, date: b.date, kind: b.kind, scene: b.scene, deviation: b.deviation, fix: b.fix, hits: b.hits || 0 });
      if (action === 'delete') {
        const id = String(args.id || '').trim();
        if (!id) return { ok: false, action: 'delete', hint: 'delete 需要 id' };
        const removed = store.deleteBias(id);
        return { ok: removed > 0, action: 'deleted', total: store.getBiases(family).length, hint: removed > 0 ? `已删除 ${id}` : `没找到 ${id}` };
      }
      if (action === 'add' || action === 'update') {
        const deviation = String(args.deviation || '').trim();
        const fix = String(args.fix || '').trim();
        if (!deviation || !fix) return { ok: false, action, hint: '入档至少需要 deviation（错在哪）与 fix（下次怎么做）' };
        const { bias, created } = store.upsertBias({
          id: action === 'update' ? (String(args.id || '').trim() || undefined) : undefined,
          kind: args.kind,
          scene: String(args.scene || '').trim(),
          deviation,
          rootCause: String(args.rootCause || '').trim(),
          fix,
          tags: String(args.tags || '').split(/[,，、\s]+/).filter(Boolean),
          family: family || 'chat',
        });
        return {
          ok: true,
          action: created ? 'added' : 'updated',
          total: store.getBiases(family).length,
          biases: [view(bias)],
          hint: `${created ? '已入档' : '已更新'} B-${bias.no}（族 ${bias.family}）：同类场景再次出现时会自动注入。`,
        };
      }
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
      const all = store.getBiases(family);
      const list = all.slice().sort((a, b) => (b.no || 0) - (a.no || 0)).slice(0, limit);
      return {
        ok: true,
        action: 'list',
        total: all.length,
        biases: list.map(view),
        hint: `偏差档案共 ${all.length} 条${family ? `（族 ${family}）` : ''}，显示最近 ${list.length} 条：`,
      };
    },
    presentCall: (args) => ({ card: 'generic', title: `偏差档案：${String(args.action || 'list')}`, kind: 'other', rawInput: args }),
  });

  const disposers = [
    ctx.tools.register(memorySearch),
    ctx.tools.register(conversationSearch),
    ctx.tools.register(memoryReadScene),
    ctx.tools.register(memoryBias),
    ctx.tools.register(memoryAudit),
  ];
  log.info('记忆工具已注册: memory_search / conversation_search / memory_read_scene / memory_bias / memory_audit');
  return () => { for (const dispose of disposers) { try { dispose(); } catch { /* 忽略 */ } } };
}
