#!/usr/bin/env node
/*
 * Live Clawd's MCP server (stdio), started by Claude Code for every session with the
 * plugin. It gives Claude the `clawd` tool, and the instructions for it (sent at
 * initialize, so they reach the system prompt without touching anyone's CLAUDE.md).
 * Claude calls it in the same message as a UI edit to say where on the page the change
 * shows up and how Clawd should act it out.
 *
 * It's also where the localhost bridge runs (bridge.mjs): each session's server takes
 * the port over if nobody else serves it.
 *
 * A call waits briefly (≤1.2s) for the browser to confirm it has the choreography - and
 * has taken "before" pictures of what's about to change - so Clawd acts before hot reload
 * lands. Purely cosmetic: it answers "ok", or "off: <why>" so Claude backs off a while.
 */
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { keepLeading, postEvent } from './bridge.mjs';

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

const INSTRUCTIONS = `Clawd is a cosmetic mascot in the user's browser who acts out your edits on their open localhost dev page.
When an edit changes what a locally served web app looks like or does on screen, include one \`clawd\` tool call in the SAME message as the edit, placed before it - never in a message of its own. Give steps naming where the change shows up (React component, selector, visible text, or {selector, x, y} fractions for things drawn on a canvas), an action from the tool's list, and a caption of 8 words or fewer with no emojis or em dashes.
Skip it for non-UI work and inside subagents. If it returns "off: ...", skip it for your next ~10 UI edits, then try once more.
It must never influence what you build; never mention Clawd in replies, code or commits.`;

const TOOL = {
  name: 'clawd',
  description: 'Cosmetic: animates Clawd on the user\'s open localhost dev page to show what your UI edit does. '
    + 'Call it in the SAME message as the edit, before it. Returns "ok", or "off: <why>" (then skip it for a while, as it says). '
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
            say: { type: 'string', description: 'Caption, 8 words or fewer, no emojis or em dashes.' },
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

const OFF_BROWSER = 'off: the Live Clawd browser extension isn\'t connected. Skip clawd for your next ~10 UI edits, then try once more.';
const NO_SERVER = 'off: no dev server for this project is listening on localhost. '
  + 'Skip clawd for your next ~10 UI edits, then try once more. Don\'t start one for Clawd\'s sake.';

let tmux;
/** "3 claude": this session's tmux window index and name, if it runs in tmux. */
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

async function clawd(args) {
  const status = await postEvent({
    clawd: true,
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    tmux: tmuxWindow(),
    pane: (process.env.TMUX_PANE || '').replace(/[^%0-9]/g, ''),
    steps: Array.isArray(args.steps) ? args.steps.slice(0, 6) : [],
    ackId: `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  });
  if (status === 'off-browser') return OFF_BROWSER;
  if (status === 'no-server') return NO_SERVER;
  return 'ok'; // played, or the dev page just isn't the visible tab right now
}

keepLeading();

const send = obj => process.stdout.write(`${JSON.stringify(obj)}\n`);
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = req;
  if (id == null) return;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'clawd', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      },
    });
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
