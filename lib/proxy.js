/**
 * 零依赖代理 fetch：让 Node 原生 fetch（undici）走 HTTP/HTTPS 代理。
 *
 * undici 的全局 fetch 不支持 ProxyAgent 以外的自定义 dispatcher（除非
 * 引 undici 包——插件零依赖），所以这里用最朴素的方案：
 *
 *  1) http:// 代理 → 与代理建 TCP 连接 → 发 CONNECT host:port → 拿到
 *     隧道后直接向目标发 TLS/明文请求（实际上 undici 无法复用我们建的
 *     连接，所以本实现改为：通过代理隧道「自己发一次完整 HTTP 请求」，
 *     把响应体读回来，返回一个形似 Response 的包装对象）。
 *
 *  2) socks5:// 代理 → RFC1928 握手（NO AUTH）→ 目标地址直连隧道。
 *
 * 包装对象对齐 fetch 的 Response 最小接口（ok/status/headers/arrayBuffer/
 * text/json），供 sync.js 的调用点无痛切换。
 *
 * 代理地址格式：socks5://host:port 或 http://host:port（https:// 也按
 * http 隧道处理，代理本身用明文 TCP 连）。留空/未配置 → 返回 null，
 * 调用方继续用原生 fetch。
 */

import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

/** 解析代理地址 → { kind: 'socks5'|'http', host, port }；非法或空返回 null。 */
export function parseProxy(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== 'string') return null;
  const s = proxyUrl.trim();
  if (!s) return null;
  let m = /^(socks5|socks5h):\/\/([^:/]+)(?::(\d+))?$/i.exec(s);
  if (m) return { kind: 'socks5', host: m[2], port: m[3] ? Number(m[3]) : 1080 };
  m = /^(https?):\/\/([^:/]+)(?::(\d+))?$/i.exec(s);
  if (m) return { kind: 'http', host: m[2], port: m[3] ? Number(m[3]) : 80 };
  return null;
}

/** socks5 握手（RFC1928）：NO AUTH + CONNECT 目标。返回已建立的目标隧道 socket。 */
async function socks5Tunnel(host, port, targetHost, targetPort, timeoutMs = 30000) {
  const socket = connect({ host, port }, () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`socks5 连接代理超时：${host}:${port}`)); }, timeoutMs);
    const onErr = (e) => { clearTimeout(timer); socket.destroy(); reject(e); };
    socket.on('error', onErr);
    let buf = Buffer.alloc(0);
    let step = 0; // 0=版本协商响应, 1=connect 响应
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (step === 0) {
        if (buf.length < 2) return;
        const [ver, method] = buf;
        if (ver !== 5 || method !== 0) {
          clearTimeout(timer); socket.destroy();
          reject(new Error(`socks5 协商失败（ver=${ver} method=${method}），代理可能需要认证`));
          return;
        }
        buf = buf.subarray(2);
        step = 1;
        // 发 CONNECT 请求：VER=5 CMD=1 RSV=0 ATYP=1(IPv4) 域名走 ATYP=3
        let addrBuf;
        const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(targetHost);
        if (isIpv4) {
          addrBuf = Buffer.from([1, ...targetHost.split('.').map(Number)]);
        } else {
          const nb = Buffer.byteLength(targetHost, 'utf-8');
          addrBuf = Buffer.from([3, nb]);
          addrBuf = Buffer.concat([addrBuf, Buffer.from(targetHost, 'utf-8')]);
        }
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), addrBuf, portBuf]));
      }
      if (step === 1) {
        if (buf.length < 10) return;
        const [ver, rep] = buf;
        if (ver !== 5 || rep !== 0) {
          clearTimeout(timer); socket.destroy();
          reject(new Error(`socks5 连接目标失败（rep=${rep}），请检查代理/目标可达性`));
          return;
        }
        // 剩余字节是绑定地址+端口（10 字节），其后可能已混入目标响应数据：
        // 一并放回读取队列，交给后续 rawRequest 消费（握手响应与目标首包同包到达时不能丢）。
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onErr);
        if (buf.length > 10) socket.unshift(buf.subarray(10));
        resolve(socket);
      }
    };
    socket.on('data', onData);
    socket.write(Buffer.from([5, 1, 0])); // VER=5 NMethods=1 Method=0(no auth)
  });
}

/** http 代理 CONNECT 隧道。 */
async function httpTunnel(host, port, targetHost, targetPort, timeoutMs = 30000) {
  const socket = connect({ host, port }, () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`http 代理连接超时：${host}:${port}`)); }, timeoutMs);
    const onErr = (e) => { clearTimeout(timer); socket.destroy(); reject(e); };
    socket.on('error', onErr);
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onErr);
      const head = buf.subarray(0, idx).toString('latin1');
      const m = /^HTTP\/\d\.\d\s+(\d{3})/.exec(head);
      if (!m || Number(m[1]) !== 200) {
        socket.destroy();
        reject(new Error(`http 代理 CONNECT 失败（${head.split('\r\n')[0]}）`));
        return;
      }
      // CONNECT 响应头之后可能已混入目标响应数据：放回读取队列，
      // 由后续 rawRequest 消费（头与目标首包同包到达时不能丢）。
      if (buf.length > idx + 4) socket.unshift(buf.subarray(idx + 4));
      resolve(socket);
    };
    socket.on('data', onData);
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
  });
}

