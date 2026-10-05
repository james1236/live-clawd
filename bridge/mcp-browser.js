#!/usr/bin/env node
/*
 * Clawdify's MCP server (stdio), launched by `claude -p` via the per-request
 * --mcp-config that host.js writes. It only describes the tools and forwards calls
 * over a unix socket to host.js, which relays tab tools to the extension — where each
 * call waits for the user to press Approve in the sidebar.
 *
 *   node mcp-browser.js <socket-path>
 */
'use strict';

const net = require('net');
const readline = require('readline');

const SOCK = process.argv[2];

const reason = { type: 'string', description: 'One short sentence shown to the user on the approval button: why you need this.' };
const TOOLS = [
  {
    name: 'page_info',
    description: 'URL, title, viewport size and the text the user has selected in the tab. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason }, required: ['reason'] },
  },
  {
    name: 'page_snapshot',
    description: 'Fresh snapshot of the live tab (e.g. after navigating or clicking). Writes the full HTML to page-live.html in your cwd and returns the visible text. Optional selector limits it to one element. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason, selector: { type: 'string' } }, required: ['reason'] },
  },
  {
    name: 'page_eval',
    description: 'Run JavaScript once in the tab (content-script context: full DOM, not the page\'s own JS globals). `code` is the body of an async function — `return` a JSON-serialisable value. Not persisted. Needs the user\'s approval (they see the code).',
    inputSchema: { type: 'object', properties: { reason, code: { type: 'string' } }, required: ['reason', 'code'] },
  },
  {
    name: 'click',
    description: 'Click the element matching a CSS selector (index picks among several matches). Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason, selector: { type: 'string' }, index: { type: 'integer', minimum: 0 } }, required: ['reason', 'selector'] },
  },
  {
    name: 'type',
    description: 'Type text into an input/textarea matching a CSS selector (replacing its value), optionally submitting its form. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason, selector: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['reason', 'selector', 'text'] },
  },
  {
    name: 'navigate',
    description: 'Load a URL in the tab and wait for it to finish loading. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason, url: { type: 'string' } }, required: ['reason', 'url'] },
  },
  {
    name: 'reload',
    description: 'Reload the tab and wait for it to load. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason }, required: ['reason'] },
  },
  {
    name: 'wait_for',
    description: 'Wait (up to timeoutMs, max 60000) until an element matching selector exists, or the page contains text. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason, selector: { type: 'string' }, text: { type: 'string' }, timeoutMs: { type: 'integer' } }, required: ['reason'] },
  },
  {
    name: 'screenshot',
    description: 'Screenshot the visible tab to page-screenshot-live.png in your cwd (the tab must be the active one). Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { reason }, required: ['reason'] },
  },
  {
    name: 'save_output',
    description: 'Save a file for the user (CSV, JSON, markdown, …) under ~/Clawdify/outputs/<site>/. The sidebar offers it for download. No approval needed (it does not touch the tab).',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' } }, required: ['filename', 'content'] },
  },
  {
    name: 'clawd',
    description: 'Cosmetic: Clawd, the mascot on the user\'s page, acts out what your userscript change does. Call it in the SAME message as '
      + 'your edit to userscript.user.js, before it. It plays once the script is installed and the page reloaded, so the change is '
      + 'visible. No approval needed; returns "ok". Actions: vacuum (removing an element), erase (hiding something), paint (colours), '
      + 'spray (gradients, filters), polish (borders, radius, shadows), font (typography), write (text content), build (layout, '
      + 'spacing), measure (sizes), add (a new element), wire (event handlers), hack (network, data, logic), watch (observers, '
      + 'timers), dance (animations), photo (images, icons), stash (storage), search (investigating), tinker (anything else).',
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
                description: 'Where the change shows up: selector (CSS) and/or text (visible text).',
                properties: { selector: { type: 'string' }, text: { type: 'string' } },
              },
              action: {
                type: 'string',
                enum: ['vacuum', 'erase', 'paint', 'spray', 'polish', 'font', 'write', 'build', 'measure', 'add', 'wire', 'hack',
                  'watch', 'dance', 'photo', 'stash', 'search', 'tinker'],
              },
              say: { type: 'string', description: 'Caption, 8 words or fewer, no emojis or em dashes.' },
              color: { type: 'string', description: 'New colour, for paint/spray.' },
            },
            required: ['target', 'action', 'say'],
          },
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'notify',
    description: 'Show the user a desktop notification. No approval needed.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, message: { type: 'string' } }, required: ['message'] },
  },
  {
    name: 'watch_create',
    description: 'Set up a recurring check. Every intervalSeconds (min 30) the extension reloads `url` (in a background tab, or the current tab if tab="current") and runs `code` there — the body of an async function returning a short status string or JSON. The user is notified when the status changes (notifyWhen "change", default), whenever it is truthy ("truthy"), or every run ("always"). Test the code once with page_eval first. Needs the user\'s approval (they see the code, URL and interval); afterwards it runs unattended until stopped from the sidebar.',
    inputSchema: {
      type: 'object',
      properties: {
        reason,
        name: { type: 'string' },
        url: { type: 'string' },
        intervalSeconds: { type: 'integer', minimum: 30 },
        code: { type: 'string' },
        tab: { type: 'string', enum: ['background', 'current'] },
        notifyWhen: { type: 'string', enum: ['change', 'truthy', 'always'] },
      },
      required: ['reason', 'name', 'intervalSeconds', 'code'],
    },
  },
  {
    name: 'watch_list',
    description: 'List the watches set up for this site. No approval needed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'watch_delete',
    description: 'Stop and remove a watch by id. No approval needed.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

// --- socket to host.js -------------------------------------------------------
let nextId = 1;
const waiting = new Map();
const sock = net.connect(SOCK);
sock.on('error', err => {
  for (const r of waiting.values()) r({ error: `Clawdify bridge unavailable: ${err.message}` });
  waiting.clear();
});
readline.createInterface({ input: sock }).on('line', line => {
  let res;
  try { res = JSON.parse(line); } catch { return; }
  const r = waiting.get(res.id);
  if (r) { waiting.delete(res.id); r(res); }
});

function call(tool, args) {
  return new Promise(resolve => {
    const id = nextId++;
    waiting.set(id, resolve);
    sock.write(`${JSON.stringify({ id, tool, args })}\n`);
  });
}

// --- MCP over stdio (newline-delimited JSON-RPC) -----------------------------
const send = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id == null) return; // notifications (e.g. notifications/initialized)
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'clawdify', version: '1.0.0' },
      },
    });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const res = await call(params.name, params.arguments || {});
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: res.error ? String(res.error) : String(res.text == null ? '' : res.text) }],
        isError: !!res.error,
      },
    });
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
