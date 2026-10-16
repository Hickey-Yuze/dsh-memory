// dsh-memory — 蒸馏管线：调度阈值（起步翻倍爬坡）→ L1 抽取/去重 → 视水位触发 L2 场景整合、L3 画像蒸馏。
// 分族语义：纯档（chat/work）强制族标签；auto 档由模型显式归族（兜底 chat）；
// 去重候选只取同族记录（去重永不跨族）；L2/L3 按族各自水位触发。
// 全链路串行化（同会话排队 + 全局 L2/L3 互斥），失败退避重试，重建期间暂停常规蒸馏。
// 任何失败只记账告警，绝不影响宿主。

import { buildL1Prompt, parseL1Output, normExtractedFamily, buildL2Prompt, parseL2Output, buildL3Prompt, parseL3Output } from './prompts.js';
import { tokenize, rankDocs } from './search.js';
import { planAutoMerges } from './audit.js';

const BACKOFF_BASE_MS = 60000;
const BACKOFF_MAX_MS = 600000;
const REBUILD_CHUNK = 40;
// L1 输入分块：transcript 预算占 maxInputChars 的比例（其余留给候选池与指令）
const CHUNK_BUDGET_RATIO = 0.8;

/** 归一化场景标题：用于识别模型把同一主题又建了一遍（真实库出现过整对同名场景）。 */
function normSceneTitle(t) {
  return String(t || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase().slice(0, 60);
}

export function createPipeline({ store, llm, config, log, getMode }) {
  const sessionQueues = new Map(); // sid -> Promise（同会话串行）
  let l2Running = false;
  let l3Running = false;
  let rebuildRunning = false;
  const idleTimers = new Map(); // sid -> timer

  function modeOf(sid) {
    try { return getMode ? getMode(sid) : 'auto'; } catch { return 'auto'; }
  }

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
    if (modeOf(sid) === 'off') return; // off 档会话对记忆系统隐身
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
    }
    if (s.count >= effectiveThreshold(sid)) {
      flushSession(sid, 'threshold').catch(() => {});
    }
  }

  // ---------- 候选池（去重永不跨族） ----------
  function buildCandidatePool(sliceText, poolSize, family) {
    const records = family === 'chat' || family === 'work' ? store.getRecords(family) : store.getRecords();
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

  // ---------- L1 应用（族三级兜底：纯档强制 → 抽取显式 → chat） ----------
  function resolveItemFamily(item, forcedFamily) {
    if (forcedFamily === 'chat' || forcedFamily === 'work') return forcedFamily;
    return normExtractedFamily(item.family) || 'chat';
  }

  function applyL1Result(items, sid, forcedFamily) {
    let created = 0;
    let updated = 0;
    const createdByFamily = { chat: 0, work: 0 };
    for (const item of items) {
      const family = resolveItemFamily(item, forcedFamily);
      // 跨族合并防御：existing_id 指向的记录与解析出的族不同 → 忽略合并、按新增处理
      let existingId = item.existingId || undefined;
      if (existingId) {
        const existing = store.getRecord(existingId);
        if (!existing || existing.family !== family) existingId = undefined;
      }
      const result = store.upsertRecord({
        id: existingId,
        content: item.content,
        tags: item.tags,
        family,
        kind: item.kind,
        sessionId: sid,
      });
      if (result.created) { created += 1; createdByFamily[family] += 1; }
      else updated += 1;
    }
    for (const fam of ['chat', 'work']) {
      if (createdByFamily[fam] > 0) store.addNewSince(fam, createdByFamily[fam]);
    }
    store.saveState();
    return { created, updated };
  }

  // ---------- 输入超限分块 ----------
  function chunkSlice(slice, maxInputChars) {
    const budget = Math.max(4000, Math.floor(maxInputChars * CHUNK_BUDGET_RATIO));
    const total = slice.reduce((sum, m) => sum + m.text.length + 8, 0);
    if (total <= budget) return [slice];
    const chunks = [];
    let current = [];
    let size = 0;
    for (const m of slice) {
      const cost = m.text.length + 8;
      if (current.length > 0 && size + cost > budget) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(m);
      size += cost;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  // ---------- L1 抽取（输入超限自动分块，逐块抽取后合并应用） ----------
  async function runL1(sid, slice, forcedFamily = 'auto') {
    const cfg = config.effective();
    const pool = buildCandidatePool(slice.map((m) => m.text).join('\n'), cfg.extract.candidatePool, forcedFamily);
    const chunks = chunkSlice(slice, cfg.llm.maxInputChars);
    let applied = { created: 0, updated: 0 };
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // 多块时背景不再随每块重复携带（readConversationSlice 的背景在切片头部，随首块自然带上）
      const poolForChunk = chunks.length > 1
        ? buildCandidatePool(chunk.map((m) => m.text).join('\n'), cfg.extract.candidatePool, forcedFamily)
        : pool;
      const { system, user } = buildL1Prompt({
        slice: chunk,
        backgroundCount: chunks.length === 1 ? cfg.extract.backgroundMessages : 0,
        existingPool: poolForChunk,
        maxMemories: cfg.extract.maxMemoriesPerRun,
        family: forcedFamily,
      });
      const result = await llm.call({ layer: 'l1', purpose: 'memory:extract', system, user, sessionId: sid });
      account(result, 'l1', 'extract', system.length + user.length);
      if (!result.ok) throw new Error(result.error);
      const items = parseL1Output(result.text, { maxMemories: cfg.extract.maxMemoriesPerRun });
      if (items === null) throw new Error('L1 输出解析失败（非 JSON 或结构不符）');
      const part = applyL1Result(items, sid, forcedFamily);
      applied.created += part.created;
      applied.updated += part.updated;
      log.info(`L1 完成${chunks.length > 1 ? `（分块 ${i + 1}/${chunks.length}）` : ''}: 新增 ${part.created} / 更新 ${part.updated}（输入 ${user.length} 字符）`);
    }
    return applied;
  }

  // ---------- L2 场景（分族） ----------
  /** 取一批待整合记忆：条数上限 batchRecords，正文总量上限 batchChars（长记忆族自动缩小批）。 */
  function takeL2Batch(family, cfg) {
    const size = Math.max(1, Number(cfg.l2.batchRecords) || 60);
    const chars = Math.max(800, Number(cfg.l2.batchChars) || 6000);
    const out = [];
    let total = 0;
    for (const r of store.getPendingRecords(family)) {
      if (out.length >= size) break;
      const len = (r.content || '').length;
      if (out.length > 0 && total + len > chars) break;
      out.push(r);
      total += len;
    }
    return out;
  }

  /** 单批整合：把一批待整合记忆送进 prompt；输出被 max-tokens 截断时自动拆半重试。 */
  async function runL2Batch(family, cfg, override) {
    const existing = store.getScenes(family);
    const batch = Array.isArray(override) ? override : takeL2Batch(family, cfg);
    if (batch.length === 0) return { batchSize: 0, scenes: 0, left: 0 };
    const { system, user } = buildL2Prompt({
      records: batch,
      existingScenes: existing,
      maxScenes: cfg.l2.maxScenes,
      sceneContextLimit: cfg.l2.sceneContextLimit,
      maxInputChars: cfg.llm.maxInputChars,
      family,
    });
    const result = await llm.call({ layer: 'l2', purpose: 'memory:scene', system, user });
    account(result, 'l2', 'scene', system.length + user.length);
    if (!result.ok) {
      const err = String(result.error || '');
      const floor = Math.max(2, Number(cfg.l2.minBatchRecords) || 8);
      if (/max-tokens|空输出|截断/.test(err) && batch.length > floor) {
        const mid = Math.ceil(batch.length / 2);
        log.warn(`L2 输出不可用（${err}）→ 拆半重试：${batch.length} → ${mid} + ${batch.length - mid} 条`);
        const a = await runL2Batch(family, cfg, batch.slice(0, mid));
        const b = await runL2Batch(family, cfg, batch.slice(mid));
        return {
          batchSize: batch.length,
          scenes: (a.scenes || 0) + (b.scenes || 0),
          left: store.getPendingRecords(family).length,
          split: true,
        };
      }
      store.markL2Skipped(batch.map((r) => r.id));
      log.warn(`L2 跳过 ${batch.length} 条（模型输出受限：${err}）；记录内容更新后会自动重新参与整合`);
      return { batchSize: batch.length, scenes: 0, left: store.getPendingRecords(family).length, skipped: batch.length };
    }
    const parsed = parseL2Output(result.text);
    if (parsed === null) {
      const floor = Math.max(2, Number(cfg.l2.minBatchRecords) || 8);
      if (batch.length > floor) {
        const mid = Math.ceil(batch.length / 2);
        log.warn(`L2 输出解析失败（截断或结构不符）→ 拆半重试：${batch.length} → ${mid} + ${batch.length - mid} 条`);
        const a = await runL2Batch(family, cfg, batch.slice(0, mid));
        const b = await runL2Batch(family, cfg, batch.slice(mid));
        return {
          batchSize: batch.length,
          scenes: (a.scenes || 0) + (b.scenes || 0),
          left: store.getPendingRecords(family).length,
          split: true,
        };
      }
      store.markL2Skipped(batch.map((r) => r.id));
      log.warn(`L2 跳过 ${batch.length} 条（输出解析失败）；记录内容更新后会自动重新参与整合`);
      return { batchSize: batch.length, scenes: 0, left: store.getPendingRecords(family).length, skipped: batch.length };
    }
    // 已有场景：模型只回 id+title 即可，正文与成员在这里保留；漏掉≠删除，一并兜住。
    const prior = new Map(existing.map((s) => [s.id, s]));
    const returned = new Set();
    const merged = parsed.scenes.map((s) => {
      const prev = s.id ? prior.get(s.id) : null;
      if (s.id) returned.add(s.id);
      const recordIds = Array.from(new Set([...(prev ? prev.recordIds || [] : []), ...(s.record_ids || [])]));
      return {
        id: s.id,
        title: s.title || (prev ? prev.title : ''),
        content: s.content || (prev ? prev.content : ''),
        record_ids: recordIds,
      };
    });
    // 同名场景守卫：没回 id 的新场景若与已有场景标题同义，就认领那一条，成员取并集
    const titleOwner = new Map();
    for (const s of existing) {
      const key = normSceneTitle(s.title);
      if (key && !titleOwner.has(key)) titleOwner.set(key, s);
    }
    for (const s of merged) {
      if (s.id) continue;
      const owner = titleOwner.get(normSceneTitle(s.title));
      if (!owner || returned.has(owner.id)) continue;
      s.id = owner.id;
      s.record_ids = Array.from(new Set([...(owner.recordIds || []), ...(s.record_ids || [])]));
      returned.add(owner.id);
    }
    const carried = existing.filter((s) => !returned.has(s.id));
    store.replaceScenes([
      ...merged,
      ...carried.map((s) => ({ id: s.id, title: s.title, content: s.content, record_ids: s.recordIds || [] })),
    ], family);
    // 本批里最终没进任何场景的（模型漏了或明确丢弃）打标记，避免它们卡在队头
    const unplaced = batch.filter((r) => !store.getRecord(r.id)?.sceneId).map((r) => r.id);
    if (unplaced.length) store.markL2Skipped(unplaced);
    // 刚被 L2 跳过的记录不该再算进 L3 的「新记忆」
    return {
      batchSize: batch.length,
      scenes: parsed.scenes.length,
      carried: carried.length,
      unplaced: unplaced.length,
      left: Math.max(0, store.getPendingRecords(family).length),
    };
  }

  /**
   * 分批消化积压。此前是把整族待整合记忆一次性塞进 prompt：输入被 maxInputChars 截断、
   * 模型还得回显全部 id，必然 max-tokens 截断 → 解析失败 → 积压只增不减（自我锁死）。
   */
  async function maybeL2(family) {
    const cfg = config.effective();
    if (!cfg.l2.enabled || l2Running || rebuildRunning) return;
    const water = store.familyWater(family);
    const pendingAll = store.getPendingRecords(family);
    if (pendingAll.length === 0) {
      if (water.newSinceL2) { water.newSinceL2 = 0; store.saveState(); }
      return;
    }
    const batchSize = Math.max(1, Number(cfg.l2.batchRecords) || 60);
    const backlog = pendingAll.length > batchSize;
    // 稳态仍按 minNewMemories 攒够才做；有积压时每轮都推进，不再等阈值
    if (!backlog && (water.newSinceL2 || 0) < cfg.l2.minNewMemories) return;
    l2Running = true;
    try {
      const maxBatches = backlog ? Math.max(1, cfg.l2.maxBatchesPerRun || 2) : 1;
      for (let i = 0; i < maxBatches; i++) {
        if (store.getPendingRecords(family).length === 0) break;
        const r = await runL2Batch(family, cfg);
        log.info(`L2 批次完成（${family}）: 本批 ${r.batchSize} 条 → ${r.scenes} 个场景，沿用 ${r.carried} 个、未归类 ${r.unplaced} 条，剩余待整合 ${r.left} 条`);
        if (r.left === 0) break;
      }
      if (store.getPendingRecords(family).length <= batchSize) {
        water.newSinceL2 = 0;
        store.saveState();
      }
    } catch (e) {
      log.warn(`L2 失败（${family}，下轮重试）: ${e.message || e}`);
    } finally {
      l2Running = false;
    }
  }

  /** 手动把积压一次推到底（设置页「立即整合」/ CLI 用）。 */
  async function buildScenes(family, batches = 3, onProgress) {
    const cfg = config.effective();
    const out = [];
    if (!cfg.l2.enabled) return out;
    if (l2Running || rebuildRunning) return out;
    const families = family === 'chat' || family === 'work' ? [family] : ['work', 'chat'];
    const batchSize = Math.max(1, Number(cfg.l2.batchRecords) || 60);
    l2Running = true;
    try {
      const max = Math.max(1, Math.min(200, Number(batches) || 3));
      for (const fam of families) {
        const before = store.getPendingRecords(fam).length;
        let done = 0;
        let skipped = 0;
        for (let i = 0; i < max; i++) {
          if (store.getPendingRecords(fam).length === 0) break;
          const r = await runL2Batch(fam, cfg);
          done++;
          skipped += r.skipped || 0;
          log.info(`L2 手动批次（${fam}）: 本批 ${r.batchSize} 条 → ${r.scenes} 个场景，剩余 ${r.left} 条`);
          if (typeof onProgress === 'function') {
            onProgress({ family: fam, batches: done, pendingBefore: before, pendingAfter: r.left, batchSize: r.batchSize || batchSize });
          }
          if (r.left === 0) break;
        }
        if (store.getPendingRecords(fam).length <= batchSize) {
          const w = store.familyWater(fam);
          w.newSinceL2 = 0;
        }
        store.saveState();
        out.push({ family: fam, batches: done, skipped, pendingBefore: before, pendingAfter: store.getPendingRecords(fam).length });
      }
    } catch (e) {
      log.warn(`L2 手动整合失败: ${e.message || e}`);
      out.push({ error: e.message || String(e) });
    } finally {
      l2Running = false;
    }
    return out;
  }

  /** 后台整合状态（设置页按钮用，避免一个 HTTP 请求挂十几分钟）。 */
  let sceneBuild = {
    running: false, batches: 0, total: 0, pendingBefore: 0, pendingAfter: 0, skipped: 0,
    fams: [], lastFamily: '', batchSize: 0, startedAt: 0, finishedAt: 0, error: '',
  };

  function sceneBuildStatus() {
    return { ...sceneBuild, elapsedMs: sceneBuild.running ? Date.now() - sceneBuild.startedAt : (sceneBuild.finishedAt && sceneBuild.startedAt ? sceneBuild.finishedAt - sceneBuild.startedAt : 0) };
  }

  function startSceneBuild(family, batches = 30) {
    if (sceneBuild.running) return { started: false, ...sceneBuildStatus() };
    if (l2Running || rebuildRunning) return { started: false, busy: true, ...sceneBuildStatus() };
    const cap = Math.max(1, Math.min(200, Number(batches) || 30));
    const only = family === 'chat' || family === 'work' ? family : undefined;
    const fams = only ? [only] : ['work', 'chat'];
    const batchSize = Math.max(1, Number(config.effective().l2.batchRecords) || 60);
    const pending0 = fams.reduce((n, f) => n + store.getPendingRecords(f).length, 0);
    sceneBuild = {
      ...sceneBuild,
      running: true, batches: 0, fams, batchSize,
      pendingBefore: pending0, pendingAfter: pending0, skipped: 0,
      total: Math.min(cap * fams.length, Math.ceil(pending0 / batchSize)),
      startedAt: Date.now(), finishedAt: 0, error: '', lastFamily: '',
    };
    let doneTotal = 0;
    buildScenes(only, cap, () => {
      doneTotal += 1;
      const left = fams.reduce((n, f) => n + store.getPendingRecords(f).length, 0);
      sceneBuild.batches = doneTotal;
      sceneBuild.pendingAfter = left;
      sceneBuild.total = Math.min(cap * fams.length, doneTotal + Math.ceil(left / batchSize));
    })
      .then((rows) => {
        const done = rows.filter((r) => !r.error);
        sceneBuild.batches = done.reduce((n, r) => n + (r.batches || 0), 0);
        sceneBuild.pendingBefore = done.reduce((n, r) => n + (r.pendingBefore || 0), 0);
        sceneBuild.pendingAfter = done.reduce((n, r) => n + (r.pendingAfter || 0), 0);
        sceneBuild.skipped = done.reduce((n, r) => n + (r.skipped || 0), 0);
        const err = rows.find((r) => r.error);
        if (err) sceneBuild.error = err.error;
        log.info(`L2 后台整合结束: ${sceneBuild.batches} 批，待整合 ${sceneBuild.pendingBefore} → ${sceneBuild.pendingAfter}`);
      })
      .catch((e) => { sceneBuild.error = e.message || String(e); })
      .finally(() => { sceneBuild.running = false; sceneBuild.finishedAt = Date.now(); });
    return { started: true, ...sceneBuildStatus() };
  }

  // ---------- L3 画像（分族） ----------
  async function maybeL3(family) {
    const cfg = config.effective();
    if (!cfg.l3.enabled || l3Running || rebuildRunning) return;
    const water = store.familyWater(family);
    if ((water.newSinceL3 || 0) < cfg.l3.interval) return;
    const persona = store.getPersona(family);
    l3Running = true;
    try {
      const { system, user } = buildL3Prompt({
        oldPersona: persona ? persona.content : '',
        records: store.getRecords(family),
        maxInputChars: cfg.llm.maxInputChars,
        family,
      });
      const result = await llm.call({ layer: 'l3', purpose: 'memory:persona', system, user });
      account(result, 'l3', 'persona', system.length + user.length);
      if (!result.ok) throw new Error(result.error);
      const parsed = parseL3Output(result.text);
      if (parsed === null) throw new Error('L3 输出解析失败');
      store.setPersona(family, parsed);
      water.newSinceL3 = 0;
      store.saveState();
      log.info(`L3 完成（${family}）: 画像已更新（${parsed.length} 字符）`);
    } catch (e) {
      log.warn(`L3 失败（${family}，下轮重试）: ${e.message || e}`);
    } finally {
      l3Running = false;
    }
  }

  // ---------- 记账（回退链逐次尝试各计一行，含失败尝试） ----------
  function account(result, layer, purpose, inChars) {
    const attempts = Array.isArray(result.attempts) && result.attempts.length > 0
      ? result.attempts
      : [{
          provider: result.route ? result.route.provider : '',
          model: result.route ? result.route.model : '',
          ok: result.ok === true,
          error: result.ok ? undefined : String(result.error || '').slice(0, 300),
          usage: result.usage || null,
        }];
    for (const attempt of attempts) {
      const usage = attempt.usage || {};
      store.appendUsage({
        layer,
        purpose,
        provider: attempt.provider || '',
        model: attempt.model || '',
        inChars: Math.max(0, Math.round(inChars || 0)),
        outputTokens: usage.outputTokens ?? null,
        reasoningTokens: usage.reasoningTokens ?? null,
        ok: attempt.ok === true,
        error: attempt.ok ? undefined : String(attempt.error || '').slice(0, 300),
      });
    }
  }

  /**
   * 蒸馏结束后自动合并高置信度近重复（audit.autoMerge 开关，默认关）。
   * 只挑包含度 ≥ audit.autoMergeThreshold 的组（比手工面板更严），每次合并都留可撤销台账；
   * 失败只告警，绝不影响蒸馏结果。
   */
  function autoMergeNearDuplicates(cfg) {
    try {
      if (!cfg.audit || !cfg.audit.autoMerge) return;
      const plan = planAutoMerges(store.getRecords(), {
        threshold: cfg.audit.autoMergeThreshold,
        maxMerges: cfg.audit.autoMergeMax,
        largeGroupMinSize: cfg.audit.autoMergeLargeMinSize,
        largeGroupThreshold: cfg.audit.largeGroupThreshold,
      });
      if (plan.length === 0) return;
      let dropped = 0;
      for (const g of plan) {
        const r = store.mergeRecords(g.keepId, g.dropIds, { content: g.content, auto: true });
        if (r) dropped += r.dropped;
      }
      log.info(`自动合并近重复: ${plan.length} 组 / 并入 ${dropped} 条（阈值 ${cfg.audit.autoMergeThreshold}，大组≥${cfg.audit.autoMergeLargeMinSize} 条放宽到 ${cfg.audit.largeGroupThreshold}，可撤销）`);
    } catch (e) {
      log.warn(`自动合并失败（已跳过）: ${e && e.message ? e.message : e}`);
    }
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
    const mode = modeOf(sid);
    if (mode === 'off') return; // off 档挂起蒸馏（切回后随下次活动恢复）
    if (mode === 'chat' || mode === 'work') { /* 纯档：切片强制族标签 */ }
    const s = store.sessionState(sid);
    if (s.backoffUntil && Date.now() < s.backoffUntil) return;
    const count = s.count || 0;
    if (count <= 0) return;
    try {
      const slice = store.readConversationSlice(sid, count, cfg.extract.backgroundMessages);
      if (slice.length === 0) { s.count = 0; store.saveState(); return; }
      log.info(`蒸馏管线开始（${reason}）: 会话 ${sid} 待蒸馏 ${count} 条（档位 ${mode}）`);
      await runL1(sid, slice, mode === 'chat' || mode === 'work' ? mode : 'auto');
      s.count = 0;
      s.rounds = (s.rounds || 0) + 1;
      s.attempts = 0;
      store.markDistilled(sid);
      for (const family of ['chat', 'work']) {
        await maybeL2(family);
        await maybeL3(family);
      }
      autoMergeNearDuplicates(cfg);
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
    log.info(`记忆重建开始: ${files.length} 个会话 / ${total} 条消息（统一 auto 档）`);
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
              await runL1(file.sid, chunk, 'auto'); // 重建统一 auto 档（族由抽取显式判定）
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
            for (const family of ['chat', 'work']) {
              const water = store.familyWater(family);
              water.newSinceL2 = cfg.l2.enabled ? store.getRecords(family).filter((r) => !r.sceneId).length : 0;
              water.newSinceL3 = store.getRecords(family).length;
            }
            store.saveState();
            for (const family of ['chat', 'work']) {
              await maybeL2(family);
              await maybeL3(family);
            }
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
      build: sceneBuildStatus(),
    };
  }

  function dispose() {
    for (const timer of idleTimers.values()) clearTimeout(timer);
    idleTimers.clear();
    sessionQueues.clear();
  }

  return { noteActivity, flushSession, startRebuild, cancelRebuild, status, dispose, maybeL2, maybeL3, buildScenes, startSceneBuild, sceneBuildStatus };
}
