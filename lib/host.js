// dsh-memory — host 端总装入口。
// 全部服务（llm/tools/webServer/systemPrompt）都走 ctx.inject 延迟挂载：
// 任一服务缺席时插件仍然挂载，只少对应能力（headless / 精简 profile 友好）。

import { createConfig, sanitizeConfig } from './config.js';
import { createLogger } from './log.js';
import { createStore } from './store.js';
import { createLlmRunner } from './llm.js';
import { createPipeline } from './pipeline.js';
import { createRecall, attachRecall } from './recall.js';
import { attachCapture, attachCompactionReset } from './capture.js';
import { registerMemoryTools } from './tools.js';
import { registerRoutes } from './routes.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 本文件是插件内唯一 import 宿主捆绑包的位置：
// 其余模块全部依赖注入，保持可在裸 Node 下单测。
import { BlockAssembler, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';

const name = 'dsh-memory';
const inject = [];

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
  const llm = createLlmRunner({ config: configFacade, log, dshLlm: { BlockAssembler, createSystemMessage, createUserMessage } });
  const pipeline = createPipeline({ store, llm, config: configFacade, log });
  const recall = createRecall({ store, config: configFacade, log });

  const disposers = [];

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
  disposers.push(attachCapture(ctx, { store, pipeline, config: configFacade, log }));
  disposers.push(attachCompactionReset(ctx, { onCompaction: (sid) => recall.onCompaction(sid), log }));

  // —— 召回注入 ——
  disposers.push(attachRecall(ctx, { recall, config: configFacade, log, createUserMessage }));

  // —— 记忆工具（可选） ——
  disposers.push(ctx.inject(['tools'], (toolsCtx) => {
    try {
      return registerMemoryTools(toolsCtx, { store, config: configFacade, log });
    } catch (e) {
      log.error(`记忆工具注册失败: ${e.message || e}`);
      return undefined;
    }
  }));

  // —— 设置页路由（可选） ——
  disposers.push(ctx.inject(['webServer'], (httpCtx) => {
    try {
      return registerRoutes(httpCtx, { store, pipeline, config: configFacade, log, dataDir });
    } catch (e) {
      log.error(`路由注册失败: ${e.message || e}`);
      return undefined;
    }
  }));

  // —— 画像 / 场景导航稳定区（可选，动态 text，空即自动省略） ——
  disposers.push(ctx.inject(['systemPrompt'], (promptCtx) => {
    const sp = promptCtx.systemPrompt;
    if (!sp || typeof sp.section !== 'function') return undefined;
    const disposePersona = sp.section({
      name: 'dsh-memory:persona',
      order: 950,
      text: () => {
        const cfg = configFacade.effective();
        if (!cfg.enabled || !cfg.recall.enabled || !cfg.recall.includePersona) return '';
        const persona = store.getPersona();
        return persona && persona.content ? `<user-persona>\n${persona.content}\n</user-persona>` : '';
      },
    });
    const disposeSceneNav = sp.section({
      name: 'dsh-memory:scene-nav',
      order: 951,
      text: () => {
        const cfg = configFacade.effective();
        if (!cfg.enabled || !cfg.recall.enabled || !cfg.recall.includeSceneNav) return '';
        const scenes = store.getScenes();
        if (scenes.length === 0) return '';
        let lines = scenes.map((s) => `- ${s.title}（${(s.recordIds || []).length} 条记忆，可用 memory_read_scene 读取）`);
        let total = lines.join('\n').length;
        while (total > 1200 && lines.length > 1) {
          lines = lines.slice(0, -1);
          total = lines.join('\n').length;
        }
        return `<scene-navigation>\n已有记忆场景索引：\n${lines.join('\n')}\n</scene-navigation>`;
      },
    });
    log.info('画像 / 场景导航稳定区已注册');
    return () => {
      for (const dispose of [disposePersona, disposeSceneNav]) {
        try { if (typeof dispose === 'function') dispose(); } catch { /* 忽略 */ }
      }
    };
  }));

  // —— 卸载兜底 ——
  disposers.push(ctx.effect(() => () => {
    try { pipeline.dispose(); } catch { /* 忽略 */ }
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

function loadJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

export { apply, inject, name };
