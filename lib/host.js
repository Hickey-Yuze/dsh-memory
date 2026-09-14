// dsh-memory — host 端总装入口。
// 全部服务（llm/tools/webServer/systemPrompt）都走 ctx.inject 延迟挂载：
// 任一服务缺席时插件仍然挂载，只少对应能力（headless / 精简 profile 友好）。
// 分族与档位装配：会话档位（modes）贯通捕获/蒸馏/召回/工具/稳定区；
// 画像与场景导航按 agent 作用域注册（对齐原版），agents 服务缺席时退化为全局合并区。

import { createConfig, sanitizeConfig } from './config.js';
import { createLogger } from './log.js';
import { createStore } from './store.js';
import { createSessionModes } from './modes.js';
import { createRecallDedupe } from './recall-dedupe.js';
import { createEmbeddingService } from './embedding.js';
import { createKnowledgeIndex } from './knowledge.js';
import { createLlmRunner } from './llm.js';
import { createPipeline } from './pipeline.js';
import { createRecall, attachRecall } from './recall.js';
import { attachCapture, attachCompactionReset } from './capture.js';
import { registerMemoryTools } from './tools.js';
import { registerRoutes } from './routes.js';
import { LOCATION_CLUE_RE } from './recall.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 本文件是插件内唯一 import 宿主捆绑包的位置：
// 其余模块全部依赖注入，保持可在裸 Node 下单测。
import { BlockAssembler, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

const name = 'dsh-memory';
const inject = [];

const DOMAIN_HINT =
  '以下内容按记忆域分块：chat=用户个人画像，work=团队工作准则。两域独立蒸馏与更新，' +
  '请按当前对话语境参考对应域，不要把一域的内容当作另一域的事实。';

function wrapDomain(family, content) {
  const label = family === 'chat' ? '用户个人画像' : '团队工作准则';
  return `<domain family="${family}" label="${label}">\n${String(content).trim()}\n</domain>`;
}

function apply(ctx, config) {
  const yaml = config || {};
  const base = createConfig(yaml);

  // 数据目录只认 YAML/默认（运行时 overlay 不覆盖 dataDir，避免启动后搬家）。
  const initialEffective = base.effective();
  const dataDir = base.resolveDataDir(initialEffective);

  const log = createLogger(dataDir);
  log.attach(dataDir);

  // 运行时 overlay（设置页写入 <dataDir>/config.json，节级覆盖 YAML）
  const overlayPath = join(dataDir, 'config.json');
  const overlayStore = {
    read() {
      const overlay = sanitizeConfig(loadJsonSafe(overlayPath));
      delete overlay.dataDir;
      return overlay;
    },
  };
  const configFacade = createConfig(yaml, overlayStore);
  configFacade.getDefaultModel = () => {
    try {
      const service = ctx.get('agentDefaultModel');
      const selection = service && typeof service.currentSelection === 'function' ? service.currentSelection() : null;
      return selection && selection.provider && selection.model ? selection : null;
    } catch {
      return null;
    }
  };

  log.info(`dsh-memory 启动: dataDir=${dataDir}`);

  const store = createStore(dataDir, log);
  const modes = createSessionModes(dataDir, { getDefaultMode: () => configFacade.effective().family, log });
  const dedupe = createRecallDedupe(dataDir, log);
  const embedding = createEmbeddingService(dataDir, { config: configFacade, log });
  const llm = createLlmRunner({ config: configFacade, log, dshLlm: { BlockAssembler, createSystemMessage, createUserMessage } });
  const pipeline = createPipeline({ store, llm, config: configFacade, log, getMode: (sid) => modes.get(sid) });
  const knowledge = createKnowledgeIndex(dataDir, { config: configFacade, log });
  const recall = createRecall({ store, config: configFacade, log, modes, embedding, dedupe, knowledge });

  const disposers = [];

  // —— 知识库扫描调度：启动 8s 后首扫，之后每 10 分钟增量（mtime+size 判断，几乎零开销） ——
  disposers.push(ctx.effect(() => {
    let stopped = false;
    let timer = null;
    const run = async () => {
      if (stopped) return;
      try {
        const result = knowledge.scan();
        if (result.skipped) return;
        if (result.indexed > 0) log.info(`知识库就绪: ${result.files} 个文件 / ${result.chunks} 个片段可检索`);
      } catch (e) {
        log.warn(`知识库扫描异常: ${e && e.message ? e.message : e}`);
      }
      if (!stopped) {
        timer = setTimeout(run, 10 * 60 * 1000);
        if (timer && typeof timer.unref === 'function') timer.unref();
      }
    };
    timer = setTimeout(run, 8 * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      knowledge.flush();
    };
  }, 'dsh-memory: knowledge-scheduler'));

  // —— LLM 服务（可选） ——
  disposers.push(ctx.inject(['llm'], (llmCtx) => {
    llm.setRuntime(llmCtx.llm);
    log.info('llm 服务已注入（蒸馏可用）');
    return () => {
      llm.setRuntime(null);
      log.info('llm 服务已注销（蒸馏暂停）');
    };
  }));

  // —— L0 捕获 + 压缩重置 ——
  disposers.push(attachCapture(ctx, { store, pipeline, config: configFacade, log, getMode: (sid) => modes.get(sid) }));
  disposers.push(attachCompactionReset(ctx, { onCompaction: (sid) => recall.onCompaction(sid), log }));

  // —— 召回注入 ——
  disposers.push(attachRecall(ctx, { recall, config: configFacade, log, createUserMessage }));

  // —— 档位切换联动：非 off 切档/恢复时把挂起切片立即落袋（ADR-0003 语义） ——
  modes.onModeChange((sid, oldMode, newMode) => {
    if (newMode !== 'off' && oldMode !== 'off') {
      pipeline.flushSession(sid, 'mode-change').catch(() => {});
    } else if (oldMode === 'off' && newMode !== 'off') {
      pipeline.flushSession(sid, 'mode-resume').catch(() => {});
    }
  });

  // —— 记忆工具（可选） ——
  disposers.push(ctx.inject(['tools'], (toolsCtx) => {
    try {
      return registerMemoryTools(toolsCtx, {
        store,
        config: configFacade,
        log,
        defineTool,
        getMode: (sid) => modes.get(sid),
        getRecallOverride: (sid) => modes.getRecall(sid),
        embedding,
      });
    } catch (e) {
      log.error(`记忆工具注册失败: ${e.message || e}`);
      return undefined;
    }
  }));

  // —— 设置页路由（可选） ——
  // 注意：inject 回调的返回值会被 cordis 当作 disposer，必须返回函数或 undefined；
  // registerRoutes 返回 { readOverlay } 对象，绝不能透传（否则 Invalid effect，路由整体不挂载）。
  disposers.push(ctx.inject(['webServer'], (httpCtx) => {
    try {
      registerRoutes(httpCtx, { store, pipeline, config: configFacade, log, dataDir, modes, embedding, knowledge });
    } catch (e) {
      log.error(`路由注册失败: ${e.message || e}`);
    }
  }));

  // —— 画像 / 场景导航稳定区（agent 作用域；agents 服务缺席时退化为全局合并区） ——
  disposers.push(registerProfileSections(ctx, { store, config: configFacade, modes, log }));

  // —— 嵌入差量重嵌调度（就绪时低频后台补齐；失败自动降级关键词） ——
  disposers.push(ctx.effect(() => {
    let timer = null;
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        if (embedding.ready() && !embedding.sourceChanged()) {
          await embedding.ensureIndexed(store.getRecords());
        }
      } catch { /* 嵌入失败已内部记账，绝不上抛 */ }
      if (!stopped) timer = setTimeout(run, 10 * 60 * 1000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };
    timer = setTimeout(run, 30 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      try { embedding.dispose(); } catch { /* 忽略 */ }
    };
  }, 'dsh-memory: embedding-scheduler'));

  // —— 卸载兜底 ——
  disposers.push(ctx.effect(() => () => {
    try { pipeline.dispose(); } catch { /* 忽略 */ }
    try { modes.flush(); } catch { /* 忽略 */ }
    try { dedupe.flush(); } catch { /* 忽略 */ }
    try { store.saveState(); } catch { /* 忽略 */ }
    log.info('dsh-memory 已卸载');
  }, 'dsh-memory: dispose'));

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        if (typeof dispose === 'function') dispose();
      } catch { /* 忽略 */ }
    }
  };
}

