// dsh-memory — HTTP 路由（/api-memory/*）：设置页五区工作台的数据面。
// 只依赖 webServer 晚挂载；注册即用，卸载即收。
// 新增：会话档位（sessions）、分族资产过滤、成本洞察增强（粒度/窗口/分模型趋势/统计量）、
// 嵌入源管理（状态/重嵌/取消）。

import { join } from 'node:path';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { sanitizeConfig } from './config.js';
import * as audit from './audit.js';

/**
 * 写操作守卫：GET/HEAD 放行；其余必须带 `x-dsh-memory: 1`，且带 Origin 时必须是同源。
 *
 * 挡的是「浏览器里点个链接 / 打开个页面就把记忆库清掉」这类跨站请求——跨站表单发不出自定义头，
 * 带自定义头的跨站 fetch 会先发预检而宿主不回许可。本机同用户的脚本仍然调得动（它本来就拿得到
 * 数据文件），那是桌面壳 openBrowser 的决定，不在这层装样子。
 */
export const MUTATION_HEADER = 'x-dsh-memory';

export function mutationAllowed(req) {
  const method = String((req && req.method) || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true };
  const headers = (req && req.headers) || {};
  if (String(headers[MUTATION_HEADER] || '') !== '1') {
    return { ok: false, reason: `写操作需要 ${MUTATION_HEADER}: 1 头（同源客户端自带）` };
  }
  const origin = headers.origin;
  if (origin && String(origin) !== 'null') {
    let originHost = '';
    try { originHost = new URL(String(origin)).host; } catch { originHost = ''; }
    const selfHost = String(headers.host || '');
    if (!originHost || (selfHost && originHost !== selfHost)) {
      return { ok: false, reason: `跨源写操作被拒：${origin}` };
    }
  }
  return { ok: true };
}

