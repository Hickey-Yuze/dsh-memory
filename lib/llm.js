// dsh-memory — 蒸馏 LLM 调用：复用宿主 ctx.llm（stream + BlockAssembler）。
// 路由解析（对齐 dsh-layered-memory 回退链语义）：
//   主路由 = 部署 pin（provider+model 双字段齐）→ agentDefaultModel 当前选择 → 第一个可用 provider/model；
//   回退链 = cfg.llm.fallbacks（主路由失败后按序降级，每条路由各享全额 timeoutMs）；
//   按层路由 = cfg.llm.layerRoutes.l1/l2/l3（非空且头行双显式 → 完整替换该层解析）；
//   失败 = 报错 / 被掐断 / 网络异常 / 空输出（流正常结束但 0 字符——蒸馏必然在解析阶段报废）；
//   调用方主动取消不降级；全部失败返回最后一个错误，交按会话退避重试。
// 所有失败都变成可读错误返回给管线记账，绝不抛到事件循环顶层。
// 注：BlockAssembler / createSystemMessage / createUserMessage 由 host.js 注入（dshLlm 参数），
// 保持本模块可在裸 Node 下单测（传桩实现即可）。

const ROUTE_CACHE_TTL_MS = 30000;
/** 层调用点 → 路由层键：l1 同管抽取（dsh-memory 去重已并入抽取）。 */
function layerKeyOf(layer) {
  return layer === 'l2' ? 'l2' : layer === 'l3' ? 'l3' : 'l1';
}

/** 回退链条目净化：剔除残缺条目；与已见 provider::model 重复的条目跳过。 */
export function buildRouteChain(primary, fallbacks, globalEffort) {
  const routes = [{ provider: primary.provider, model: primary.model, effort: primary.effort || globalEffort || '' }];
  const seen = new Set([`${primary.provider}::${primary.model}`]);
  for (const f of fallbacks || []) {
    if (!f || typeof f !== 'object') continue;
    if (!f.provider || !f.model) continue;
    const key = `${f.provider}::${f.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ provider: f.provider, model: f.model, effort: f.reasoningEffort || globalEffort || '' });
  }
  return routes;
}

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
    /** 解析蒸馏主路由；找不到可用路由返回 null（调用方记账并跳过）。 */
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
    /** 该层的生效路由链：运行时层链（overlay layerRoutes）→ 全局 主路由+fallbacks。 */
    async resolveChain(layer) {
      const cfg = config.effective();
      const key = layerKeyOf(layer);
      const layerChain = cfg.llm.layerRoutes && Array.isArray(cfg.llm.layerRoutes[key]) ? cfg.llm.layerRoutes[key] : [];
      const primary = await this.resolveRoute();
      if (!primary) {
        // 层链头行双显式时，即使主路由缺失也可独立服务该层
        if (layerChain.length > 0 && layerChain[0].provider && layerChain[0].model) {
          return buildRouteChain({ provider: layerChain[0].provider, model: layerChain[0].model, effort: layerChain[0].reasoningEffort }, layerChain.slice(1), cfg.llm.reasoningEffort);
        }
        return [];
      }
      if (layerChain.length > 0 && layerChain[0].provider && layerChain[0].model) {
        return buildRouteChain({ provider: layerChain[0].provider, model: layerChain[0].model, effort: layerChain[0].reasoningEffort }, layerChain.slice(1), cfg.llm.reasoningEffort);
      }
      return buildRouteChain(primary, cfg.llm.fallbacks, cfg.llm.reasoningEffort);
    },
    /** 单路由一次调用。返回 { ok, text?, usage?, finish?, error? }。 */
    async callRoute(route, { system, user, sessionId, purpose, temperature, maxTokens, timeoutMs, signal }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`蒸馏超时 ${timeoutMs}ms`)), Math.max(1000, timeoutMs));
      const onAbort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) { clearTimeout(timer); return { ok: false, error: '调用方取消', route, aborted: true }; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        const messages = [
          createSystemMessage(String(system || '')),
          createUserMessage({ content: [{ type: 'text', text: String(user || '') }], source: { kind: 'dsh-memory' } }),
        ];
        const assembler = new BlockAssembler();
        const options = {
          provider: route.provider,
          model: route.model,
          messages,
          maxTokens: Math.max(512, maxTokens),
          purpose: purpose || 'memory:distill',
          ...(sessionId ? { sessionId } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(route.effort ? { reasoningEffort: route.effort } : {}),
          signal: controller.signal,
        };
        for await (const chunk of runtime.stream(options)) assembler.push(chunk);
        const finish = assembler.finish;
        if (finish && finish.kind === 'aborted') {
          return { ok: false, error: `llm aborted: ${finish.reason || 'unknown'}`, route, usage: assembler.usage, finish };
        }
        const blocks = assembler.blocks();
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        const usage = assembler.usage;
        if (!text) {
          // 空输出按该路由失败处理（回退链语义）：对蒸馏而言必然在解析阶段报废
          return {
            ok: false,
            error: `空输出（finish=${finish ? finish.kind : 'unknown'}${usage ? `, output=${usage.outputTokens ?? '?'}tok` : ''}）`,
            route,
            usage,
            finish,
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
    /**
     * 单次蒸馏调用（回退链自动降级）。入参 system/user 字符串。
     * 返回 { ok, text?, usage?, route, finish?, error?, attempts }；
     * attempts 为逐次尝试记录（含失败行，供记账层逐行落账）。
     */
    async call({ layer, purpose, system, user, sessionId, signal }) {
      if (!runtime) return { ok: false, error: 'llm 服务未注入', attempts: [] };
      const cfg = config.effective();
      const chain = await this.resolveChain(layer);
      if (chain.length === 0) return { ok: false, error: '无可用蒸馏路由（未 pin 且找不到默认模型）', attempts: [] };
      const attempts = [];
      let last = null;
      for (const route of chain) {
        if (signal && signal.aborted) break; // 调用方取消不降级
        const result = await this.callRoute(route, {
          system,
          user,
          sessionId,
          purpose: purpose || `memory:${layer}`,
          temperature: cfg.llm.temperature,
          maxTokens: cfg.llm.maxTokens,
          timeoutMs: Math.max(1000, cfg.llm.timeoutMs), // 每条路由各享全额 timeoutMs
          signal,
        });
        attempts.push({
          provider: route.provider,
          model: route.model,
          ok: result.ok === true,
          error: result.ok ? undefined : String(result.error || '').slice(0, 300),
          usage: result.usage || null,
        });
        last = result;
        if (result.ok) {
          return { ...result, attempts };
        }
        log.warn(`蒸馏路由失败（${route.provider}/${route.model}${chain.length > attempts.length ? '，降级下一路由' : '，已到链尾'}）: ${result.error}`);
      }
      return { ...last, attempts };
    },
  };
}
