/**
 * The localhost bridge between Claude Code and the Live Clawd browser extension.
 *
 * One process serves 127.0.0.1:47215 (CLAWD_PORT): the `clawd` MCP server of whichever
 * Claude session got there first. Every other session's MCP server, and every hook, posts
 * its events to it; if it goes away, another session's MCP server takes the port over
 * within a few seconds (`keepLeading`) and the extension reconnects by itself.
 *
 * Who may talk to it, with no pairing step:
 *  - The extension connects with a WebSocket. Browsers stamp every WebSocket with the
 *    page's Origin and pages can't fake it, so only extension origins are accepted: no
 *    website you visit can listen in on your sessions.
 *  - Events are posted by local programs (hooks, other sessions). Those requests must
 *    carry `X-Clawd: 1` and no Origin; a web page can do neither without a CORS preflight,
 *    which this server never answers.
 *  - The Host header must be the loopback address (no DNS-rebinding tricks).
 */
import http from 'node:http';
import { acceptWebSocket } from './ws.mjs';
import { relay } from './relay.mjs';

export const PORT = +process.env.CLAWD_PORT || 47215;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const EXTENSION_ORIGIN = /^(moz-extension|chrome-extension):\/\/[\w-]+$/;
const ACK_WAIT_MS = 1200; // how long a `clawd` call waits for the browser to have it

let server = null; // set while this process serves the port
/** @type {Set<{send: function, close: function}>} connected browsers */
const browsers = new Set();
/** @type {Map<string, function>} ackId -> resolver of a waiting `clawd` call */
const acks = new Map();

const hostOk = req => HOSTS.has(String(req.headers.host || '').toLowerCase());

/** Try to serve the port; resolves true if this process now does (or already did). */
export function lead() {
  if (server) return Promise.resolve(true);
  return new Promise(resolve => {
    const s = http.createServer(onRequest);
    s.on('upgrade', onUpgrade);
    s.once('error', () => resolve(false)); // EADDRINUSE: someone else serves it
    s.listen(PORT, '127.0.0.1', () => {
      server = s;
      s.on('error', () => {});
      resolve(true);
    });
  });
}

/** Serve the port now if it's free, and take it over whenever it becomes free. */
export function keepLeading(everyMs = 3000) {
  lead();
  setInterval(lead, everyMs).unref();
}

function onUpgrade(req, socket) {
  if (!hostOk(req) || !EXTENSION_ORIGIN.test(String(req.headers.origin || ''))) {
    socket.destroy();
    return;
  }
  const ws = acceptWebSocket(req, socket);
  if (!ws) return;
  browsers.add(ws);
  ws.onMessage = text => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m && m.type === 'ack' && acks.has(m.ackId)) acks.get(m.ackId)(String(m.status || ''));
  };
  ws.onClose = () => browsers.delete(ws);
  ws.send(JSON.stringify({ type: 'hello', version: 1 }));
}

function onRequest(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  // Local programs only: never a web page (see the header comment).
  if (!hostOk(req) || req.headers.origin || req.headers['x-clawd'] !== '1') {
    res.writeHead(403).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    json(200, { browsers: browsers.size });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/event') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', d => {
    body += d;
    if (body.length > 1 << 20) req.destroy();
  });
  req.on('end', async () => {
    let ev;
    try { ev = JSON.parse(body); } catch { json(400, { status: 'bad-json' }); return; }
    json(200, { status: await handleEvent(ev) });
  });
}

/**
 * Pass an event to the connected browser(s). Resolves with what happened, for a waiting
 * `clawd` call: 'played' | 'no-tab' (the dev page isn't the visible tab) | 'no-server'
 * (the project has no dev server running) | 'off-browser' (no extension connected) |
 * 'timeout' | 'sent' | 'ignored'.
 */
export async function handleEvent(ev) {
  if (!browsers.size) return 'off-browser';
  let out;
  try { out = relay(ev); } catch { return 'ignored'; }
  if (!out) return 'ignored';
  if (out.status) return out.status;
  const msg = JSON.stringify({ type: 'live', ...out });
  for (const ws of browsers) ws.send(msg);
  if (!out.ackId) return 'sent';
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      acks.delete(out.ackId);
      resolve('timeout');
    }, ACK_WAIT_MS);
    acks.set(out.ackId, status => {
      clearTimeout(timer);
      acks.delete(out.ackId);
      resolve(status || 'played');
    });
  });
}

/**
 * From any process: hand an event to the bridge (this process's, if it serves the port).
 * Resolves like handleEvent, or 'off-bridge' if nobody serves the port.
 */
export async function postEvent(ev, timeoutMs = 2500) {
  if (server) return handleEvent(ev);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clawd': '1' },
      body: JSON.stringify(ev),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()).status || 'sent';
  } catch {
    return 'off-bridge';
  }
}