export function registerRoutes(ctx, { store, pipeline, config, log, dataDir, modes, embedding, knowledge }) {
  const overlayPath = join(dataDir, 'config.json');

  function readOverlay() {
    return sanitizeConfig(loadJsonSafe(overlayPath));
  }

  function writeOverlay(patch) {
    const merged = { ...readOverlay(), ...patch };
    // 节级整体替换
    writeJsonSafe(overlayPath, merged);
    return merged;
  }

  // ---------- 会话档位 ----------
  function sessionList() {
    const state = store.getState();
    const convs = new Map(store.listConversationFiles().map((f) => [f.sid, f]));
    const entries = new Map();
    for (const [sid, s] of Object.entries(state.sessions || {})) {
      entries.set(sid, { sid, count: s.count || 0, lastActivityAt: s.lastActivityAt || 0 });
    }
    for (const [sid, f] of convs) {
      const e = entries.get(sid) || { sid, count: 0, lastActivityAt: 0 };
      e.lastActivityAt = Math.max(e.lastActivityAt, f.mtime || 0);
      e.hasL0 = true;
      entries.set(sid, e);
    }
    for (const m of modes.all()) {
      const e = entries.get(m.sid) || { sid: m.sid, count: 0, lastActivityAt: 0 };
      e.mode = m.mode;
      e.recall = m.recall ?? null;
      e.resume = m.resume ?? null;
      e.modeUpdatedAt = m.updatedAt;
      entries.set(m.sid, e);
    }
    const list = [...entries.values()];
    for (const e of list) {
      if (!e.mode) e.mode = null; // null = 未单独设置（跟随默认档）
      e.effectiveMode = e.mode || config.effective().family || 'auto';
    }
    list.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return list.slice(0, 100);
  }

  // ---------- 洞察聚合（粒度/窗口/分层） ----------
  function bucketKey(ts, granularity) {
    const d = new Date(ts);
    if (granularity === 'week') {
      const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7)); // 周一为界
      return day.toISOString().slice(0, 10);
    }
    if (granularity === 'month') return d.toISOString().slice(0, 7);
    return d.toISOString().slice(0, 10);
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  }

  const routes = [
    {
      kind: 'exact',
      path: '/api-memory/health',
      handler: async (_req, res) => {
        const cfg = config.effective();
        const state = store.getState();
        respond(res, {
          ok: true,
          enabled: cfg.enabled,
          family: cfg.family,
          dataDir,
          counts: store.counts(),
          stats: state.stats,
          lastError: log.lastError(),
          status: pipeline.status(),
          toolsEnabled: cfg.tools,
          sessionModes: modes ? modes.countStates() : { off: 0, wo: 0 },
          embedding: embedding ? embedding.status() : null,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/overview',
      handler: async (_req, res) => {
        const counts = store.counts();
        const state = store.getState();
        const personas = store.getPersonas();
        const usage7 = store.usageSince(7);
        const week = usage7.filter((u) => u.ok);
        respond(res, {
          counts,
          personaUpdatedAt: Math.max(personas.chat?.updatedAt || 0, personas.work?.updatedAt || 0),
          stats: state.stats,
          activity: store.recentActivity(20),
          pendingDistill: Object.values(state.sessions || {}).reduce((sum, s) => sum + (s.count || 0), 0),
          distillCalls7d: week.length,
          outputTokens7d: week.reduce((sum, u) => sum + (u.outputTokens || 0), 0),
          lastDistillAt: state.stats.lastDistillAt,
          rebuild: state.rebuild,
          families: {
            chat: { records: counts.recordsByFamily?.chat || 0, hasPersona: Boolean(personas.chat?.content) },
            work: { records: counts.recordsByFamily?.work || 0, hasPersona: Boolean(personas.work?.content) },
          },
          sessionModes: modes ? modes.countStates() : { off: 0, wo: 0 },
          embedding: embedding ? embedding.status() : null,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/assets',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const type = url.searchParams.get('type') || 'all';   // all | memory | scene | persona
        const family = url.searchParams.get('family') || 'all'; // all | chat | work
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
        const famFilter = family === 'chat' || family === 'work' ? family : null;
        const items = [];
        if (type === 'all' || type === 'memory') {
          for (const r of store.getRecords(famFilter)) {
            // 注意：本接口的 kind 是「资产层」判别符（memory/scene/persona），记忆类型另起 memKind 字段，避免撞名
            items.push({ kind: 'memory', id: r.id, title: r.content.slice(0, 80), content: r.content, tags: r.tags, family: r.family, memKind: r.kind || 'fact', updatedAt: r.updatedAt, sessionId: r.sessionId, sceneId: r.sceneId, hits: r.hits });
          }
        }
        if (type === 'all' || type === 'scene') {
          for (const s of store.getScenes(famFilter)) {
            items.push({ kind: 'scene', id: s.id, title: s.title, content: s.content, family: s.family, recordCount: (s.recordIds || []).length, updatedAt: s.updatedAt });
          }
        }
        if (type === 'all' || type === 'persona') {
          const personas = store.getPersonas();
          for (const fam of famFilter ? [famFilter] : ['chat', 'work']) {
            const persona = personas[fam];
            if (persona) items.push({ kind: 'persona', id: `persona-${fam}`, title: fam === 'chat' ? '个人画像（L3 · chat）' : '工作准则（L3 · work）', content: persona.content, family: fam, updatedAt: persona.updatedAt });
          }
        }
        let filtered = items;
        if (q) {
          const needle = q.toLowerCase();
          filtered = items.filter((i) => i.title.toLowerCase().includes(needle) || (i.content || '').toLowerCase().includes(needle));
        }
        filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        respond(res, { total: filtered.length, items: filtered.slice(0, limit) });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/scenes',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const family = url.searchParams.get('family');
        respond(res, { scenes: store.getScenes(family === 'chat' || family === 'work' ? family : undefined) });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/scenes/build',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          respond(res, {
            ok: true,
            build: pipeline.sceneBuildStatus(),
            pending: { chat: store.getPendingRecords('chat').length, work: store.getPendingRecords('work').length },
          });
          return;
        }
        if (req.method !== 'POST') {
          respond(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const started = pipeline.startSceneBuild(body.family, body.batches);
          respond(res, { ok: true, started, build: pipeline.sceneBuildStatus() });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/scenes/merge',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          respond(res, 405, { ok: false, error: '仅支持 POST' });
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const groups = body.keepId
            ? [{ keepId: String(body.keepId), dropIds: (Array.isArray(body.dropIds) ? body.dropIds : []).map(String) }]
            : audit.planSceneMerges(store.getScenes(), { maxGroups: 50 });
          let backup = '';
          if (groups.length > 0) {
            try {
              const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              const file = join(dataDir, `scenes.json.bak-merge-${stamp}`);
              if (!existsSync(file)) copyFileSync(join(dataDir, 'scenes.json'), file);
              backup = file;
            } catch (e) {
              log.warn(`场景合并前备份失败（继续合并）: ${e && e.message ? e.message : e}`);
            }
          }
          const done = [];
          let merged = 0;
          for (const g of groups) {
            const r = store.mergeScenes(g.keepId, g.dropIds);
            if (r) { merged += r.merged; done.push({ keepId: r.keepId, merged: r.merged, title: r.record.title }); }
          }
          respond(res, { ok: true, groups: done.length, merged, backup, detail: done });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/biases',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const family = url.searchParams.get('family');
        const famFilter = family === 'chat' || family === 'work' ? family : undefined;
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            if (body.action === 'delete') {
              respond(res, { ok: store.deleteBias(String(body.id || '')) > 0 });
              return;
            }
            if (!String(body.deviation || '').trim()) throw new Error('缺少偏差描述');
            if (!String(body.fix || '').trim()) throw new Error('缺少修正办法');
            const { bias, created } = store.upsertBias({
              id: body.id, kind: body.kind, scene: body.scene, deviation: body.deviation,
              rootCause: body.rootCause, fix: body.fix, family: body.family, tags: body.tags,
            });
            respond(res, { ok: true, created, bias });
          } catch (e) {
            respond(res, 400, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        const biases = store.getBiases(famFilter);
        respond(res, { total: biases.length, biases });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/audit',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const family = url.searchParams.get('family');
        const famFilter = family === 'chat' || family === 'work' ? family : undefined;
        const num = (key, fallback) => {
          const raw = url.searchParams.get(key);
          const n = Number(raw);
          return raw !== null && Number.isFinite(n) && n > 0 ? n : fallback;
        };
        const pending = {
          chat: store.getPendingRecords('chat').length,
          work: store.getPendingRecords('work').length,
        };
        const report = audit.auditHealth(store.getRecords(famFilter), {
          threshold: num('threshold', audit.AUDIT_DEFAULTS.dupThreshold),
          sleepDays: num('sleepDays', audit.AUDIT_DEFAULTS.sleepDays),
          headHits: num('headHits', audit.AUDIT_DEFAULTS.headHits),
          topN: num('topN', audit.AUDIT_DEFAULTS.topN),
          samples: num('samples', audit.AUDIT_DEFAULTS.samples),
          maxGroups: num('groups', audit.AUDIT_DEFAULTS.maxGroups),
        });
        const sceneList = store.getScenes();
        const sceneDups = audit.planSceneMerges(sceneList);
        respond(res, {
          ok: true, report, summary: audit.auditSummary(report), pending, build: pipeline.status().build,
          scenes: { total: sceneList.length, dupGroups: sceneDups.length, groups: sceneDups.slice(0, 20) },
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/records/merge',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          respond(res, 405, { ok: false, error: '仅支持 POST' });
          return;
        }
        try {
          const body = JSON.parse(await readBody(req));
          const before = () => {
            // 合并是破坏性操作：当天第一次合并前留一份完整备份（同一天只留一份）
            try {
              const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
              const file = join(dataDir, `records.json.bak-merge-${stamp}`);
              if (!existsSync(file)) copyFileSync(join(dataDir, 'records.json'), file);
              return file;
            } catch (e) {
              log.warn(`合并前备份失败（继续合并）: ${e && e.message ? e.message : e}`);
              return null;
            }
          };
          if (body.auto) {
            // 自动合并：只挑高置信度近重复，逐组走同一条 store 路径（每次都留可撤销台账）
            const cfg = config.effective();
            const threshold = Number(body.threshold) || (cfg.audit && cfg.audit.autoMergeThreshold) || 0.9;
            const maxMerges = Number(body.maxMerges) || (cfg.audit && cfg.audit.autoMergeMax) || 50;
            const largeGroupMinSize = Number(body.largeMinSize) || (cfg.audit && cfg.audit.autoMergeLargeMinSize) || 4;
            const largeGroupThreshold = Number(body.largeThreshold) || (cfg.audit && cfg.audit.largeGroupThreshold) || 0.72;
            const plan = audit.planAutoMerges(store.getRecords(), { threshold, maxMerges, largeGroupMinSize, largeGroupThreshold });
            if (plan.length === 0) {
              respond(res, { ok: true, groups: 0, dropped: 0, threshold, backup: null });
              return;
            }
            const backup = before();
            let dropped = 0;
            const batchIds = [];
            for (const g of plan) {
              const r = store.mergeRecords(g.keepId, g.dropIds, { content: g.content, auto: true });
              if (r) { dropped += r.dropped; if (r.batchId) batchIds.push(r.batchId); }
            }
            log.info(`自动合并近重复: ${plan.length} 组 / 并入 ${dropped} 条（阈值 ${threshold}，大组≥${largeGroupMinSize} 条放宽到 ${largeGroupThreshold}）`);
            respond(res, { ok: true, groups: plan.length, dropped, threshold, largeGroupMinSize, largeGroupThreshold, backup, batchIds });
            return;
          }
          const keepId = String(body.keepId || '').trim();
          const dropIds = Array.isArray(body.dropIds) ? body.dropIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
          if (!keepId) throw new Error('缺少 keepId');
          if (dropIds.length === 0) throw new Error('缺少 dropIds');
          const backup = before();
          const result = store.mergeRecords(keepId, dropIds, { content: body.content });
          if (!result) throw new Error('保留记录不存在');
          respond(res, { ok: true, dropped: result.dropped, backup, batchId: result.batchId, record: result.record });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/records/merge-undo',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          respond(res, 405, { ok: false, error: '仅支持 POST' });
          return;
        }
        try {
          const body = JSON.parse(await readBody(req));
          const target = body.all ? 'all' : String(body.batchId || 'last').trim() || 'last';
          const result = store.undoMerge(target);
          respond(res, { ok: true, ...result, target });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/records/merges',
      handler: async (req, res) => {
        respond(res, { ok: true, merges: store.listMerges(50) });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/sessions',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const sid = String(body.sid || '').trim();
            if (!sid) throw new Error('缺少 sid');
            if (body.mode !== undefined) {
              if (body.mode === null) {
                modes.clearMode(sid); // null = 清除档位覆盖，跟随全局默认档
                log.info(`会话档位已清除（跟随全局）: ${sid.slice(0, 12)}…`);
              } else {
                if (!['auto', 'chat', 'work', 'off'].includes(body.mode)) throw new Error(`非法档位: ${body.mode}`);
                modes.set(sid, body.mode);
                // 切回非 off 档时通知管线：挂起切片可恢复调度
                if (body.mode !== 'off') log.info(`会话档位已设置: ${sid.slice(0, 12)}… → ${body.mode}`);
                else log.info(`会话已暂停记忆（off）: ${sid.slice(0, 12)}…`);
              }
            }
            if (body.recall !== undefined) {
              modes.setRecall(sid, typeof body.recall === 'boolean' ? body.recall : null);
              log.info(`会话注入覆盖已设置: ${sid.slice(0, 12)}… → ${body.recall === null ? '跟随全局' : body.recall ? '强制开' : '只写'}`);
            }
            respond(res, { ok: true, sessions: sessionList() });
          } catch (e) {
            respond(res, 400, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        respond(res, { defaultMode: config.effective().family || 'auto', sessions: sessionList() });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/config',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req));
            const merged = writeOverlay(sanitizeConfig(body));
            log.info('运行时配置已更新（设置页）');
            // 知识库配置变化：延迟触发增量重扫（不阻塞响应）
            if (body && typeof body.knowledge === 'object' && knowledge) {
              setTimeout(() => { try { knowledge.scan(); } catch { /* 忽略 */ } }, 400);
            }
            respond(res, { ok: true, overlay: merged, effective: config.effective() });
          } catch (e) {
            respond(res, 400, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        respond(res, { overlay: readOverlay(), effective: config.effective() });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/knowledge',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            if (body.action === 'rescan') {
              const result = knowledge ? knowledge.scan() : { indexed: 0, dropped: 0, files: 0, chunks: 0, skipped: true };
              respond(res, { ok: true, result, status: knowledge ? knowledge.status() : null });
            } else {
              respond(res, 400, { ok: false, error: '未知 action，支持 rescan' });
            }
          } catch (e) {
            respond(res, 400, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        respond(res, { status: knowledge ? knowledge.status() : null });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/insights',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const retention = Math.max(1, config.effective().tokenCost?.retentionDays || 365);
        const windowDays = Math.max(1, Math.min(retention, Number(url.searchParams.get('days')) || 7));
        const granularityRaw = url.searchParams.get('granularity') || (windowDays > 90 ? 'month' : windowDays > 21 ? 'week' : 'day');
        const granularity = ['day', 'week', 'month'].includes(granularityRaw) ? granularityRaw : 'day';
        const layer = url.searchParams.get('layer'); // l1 | l2 | l3 | null
        const usage = store.usageSince(windowDays).filter((u) => !layer || u.layer === layer);

        const byModel = new Map();
        const byLayer = new Map();
        const byDay = new Map();
        const byModelDay = new Map();
        for (const entry of usage) {
          const modelKey = `${entry.provider || '?'}/${entry.model || '?'}`;
          const model = byModel.get(modelKey) || { calls: 0, failures: 0, outputTokens: 0, reasoningTokens: 0, inChars: 0, outputList: [] };
          model.calls += 1;
          if (entry.ok === false) model.failures += 1;
          model.outputTokens += entry.outputTokens || 0;
          model.reasoningTokens += entry.reasoningTokens || 0;
          model.inChars += entry.inChars || 0;
          if (entry.ok !== false && entry.outputTokens != null) model.outputList.push(entry.outputTokens);
          byModel.set(modelKey, model);

          const layerEntry = byLayer.get(entry.layer) || { calls: 0, failures: 0, outputTokens: 0 };
          layerEntry.calls += 1;
          if (entry.ok === false) layerEntry.failures += 1;
          layerEntry.outputTokens += entry.outputTokens || 0;
          byLayer.set(entry.layer, layerEntry);

          const day = bucketKey(entry.ts, 'day');
          const d = byDay.get(day) || { added: 0, calls: 0, outputTokens: 0 };
          d.calls += 1;
          d.outputTokens += entry.outputTokens || 0;
          byDay.set(day, d);

          const mdKey = `${modelKey}|${bucketKey(entry.ts, granularity)}`;
          const md = byModelDay.get(mdKey) || { model: modelKey, bucket: bucketKey(entry.ts, granularity), outputTokens: 0, calls: 0 };
          md.outputTokens += entry.outputTokens || 0;
          md.calls += 1;
          byModelDay.set(mdKey, md);
        }
        const activity = store.recentActivity(500);
        for (const a of activity) {
          const day = bucketKey(a.ts, 'day');
          const d = byDay.get(day) || { added: 0, calls: 0, outputTokens: 0 };
          if (a.verb === 'added') d.added += 1;
          byDay.set(day, d);
        }
        respond(res, {
          windowDays,
          granularity,
          layer: layer || null,
          byModel: [...byModel.entries()].map(([model, v]) => ({
            model,
            calls: v.calls,
            failures: v.failures,
            outputTokens: v.outputTokens,
            reasoningTokens: v.reasoningTokens,
            inChars: v.inChars,
            avgOutput: v.outputList.length > 0 ? Math.round(v.outputTokens / v.outputList.length) : 0,
            medianOutput: median(v.outputList),
          })),
          byLayer: [...byLayer.entries()].map(([layerKey, v]) => ({ layer: layerKey, ...v })),
          byDay: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, v]) => ({ day, ...v })),
          trend: [...byModelDay.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : 1)),
          recall: store.getState().stats,
          sessionModes: modes ? modes.countStates() : { off: 0, wo: 0 },
          failures: usage.filter((u) => u.ok === false).slice(0, 20),
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/logs',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const limit = Math.max(10, Math.min(500, Number(url.searchParams.get('limit')) || 200));
        respond(res, { lines: log.tail(limit), errors: log.errors() });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/rebuild',
      handler: async (req, res) => {
        if (req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            if (body.action === 'cancel') {
              respond(res, { ok: pipeline.cancelRebuild() });
              return;
            }
            const result = await pipeline.startRebuild();
            respond(res, { ok: result.started === true, ...result });
          } catch (e) {
            respond(res, 500, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        respond(res, { status: pipeline.status() });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/embedding',
      handler: async (req, res) => {
        if (req.method === 'POST' && embedding) {
          try {
            const body = JSON.parse(await readBody(req) || '{}');
            if (body.action === 'cancel') {
              embedding.cancelReindex();
              respond(res, { ok: true });
              return;
            }
            if (body.action === 'clear') {
              embedding.drop(null);
              log.info('向量缓存已清空');
              respond(res, { ok: true });
              return;
            }
            if (!embedding.ready()) {
              respond(res, 400, { ok: false, error: '嵌入源未就绪（检查 embedding.enabled/baseUrl/apiKey/model/dimensions）' });
              return;
            }
            const result = await embedding.ensureIndexed(store.getRecords());
            respond(res, { ok: result.failed === 0, ...result, status: embedding.status() });
          } catch (e) {
            respond(res, 500, { ok: false, error: e.message || String(e) });
          }
          return;
        }
        respond(res, { status: embedding ? embedding.status() : null });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/records/delete',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req));
          const removed = store.deleteRecord(String(body.id || ''));
          if (embedding && removed > 0) embedding.drop(String(body.id));
          respond(res, { ok: removed > 0 });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/wipe',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req));
          const scope = body.scope === 'all' ? 'all' : 'assets'; // assets: 只清 L1-L3；all: 连 L0 一起
          store.wipe({ keepConversations: scope !== 'all' });
          if (embedding) embedding.drop(null);
          log.warn(`记忆库已清空（scope=${scope}）`);
          respond(res, { ok: true, scope });
        } catch (e) {
          respond(res, 400, { ok: false, error: e.message || String(e) });
        }
      },
    },
  ];

  const disposers = [];
  ctx.effect(() => {
    for (const route of routes) {
      const inner = route.handler;
      disposers.push(ctx.webServer.register({
        ...route,
        handler: async (req, res) => {
          const gate = mutationAllowed(req);
          if (!gate.ok) {
            log.warn(`拒绝写请求 ${route.path}: ${gate.reason}`);
            respond(res, 403, { ok: false, error: gate.reason });
            return;
          }
          return inner(req, res);
        },
      }, `dsh-memory: ${route.path}`));
    }
    return () => {
      for (const dispose of disposers) {
        try { dispose(); } catch { /* 忽略 */ }
      }
    };
  }, 'dsh-memory: routes');

  return { readOverlay };
}

// ---------- 小工具 ----------
function respond(res, bodyOrStatus, maybeBody) {
  const status = typeof bodyOrStatus === 'number' ? bodyOrStatus : 200;
  const body = typeof bodyOrStatus === 'number' ? maybeBody : bodyOrStatus;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function loadJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

function writeJsonSafe(path, value) {
  try {
    writeFileSync(path, JSON.stringify(value, null, 1), 'utf-8');
  } catch { /* 写失败仅告警 */ }
}
