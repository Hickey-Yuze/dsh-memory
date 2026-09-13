// dsh-memory — 蒸馏管线：调度阈值（起步翻倍爬坡）→ L1 抽取/去重 → 视水位触发 L2 场景整合、L3 画像蒸馏。
// 全链路串行化（同会话排队 + 全局 L2/L3 互斥），失败退避重试，重建期间暂停常规蒸馏。
// 任何失败只记账告警，绝不影响宿主。

import { buildL1Prompt, parseL1Output, buildL2Prompt, parseL2Output, buildL3Prompt, parseL3Output } from './prompts.js';
import { tokenize, rankDocs } from './search.js';

const BACKOFF_BASE_MS = 60000;
const BACKOFF_MAX_MS = 600000;
const REBUILD_CHUNK = 40;

export function createPipeline({ store, llm, config, log }) {
  const sessionQueues = new Map(); // sid -> Promise（同会话串行）
  let l2Running = false;
  let l3Running = false;
  let rebuildRunning = false;
  const idleTimers = new Map(); // sid -> timer

  // ---------- 阈值爬坡 ----------
  function effectiveThreshold(sid) {
    const cfg = config.effective();
    const s = store.sessionState(sid);
    const rounds = Math.max(0, s.rounds || 0);
    return Math.max(1, Math.min(cfg.extract.minMessages, 2 ** rounds));
  }

  // ---------- 调度入口（捕获层调用） ----------
  function noteActivity(sid) {
    const cfg = config.effective();
    if (!cfg.enabled || !cfg.capture.enabled || !cfg.extract.enabled) return;
    const s = store.sessionState(sid);
    s.count = (s.count || 0) + 1;
    s.lastActivityAt = Date.now();
    store.saveState();
    // 闲置兜底定时器
    if (cfg.extract.idleSeconds > 0) {
      const prev = idleTimers.get(sid);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => {
        idleTimers.delete(sid);
        flushSession(sid, 'idle').catch(() => {});
      }, cfg.extract.idleSeconds * 1000);
      if (typeof timer.unref === 'function') timer.unref();
      idleTimers.set(sid, timer);
    }
    if (s.count >= effectiveThreshold(sid)) {
      flushSession(sid, 'threshold').catch(() => {});
    }
  }

  // ---------- L1 抽取 ----------
  function buildCandidatePool(sliceText, poolSize) {
    const records = store.getRecords();
    if (records.length === 0 || poolSize <= 0) return [];
    const ranked = rankDocs(sliceText.slice(0, 4000), records.map((r) => ({ ...r, text: r.content })), { limit: poolSize, threshold: 0, decayHalfLifeDays: 0 });
    const pool = ranked.map((entry) => entry.item);
    if (pool.length < poolSize) {
      const picked = new Set(pool.map((r) => r.id));
      for (let i = records.length - 1; i >= 0 && pool.length < poolSize; i--) {
        if (!picked.has(records[i].id)) pool.push(records[i]);
      }
    }
    return pool;
  }

  function applyL1Result(items, sid) {
    let created = 0;
    let updated = 0;
    for (const item of items) {
      const result = store.upsertRecord({
        id: item.existingId || undefined,
        content: item.content,
        tags: item.tags,
        sessionId: sid,
      });
      if (result.created) created += 1;
      else updated += 1;
    }
    const state = store.getState();
    state.stats.newSinceL2 = (state.stats.newSinceL2 || 0) + created;
    state.stats.newSinceL3 = (state.stats.newSinceL3 || 0) + created;
    store.saveState();
    return { created, updated };
  }

  async function runL1(sid, slice) {
    const cfg = config.effective();
    const sliceText = slice.map((m) => m.text).join('\n');
    const pool = buildCandidatePool(sliceText, cfg.extract.candidatePool);
    const { system, user } = buildL1Prompt({
      slice,
      backgroundCount: cfg.extract.backgroundMessages,
      existingPool: pool,
      maxMemories: cfg.extract.maxMemoriesPerRun,
    });
    const result = await llm.call({ layer: 'l1', purpose: 'memory:extract', system, user, sessionId: sid });
    account(result, 'l1', 'extract', system.length + user.length);
    if (!result.ok) throw new Error(result.error);
    const items = parseL1Output(result.text, { maxMemories: cfg.extract.maxMemoriesPerRun });
    if (items === null) throw new Error('L1 输出解析失败（非 JSON 或结构不符）');
    const applied = applyL1Result(items, sid);
    log.info(`L1 完成: 新增 ${applied.created} / 更新 ${applied.updated}（输入 ${user.length} 字符）`);
    return applied;
  }

  // ---------- L2 场景 ----------
  async function maybeL2() {
    const cfg = config.effective();
    if (!cfg.l2.enabled || l2Running || rebuildRunning) return;
    const state = store.getState();
    if ((state.stats.newSinceL2 || 0) < cfg.l2.minNewMemories) return;
    const pending = store.getRecords().filter((r) => !r.sceneId);
    if (pending.length === 0) { state.stats.newSinceL2 = 0; store.saveState(); return; }
    l2Running = true;
    try {
      const { system, user } = buildL2Prompt({
        records: pending,
        existingScenes: store.getScenes(),
        maxScenes: cfg.l2.maxScenes,
        sceneContextLimit: cfg.l2.sceneContextLimit,
        maxInputChars: cfg.llm.maxInputChars,
      });
      const result = await llm.call({ layer: 'l2', purpose: 'memory:scene', system, user });
      account(result, 'l2', 'scene', system.length + user.length);
      if (!result.ok) throw new Error(result.error);
      const parsed = parseL2Output(result.text);
      if (parsed === null) throw new Error('L2 输出解析失败');
      store.replaceScenes(parsed.scenes);
      state.stats.newSinceL2 = 0;
      store.saveState();
      log.info(`L2 完成: ${parsed.scenes.length} 个场景（待整合 ${pending.length} 条）`);
    } catch (e) {
      log.warn(`L2 失败（下轮重试）: ${e.message || e}`);
    } finally {
      l2Running = false;
    }
  }

  // ---------- L3 画像 ----------
  async function maybeL3() {
    const cfg = config.effective();
    if (!cfg.l3.enabled || l3Running || rebuildRunning) return;
    const state = store.getState();
    if ((state.stats.newSinceL3 || 0) < cfg.l3.interval) return;
    const persona = store.getPersona();
    l3Running = true;
    try {
      const { system, user } = buildL3Prompt({
        oldPersona: persona ? persona.content : '',
        records: store.getRecords(),
        maxInputChars: cfg.llm.maxInputChars,
      });
      const result = await llm.call({ layer: 'l3', purpose: 'memory:persona', system, user });
      account(result, 'l3', 'persona', system.length + user.length);
      if (!result.ok) throw new Error(result.error);
      const parsed = parseL3Output(result.text);
      if (parsed === null) throw new Error('L3 输出解析失败');
      store.setPersona(parsed);
      state.stats.newSinceL3 = 0;
      store.saveState();
      log.info(`L3 完成: 画像已更新（${parsed.length} 字符）`);
    } catch (e) {
      log.warn(`L3 失败（下轮重试）: ${e.message || e}`);
    } finally {
      l3Running = false;
    }
  }

  // ---------- 记账 ----------
  function account(result, layer, purpose, inChars) {
    const usage = result.usage || {};
    store.appendUsage({
      layer,
      purpose,
      provider: result.route ? result.route.provider : '',
      model: result.route ? result.route.model : '',
      inChars: Math.max(0, Math.round(inChars || 0)),
      outputTokens: usage.outputTokens ?? null,
      reasoningTokens: usage.reasoningTokens ?? null,
      ok: result.ok === true,
      error: result.ok ? undefined : String(result.error || '').slice(0, 300),
    });
  }

  // ---------- 会话蒸馏（串行入口） ----------
  function flushSession(sid, reason = 'manual') {
    const prev = sessionQueues.get(sid) || Promise.resolve();
    const run = prev.then(() => flushSessionNow(sid, reason)).catch(() => {});
    sessionQueues.set(sid, run);
    const cleanup = () => {
      if (sessionQueues.get(sid) === run) sessionQueues.delete(sid);
    };
    run.then(cleanup, cleanup);
    return run;
  }

  async function flushSessionNow(sid, reason) {
    const cfg = config.effective();
    if (!cfg.enabled || !cfg.extract.enabled || rebuildRunning) return;
    if (!llm.available()) return;
    const s = store.sessionState(sid);
    if (s.backoffUntil && Date.now() < s.backoffUntil) return;
    const count = s.count || 0;
    if (count <= 0) return;
    try {
      const slice = store.readConversationSlice(sid, count, cfg.extract.backgroundMessages);
      if (slice.length === 0) { s.count = 0; store.saveState(); return; }
      log.info(`蒸馏管线开始（${reason}）: 会话 ${sid} 待蒸馏 ${count} 条`);
      await runL1(sid, slice);
      s.count = 0;
      s.rounds = (s.rounds || 0) + 1;
      s.attempts = 0;
      store.markDistilled(sid);
      await maybeL2();
      await maybeL3();
      log.info('管线结束');
    } catch (e) {
      s.attempts = (s.attempts || 0) + 1;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * s.attempts);
      s.backoffUntil = Date.now() + backoff;
      store.saveState();
      log.error(`蒸馏失败（${reason}，${Math.round(backoff / 1000)}s 后重试）: ${e.message || e}`);
    }
  }

  // ---------- 全量重建 ----------
  async function startRebuild() {
    const cfg = config.effective();
    if (rebuildRunning) return { started: false, reason: '重建已在进行中' };
    if (!llm.available()) return { started: false, reason: 'llm 服务未注入' };
    const files = store.listConversationFiles();
    if (files.length === 0) return { started: false, reason: '没有 L0 会话数据可重建' };
    // 预统计总量
    let total = 0;
    for (const f of files) total += store.readConversationTail(f.sid, Number.MAX_SAFE_INTEGER).length;
    if (total === 0) return { started: false, reason: 'L0 会话里没有可蒸馏的消息' };
    store.wipe({ keepConversations: true });
    const state = store.getState();
    state.rebuild = { phase: 'running', done: 0, total, startedAt: Date.now(), endedAt: 0, cancel: false };
    store.saveState();
    rebuildRunning = true;
    log.info(`记忆重建开始: ${files.length} 个会话 / ${total} 条消息`);
    (async () => {
      try {
        for (const file of files) {
          const stateNow = store.getState().rebuild;
          if (!stateNow || stateNow.cancel) break;
          const messages = store.readConversationTail(file.sid, Number.MAX_SAFE_INTEGER);
          for (let i = 0; i < messages.length; i += REBUILD_CHUNK) {
            const live = store.getState().rebuild;
            if (!live || live.cancel) break;
            const chunk = messages.slice(i, i + REBUILD_CHUNK);
            try {
              await runL1(file.sid, chunk);
            } catch (e) {
              log.warn(`重建分块失败（跳过）: ${e.message || e}`);
            }
            const rb = store.getState().rebuild;
            if (rb) {
              rb.done = Math.min(rb.total, rb.done + chunk.length);
              store.saveState();
            }
          }
        }
        const rb = store.getState().rebuild;
        if (rb) {
          rb.phase = rb.cancel ? 'cancelled' : 'done';
          rb.endedAt = Date.now();
          store.saveState();
          log.info(`记忆重建结束: ${rb.phase}（完成 ${rb.done}/${rb.total}）`);
          if (!rb.cancel) {
            state.stats.newSinceL2 = cfg.l2.enabled ? store.getRecords().filter((r) => !r.sceneId).length : 0;
            state.stats.newSinceL3 = store.getRecords().length;
            store.saveState();
            await maybeL2();
            await maybeL3();
          }
        }
      } catch (e) {
        const rb = store.getState().rebuild;
        if (rb) {
          rb.phase = 'failed';
          rb.endedAt = Date.now();
          rb.error = String(e.message || e).slice(0, 300);
          store.saveState();
        }
        log.error(`重建异常终止: ${e.message || e}`);
      } finally {
        rebuildRunning = false;
      }
    })().catch(() => { rebuildRunning = false; });
    return { started: true, total };
  }

  function cancelRebuild() {
    const rb = store.getState().rebuild;
    if (rb && rb.phase === 'running') {
      rb.cancel = true;
      store.saveState();
      return true;
    }
    return false;
  }

  function status() {
    return {
      rebuild: store.getState().rebuild,
      busy: rebuildRunning,
      sessionsInFlight: sessionQueues.size,
    };
  }

  function dispose() {
    for (const timer of idleTimers.values()) clearTimeout(timer);
    idleTimers.clear();
    sessionQueues.clear();
  }

  return { noteActivity, flushSession, startRebuild, cancelRebuild, status, dispose, maybeL2, maybeL3 };
}