/**
 * 画像/场景导航稳定区：优先 agent 作用域注册（按会话档位选族；
 * auto 档两族按 <domain> 分块）；agents 服务缺席时退化为全局 section（合并两族）。
 */
function registerProfileSections(ctx, { store, config, modes, log }) {
  function modeOf(agentId) {
    try { return modes ? modes.get(agentId) : 'auto'; } catch { return 'auto'; }
  }

  function stableText(agentId) {
    const cfg = config.effective();
    if (!cfg.enabled || !cfg.recall.enabled) return '';
    const mode = modeOf(agentId);
    if (mode === 'off') return '';
    if (modes && modes.resolvedRecall(agentId, true) === false) return ''; // 只写不读
    const personas = store.getPersonas();
    const segments = [];
    if (cfg.recall.includePersona) {
      const blocks = [];
      if (mode === 'auto' || mode === 'chat') {
        if (personas.chat && personas.chat.content) blocks.push(wrapDomain('chat', personas.chat.content));
      }
      if (mode === 'auto' || mode === 'work') {
        if (personas.work && personas.work.content) blocks.push(wrapDomain('work', personas.work.content));
      }
      if (blocks.length > 0) {
        segments.push(`<user-persona>\n${mode === 'auto' ? `${DOMAIN_HINT}\n\n` : ''}${blocks.join('\n\n')}\n</user-persona>`);
      }
    }
    if (cfg.recall.includeSceneNav) {
      const navBlocks = [];
      for (const family of mode === 'auto' ? ['chat', 'work'] : [mode]) {
        const scenes = store.getScenes(family);
        if (scenes.length === 0) continue;
        let lines = scenes.map((s) => `- ${s.title}（${(s.recordIds || []).length} 条记忆，可用 memory_read_scene 读取）`);
        let total = lines.join('\n').length;
        while (total > 1200 && lines.length > 1) {
          lines = lines.slice(0, -1);
          total = lines.join('\n').length;
        }
        navBlocks.push(wrapDomain(family, lines.join('\n')));
      }
      if (navBlocks.length > 0) {
        segments.push(`<scene-navigation>\n已有记忆场景索引：\n${navBlocks.join('\n\n')}\n</scene-navigation>`);
      }
    }
    // 位置指针使用规则：库内存在"位置型"记忆（知识库/目录路径）时，常驻一条行为提示。
    // 真机教训：模型记住了知识库位置却不读内容，最后凭空编数据——位置是线索不是答案。
    try {
      const hasPointer = store.getRecords().some((r) => LOCATION_CLUE_RE.test(r.content || ''));
      if (hasPointer) {
        segments.push('<memory-usage>\n长期记忆中的本地路径/知识库地址只是"指针"不是内容：当任务与记忆里提到的目录或知识库相关时，必须先用文件工具（读取/搜索）查看该处实际内容再回答；只凭位置无法还原其中的具体内容，禁止臆测或编造。\n</memory-usage>');
      }
    } catch { /* 忽略 */ }
    return segments.join('\n\n');
  }

  // agent 作用域（主路径）：插件可能晚于 agent 创建，需给已存在 agent 补注册
  const contextDisposers = [];
  const registered = new WeakSet();
  const registerForAgent = (agent) => {
    if (!agent || !agent.ctx || !agent.ctx.systemPrompt || typeof agent.ctx.systemPrompt.context !== 'function') return;
    if (registered.has(agent)) return;
    registered.add(agent);
    try {
      contextDisposers.push(agent.ctx.systemPrompt.context({
        name: 'dsh-memory:profile',
        order: 950,
        text: () => {
          const text = stableText(agent.id);
          return text;
        },
      }));
    } catch (e) {
      log.warn(`画像稳定区注册失败（agent=${agent.id || '?'}）: ${e.message || e}`);
    }
  };

  const effect = ctx.effect(() => {
    let fallbackTimer = null;
    let fallbackDisposer = null;
    let stopped = false;
    const probeAgents = () => {
      try {
        const agents = typeof ctx.get === 'function' ? ctx.get('agents') : null;
        if (agents && typeof agents.list === 'function') {
          for (const agent of agents.list()) registerForAgent(agent);
          return true;
        }
      } catch { /* agents 服务缺失 */ }
      return false;
    };
    try { ctx.on('agent/created', (payload) => { try { registerForAgent(payload && payload.agent); } catch { /* 忽略 */ } }); } catch { /* 事件缺失：忽略 */ }
    probeAgents();
    // agents 服务可能晚于插件就绪：5s 后仍没有任何 agent 注册成功 → 全局退化（合并注入）
    fallbackTimer = setTimeout(() => {
      if (stopped || contextDisposers.length > 0) return;
      if (probeAgents()) return;
      fallbackDisposer = registerGlobalFallback(ctx, { stableText, log });
    }, 5000);
    if (typeof fallbackTimer.unref === 'function') fallbackTimer.unref();
    return () => {
      stopped = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      try { if (typeof fallbackDisposer === 'function') fallbackDisposer(); } catch { /* 忽略 */ }
      for (const dispose of contextDisposers.splice(0)) {
        try { if (typeof dispose === 'function') dispose(); } catch { /* agent 可能已先销毁 */ }
      }
    };
  }, 'dsh-memory: profile-sections');

  return () => {
    try { if (typeof effect === 'function') effect(); } catch { /* 忽略 */ }
  };
}

/** 全局退化：无 agent 作用域可用时，把合并（auto 格式）画像挂到全局 systemPrompt.section。 */
function registerGlobalFallback(ctx, { stableText, log }) {
  let disposeInner = null;
  const d = ctx.inject(['systemPrompt'], (promptCtx) => {
    const sp = promptCtx.systemPrompt;
    if (!sp || typeof sp.section !== 'function') return undefined;
    log.warn('agents 服务不可用，画像稳定区退化为全局合并注入（无法按会话档位选族）');
    return sp.section({
      name: 'dsh-memory:profile',
      order: 950,
      text: () => stableText(''),
    });
  });
  disposeInner = d;
  return () => {
    try { if (typeof disposeInner === 'function') disposeInner(); } catch { /* 忽略 */ }
  };
}

function loadJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

export { apply, inject, name };
