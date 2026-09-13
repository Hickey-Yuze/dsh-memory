// dsh-memory — HTTP 路由（/api-memory/*）：设置页五区工作台的数据面。
// 只依赖 webServer 晚挂载；注册即用，卸载即收。

import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { sanitizeConfig } from './config.js';

export function registerRoutes(ctx, { store, pipeline, config, log, dataDir }) {
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
          dataDir,
          counts: store.counts(),
          stats: state.stats,
          lastError: log.lastError(),
          status: pipeline.status(),
          toolsEnabled: cfg.tools,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/overview',
      handler: async (_req, res) => {
        const counts = store.counts();
        const state = store.getState();
        const persona = store.getPersona();
        const usage7 = store.usageSince(7);
        const week = usage7.filter((u) => u.ok);
        respond(res, {
          counts,
          personaUpdatedAt: persona ? persona.updatedAt : 0,
          stats: state.stats,
          activity: store.recentActivity(20),
          pendingDistill: Object.values(state.sessions || {}).reduce((sum, s) => sum + (s.count || 0), 0),
          distillCalls7d: week.length,
          outputTokens7d: week.reduce((sum, u) => sum + (u.outputTokens || 0), 0),
          lastDistillAt: state.stats.lastDistillAt,
          rebuild: state.rebuild,
        });
      },
    },
    {
      kind: 'exact',
      path: '/api-memory/assets',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const type = url.searchParams.get('type') || 'all';   // all | memory | scene | persona
        const q = (url.searchParams.get('q') || '').trim();
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
        const items = [];
        if (type === 'all' || type === 'memory') {
          for (const r of store.getRecords()) {
            items.push({ kind: 'memory', id: r.id, title: r.content.slice(0, 80), content: r.content, tags: r.tags, updatedAt: r.updatedAt, sessionId: r.sessionId, sceneId: r.sceneId, hits: r.hits });
          }
        }
        if (type === 'all' || type === 'scene') {
          for (const s of store.getScenes()) {
            items.push({ kind: 'scene', id: s.id, title: s.title, content: s.content, recordCount: (s.recordIds || []).length, updatedAt: s.updatedAt });
          }
        }
        if (type === 'all' || type === 'persona') {
          const persona = store.getPersona();
          if (persona) items.push({ kind: 'persona', id: 'persona', title: '用户画像（L3）', content: persona.content, updatedAt: persona.updatedAt });
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
      handler: async (_req, res) => {
        respond(res, { scenes: store.getScenes() });
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
      path: '/api-memory/insights',
      handler: async (_req, res) => {
        const days = 7;
        const usage = store.usageSince(days);
        const byModel = new Map();
        const byLayer = new Map();
        const byDay = new Map();
        for (const entry of usage) {
          const modelKey = `${entry.provider || '?'}/${entry.model || '?'}`;
          const model = byModel.get(modelKey) || { calls: 0, failures: 0, outputTokens: 0, reasoningTokens: 0, inChars: 0 };
          model.calls += 1;
          if (entry.ok === false) model.failures += 1;
          model.outputTokens += entry.outputTokens || 0;
          model.reasoningTokens += entry.reasoningTokens || 0;
          model.inChars += entry.inChars || 0;
          byModel.set(modelKey, model);
          const layer = byLayer.get(entry.layer) || { calls: 0, failures: 0, outputTokens: 0 };
          layer.calls += 1;
          if (entry.ok === false) layer.failures += 1;
          layer.outputTokens += entry.outputTokens || 0;
          byLayer.set(entry.layer, layer);
          const day = new Date(entry.ts).toISOString().slice(0, 10);
          const d = byDay.get(day) || { added: 0, calls: 0, outputTokens: 0 };
          d.calls += 1;
          d.outputTokens += entry.outputTokens || 0;
          byDay.set(day, d);
        }
        const activity = store.recentActivity(200);
        for (const a of activity) {
          const day = new Date(a.ts).toISOString().slice(0, 10);
          const d = byDay.get(day) || { added: 0, calls: 0, outputTokens: 0 };
          if (a.verb === 'added') d.added += 1;
          byDay.set(day, d);
        }
        respond(res, {
          windowDays: days,
          byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })),
          byLayer: [...byLayer.entries()].map(([layer, v]) => ({ layer, ...v })),
          byDay: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, v]) => ({ day, ...v })),
          recall: store.getState().stats,
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
      path: '/api-memory/records/delete',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req));
          const removed = store.deleteRecord(String(body.id || ''));
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
      disposers.push(ctx.webServer.register(route, `dsh-memory: ${route.path}`));
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
