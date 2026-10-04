#!/usr/bin/env node
/*
 * Live Clawd's MCP server (stdio), registered at user scope in Claude Code so every
 * session has a `clawd` tool. Claude calls it in the same message as a UI edit to say
 * where on the page the change shows up and how Clawd should act it out. Purely
 * cosmetic: it spools the choreography for the Clawdify bridge and returns "ok" — or
 * "off" when Firefox isn't listening, so Claude stops calling it.
 *
 * It waits briefly (≤1.2s) for the browser to confirm it has the choreography — and has
 * snapshotted anything about to be removed — so Clawd acts *before* hot reload lands.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const LIVE_DIR = path.join(os.homedir(), '.claudemonkey', 'live');
const SPOOL_DIR = path.join(LIVE_DIR, 'spool');
const ACK_DIR = path.join(LIVE_DIR, 'acks');
const ACK_WAIT_MS = 1200;

const ACTIONS = {
  vacuum: 'removing an element',
  erase: 'hiding something',
  paint: 'changing colours',
  spray: 'gradients, filters, blend effects',
  polish: 'borders, radius, shadows',
  font: 'typography',
  write: 'changing text content',
  build: 'layout, spacing, positioning',
  measure: 'sizes (width/height)',
  add: 'adding a new element',
  wire: 'event handlers / interactions',
  hack: 'network, data, logic',
  watch: 'state, effects, observers, timers',
  dance: 'animations, transitions',
  photo: 'images, icons, media',
  stash: 'storage, persistence',
  search: 'investigating something on screen',
  tinker: 'anything else',
};

const TOOL = {
  name: 'clawd',
  description: 'Cosmetic: animates Clawd on the user\'s open localhost dev page to show what your UI edit does. '
    + 'Call it in the SAME message as the edit, before it. Returns "ok", or "off" (then stop calling it this session). '
    + `Actions: ${Object.entries(ACTIONS).map(([k, v]) => `${k} (${v})`).join(', ')}.`,
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            target: {
              type: 'object',
              description: 'Where the change shows up. Any of: component (React component name), selector (CSS), '
                + 'text (visible text), testid; plus x/y (0..1 fractions across that element) for spots inside it, '
                + 'e.g. things drawn on a <canvas>.',
              properties: {
                component: { type: 'string' },
                selector: { type: 'string' },
                text: { type: 'string' },
                testid: { type: 'string' },
                x: { type: 'number', minimum: 0, maximum: 1 },
                y: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
            action: { type: 'string', enum: Object.keys(ACTIONS) },
            say: { type: 'string', description: 'Caption, ≤8 words.' },
            color: { type: 'string', description: 'New colour, for paint/spray.' },
            ms: { type: 'integer', minimum: 1000, maximum: 6000 },
          },
          required: ['target', 'action', 'say'],
        },
      },
    },
    required: ['steps'],
  },
};

let tmux;
function tmuxWindow() {
  if (tmux === undefined) {
    tmux = '';
    if (process.env.TMUX_PANE) {
      try {
        tmux = execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#I #W'],
          { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] })
          .replace(/[^\w .-]/g, '').trim().slice(0, 40);
      } catch { /* not in tmux after all */ }
    }
  }
  return tmux;
}

function listening() {
  try { return Date.now() - fs.statSync(path.join(LIVE_DIR, 'alive')).mtimeMs < 20000; } catch { return false; }
}

async function clawd(args) {
  if (!listening()) return 'off';
  const ackId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const ev = {
    clawd: true,
    cwd: process.cwd(),
    tmux: tmuxWindow(),
    pane: process.env.TMUX_PANE || '',
    steps: Array.isArray(args.steps) ? args.steps.slice(0, 6) : [],
    ackId,
  };
  fs.mkdirSync(SPOOL_DIR, { recursive: true });
  const f = path.join(SPOOL_DIR, `${process.hrtime.bigint()}-${process.pid}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(ev));
  fs.renameSync(`${f}.tmp`, f);
  // Give the browser a moment to pick it up (and snapshot what's about to change).
  const ack = path.join(ACK_DIR, ackId);
  for (const end = Date.now() + ACK_WAIT_MS; Date.now() < end;) {
    if (fs.existsSync(ack)) { try { fs.unlinkSync(ack); } catch { /* raced */ } break; }
    await new Promise(r => setTimeout(r, 40));
  }
  return 'ok';
}

const send = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id == null) return;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'clawd', version: '1.0.0' } } });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  } else if (method === 'tools/call') {
    let text = 'ok';
    try { if (params.name === 'clawd') text = await clawd(params.arguments || {}); } catch { /* cosmetic */ }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