/** 通过代理隧道自己发一次 HTTP 请求（原始字节），返回 { status, headers, body(Buffer) }。 */
function rawRequest(socket, urlObj, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const method = options.method || 'GET';
    const path = urlObj.pathname + (urlObj.search || '');
    const headers = { ...(options.headers || {}) };
    headers.host = urlObj.host;
    if (options.body !== undefined && headers['content-length'] === undefined) {
      headers['content-length'] = Buffer.byteLength(options.body, 'utf-8');
    }
    const headLines = [`${method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) headLines.push(`${k}: ${v}`);
    const requestBuf = Buffer.from(headLines.join('\r\n') + '\r\n\r\n' + (options.body || ''), 'utf-8');
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('通过代理请求超时')); }, timeoutMs);
    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try { const r = tryParse(buf); if (r) { clearTimeout(timer); socket.removeListener('data', onData); socket.destroy(); resolve(r); } } catch { /* 继续收 */ }
    };
    socket.on('data', onData);
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    socket.write(requestBuf);
  });
}

/** 解析「headers + body」的原始响应；body 未收全返回 null。 */
function tryParse(buf) {
  const idx = buf.indexOf('\r\n\r\n');
  if (idx < 0) return null;
  const headText = buf.subarray(0, idx).toString('latin1');
  const headLines = headText.split('\r\n');
  const statusLine = headLines[0];
  const m = /^HTTP\/\d\.\d\s+(\d{3})\s*(.*)$/.exec(statusLine);
  if (!m) return null;
  const status = Number(m[1]);
  const headers = {};
  for (let i = 1; i < headLines.length; i++) {
    const c = headLines[i].indexOf(':');
    if (c > 0) headers[headLines[i].slice(0, c).trim().toLowerCase()] = headLines[i].slice(c + 1).trim();
  }
  let bodyStart = idx + 4;
  const contentLength = Number(headers['content-length'] || -1);
  const chunked = String(headers['transfer-encoding'] || '').toLowerCase().includes('chunked');
  let body;
  if (chunked) {
    // 简单 chunked 解码（只处理最后一帧前完整的块）
    let pos = bodyStart;
    const chunks = [];
    for (;;) {
      const lf = buf.indexOf('\r\n', pos);
      if (lf < 0) return null;
      const sizeHex = buf.subarray(pos, lf).toString('latin1').trim().split(';')[0];
      const size = parseInt(sizeHex, 16);
      if (Number.isNaN(size)) return null;
      if (size === 0) break;
      if (buf.length < lf + 2 + size) return null;
      chunks.push(buf.subarray(lf + 2, lf + 2 + size));
      pos = lf + 2 + size + 2;
    }
    body = Buffer.concat(chunks);
  } else if (contentLength >= 0) {
    if (buf.length < bodyStart + contentLength) return null;
    body = buf.subarray(bodyStart, bodyStart + contentLength);
  } else {
    // 无长度信息：HTTP/1.1 连接关闭即为响应结束——但我们主动 destroy 了，
    // 这里取「剩余全部」近似（隧道模式少见无长度响应，兜底可用）
    body = buf.subarray(bodyStart);
  }
  return { status, headers, body };
}

/** Response 最小包装（对齐 fetch 接口）。 */
class ProxyResponse {
  constructor(status, headers, body) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = {
      get: (name) => { const k = String(name).toLowerCase(); return Object.prototype.hasOwnProperty.call(headers, k) ? headers[k] : null; },
    };
    this._body = body;
  }
  async arrayBuffer() { return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength); }
  async text() { return this._body.toString('utf-8'); }
  async json() { return JSON.parse(this._body.toString('utf-8')); }
}

/**
 * 统一的代理 fetch：
 *   - 未配置代理 → 返回 null（调用方用原生 fetch）
 *   - 配置了代理 → 返回 ProxyResponse（对齐 Response 接口）
 *   - 代理握手/请求失败 → 抛出带上下文错误
 * options 支持：method/headers/body/signal(AbortSignal——timeoutMs 内部实现)。
 */
export async function proxiedFetch(url, options = {}, proxyUrl, { timeoutMs = 120000 } = {}) {
  const p = parseProxy(proxyUrl);
  if (!p) return null;
  const urlObj = new URL(url);
  const targetHost = urlObj.hostname;
  const targetPort = urlObj.port ? Number(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80);
  const tunnel = p.kind === 'socks5'
    ? await socks5Tunnel(p.host, p.port, targetHost, targetPort, timeoutMs)
    : await httpTunnel(p.host, p.port, targetHost, targetPort, timeoutMs);
  // 目标 https → 需要 TLS，但隧道已建立，直接套 TLS 包在原始 socket 上即可
  let socket = tunnel;
  if (urlObj.protocol === 'https:') {
    socket = await new Promise((resolve, reject) => {
      const tls = tlsConnect({ socket: tunnel, servername: targetHost }, () => resolve(tls));
      tls.on('error', (e) => { tunnel.destroy(); reject(e); });
    });
  }
  const r = await rawRequest(socket, urlObj, options, timeoutMs);
  return new ProxyResponse(r.status, r.headers, r.body);
}
