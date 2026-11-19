// dsh-memory — 版本比较与远端更新检查（参照 dsh-cron-board 的 version.js，改 ESM）。
// 支持复用同步代理：跨境直连 GitHub 常断，走配置的 socks5/http 代理更稳。

import { proxiedFetch } from './proxy.js';

const REPO = 'Hickey-Yuze/dsh-memory';
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAGS = `https://api.github.com/repos/${REPO}/tags?per_page=1`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = null;

/** 去掉可能的 `v` / `V` 前缀与首尾空白。 */
export function normalizeVersion(raw) {
  return String(raw || '').trim().replace(/^[vV]/, '');
}

/** 解析成数字段（忽略预发布后缀，如 `0.2.0-beta.1` → [0,2,0]）。 */
function versionParts(v) {
  const core = normalizeVersion(v).split(/[-+]/, 1)[0] ?? '';
  return core
    .split('.')
    .map((seg) => {
      const n = Number.parseInt(seg, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

/**
 * 比较两个版本号：`a > b` → 正数，`a < b` → 负数，相等 → 0。
 * 缺位按 0 补齐（`0.2` 等价 `0.2.0`）。
 */
export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function getJson(url, signal, proxy, token) {
  // 调用方 signal 与内部超时取先到者：任一触发都不再等待网络。
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const merged = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-memory' };
    if (typeof token === 'string' && token.trim() !== '') {
      headers.authorization = `Bearer ${token.trim()}`;
      headers['x-github-api-version'] = '2022-11-28';
    }
    const options = { headers, signal: merged };
    const res = proxy
      ? await proxiedFetch(url, options, proxy, { timeoutMs: TIMEOUT_MS })
      : await fetch(url, options);
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * 查询远端最新版本。任何失败（网络 / 限流 / 结构不符）都返回 `null`。
 * @param current 当前版本（package.json 的 version）
 * @param options.force 跳过缓存（用户手动点击重新检查时传 true）
 * @param options.proxy 复用同步代理（socks5://… / http://…），直连失败时更稳
 * @param options.token 同步用的 GitHub token（认证限额 5000/小时，未认证代理 IP 会被限流）
 */
export async function checkUpdate(current, options = {}) {
  const proxy = typeof options.proxy === 'string' && options.proxy.trim() !== '' ? options.proxy.trim() : '';
  const token = typeof options.token === 'string' ? options.token : '';
  const now = Date.now();
  if (!options.force && cache !== null && now - cache.at < CACHE_TTL_MS) {
    // 缓存命中：但 current 可能变化（热更新 dist），命中时仍按当前值重算 hasUpdate。
    const hit = cache.value;
    if (hit !== null) {
      return { ...hit, current, hasUpdate: compareVersions(hit.latest, current) > 0 };
    }
    return null;
  }
  let latest = '';
  let url = RELEASES_PAGE;
  const release = await getJson(RELEASES_LATEST, options.signal, proxy, token);
  if (release !== undefined && typeof release.tag_name === 'string') {
    latest = normalizeVersion(release.tag_name);
    if (typeof release.html_url === 'string' && release.html_url !== '') url = release.html_url;
  } else {
    const tags = await getJson(TAGS, options.signal, proxy, token);
    if (Array.isArray(tags)) {
      const first = tags[0];
      if (first !== null && typeof first === 'object') {
        const name = first.name;
        if (typeof name === 'string') latest = normalizeVersion(name);
      }
    }
  }
  if (latest === '') {
    // 网络不可用或 API 结构异常：不写缓存，下次调用可重试。
    return null;
  }
  const value = { current, latest, hasUpdate: compareVersions(latest, current) > 0, url };
  cache = { at: now, value };
  return value;
}

/** 测试与热更新场景用：清空缓存。 */
export function resetUpdateCache() {
  cache = null;
}
