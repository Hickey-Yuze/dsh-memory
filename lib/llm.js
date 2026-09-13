// dsh-memory — 蒸馏 LLM 调用：复用宿主 ctx.llm（stream + BlockAssembler）。
// 路由解析：部署 pin（llm.provider+model 双字段齐）→ agentDefaultModel 当前选择 → 第一个可用 provider/model。
// 所有失败都变成可读错误返回给管线记账，绝不抛到事件循环顶层。
// 注：BlockAssembler / createSystemMessage / createUserMessage 由 host.js 注入（dshLlm 参数），
// 保持本模块可在裸 Node 下单测（传桩实现即可）。

const ROUTE_CACHE_TTL_MS = 30000;

export function createLlmRunner({ config, log, dshLlm }) {
  const { BlockAssembler, createSystemMessage, createUserMessage } = dshLlm || {};
  let runtime = null;
  let routeCache = null; // { key, value: {provider, model} | null }

  return {
    /** ctx.inject(['llm']) 回调注入运行时；卸载时置空。 */
    setRuntime(llm) {
      runtime = llm;
      routeCache = null;
    },
    available() {
      return runtime !== null;
    },
    /** 解析蒸馏路由；找不到可用路由返回 null（调用方记账并跳过）。 */
    async resolveRoute() {
      const cfg = config.effective();
      if (cfg.llm.provider && cfg.llm.model) return { provider: cfg.llm.provider, model: cfg.llm.model, pinned: true };
      if (!runtime) return null;
      const key = 'auto';
      if (routeCache && routeCache.key === key && Date.now() - routeCache.ts < ROUTE_CACHE_TTL_MS) return routeCache.value;
      let resolved = null;
      try {
        const defaultModel = typeof config.getDefaultModel === 'function' ? config.getDefaultModel() : null;
        if (defaultModel && defaultModel.provider && defaultModel.model) {
          resolved = { provider: defaultModel.provider, model: defaultModel.model };
        }
      } catch { /* 默认模型服务缺失 */ }
      if (!resolved) {
        try {
          for (const provider of runtime.listProviders()) {
            const models = await runtime.listModels(provider.id);
            if (models && models.length > 0) {
              resolved = { provider: provider.id, model: models[0].id };
              break;
            }
          }
        } catch (e) {
          log.warn(`路由解析失败: ${e.message || e}`);
        }
      }
      routeCache = { key, ts: Date.now(), value: resolved };
      return resolved;
    },
    /**
     * 单次蒸馏调用。入参 system/user 字符串；返回 { ok, text, usage, route, finish, error? }。
     * 空输出按失败处理（蒸馏必然要在解析阶段使用输出）。
     */
    async call({ layer, purpose, system, user, sessionId, signal }) {
      if (!runtime) return { ok: false, error: 'llm 服务未注入' };
      const route = await this.resolveRoute();
      if (!route) return { ok: false, error: '无可用蒸馏路由（未 pin 且找不到默认模型）' };
      const cfg = config.effective();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`蒸馏超时 ${cfg.llm.timeoutMs}ms`)), Math.max(1000, cfg.llm.timeoutMs));
      const onAbort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); return { ok: false, error: '调用方取消' }; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        const messages = [
          createSystemMessage(String(system || ''), 'dsh-memory'),
          createUserMessage({ content: [{ type: 'text', text: String(user || '') }], source: { kind: 'plugin', plugin: 'dsh-memory' } }),
        ];
        const assembler = new BlockAssembler();
        const options = {
          provider: route.provider,
          model: route.model,
          messages,
          maxTokens: Math.max(512, cfg.llm.maxTokens),
          purpose: purpose || `memory:${layer}`,
          ...(sessionId ? { sessionId } : {}),
          ...(cfg.llm.temperature !== undefined ? { temperature: cfg.llm.temperature } : {}),
          signal: controller.signal,
        };
        for await (const chunk of runtime.stream(options)) assembler.push(chunk);
        const finish = assembler.finish;
        if (finish && finish.kind === 'aborted') return { ok: false, error: `llm aborted: ${finish.reason || 'unknown'}`, route };
        const blocks = assembler.blocks();
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        const usage = assembler.usage;
        if (!text) {
          return {
            ok: false,
            error: `空输出（finish=${finish ? finish.kind : 'unknown'}${usage ? `, output=${usage.outputTokens ?? '?'}tok` : ''}）`,
            route,
            usage,
          };
        }
        return { ok: true, text, usage, route, finish };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e), route };
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
