#!/usr/bin/env node
/*
 * Claude Code hook for Live Clawd (async, so it never holds Claude up): passes the hook's
 * JSON to the bridge, with the tmux window and pane it ran in, so Clawd can act it out.
 * Prints nothing and always exits 0. CLAWD_LIVE=0 turns it off for a session.
 */
import { execFileSync } from 'node:child_process';
import { postEvent } from './bridge.mjs';

if (process.env.CLAWD_LIVE === '0') process.exit(0);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { if (raw.length < 1 << 20) raw += d; });
process.stdin.on('end', async () => {
  let hook;
  try { hook = JSON.parse(raw); } catch { process.exit(0); }
  let tmux = '';
  if (process.env.TMUX_PANE) {
    try {
      tmux = execFileSync('tmux', ['display-message', '-p', '-t', process.env.TMUX_PANE, '#I #W'],
        { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/[^\w .-]/g, '').trim().slice(0, 40);
    } catch { /* not in tmux after all */ }
  }
  try {
    await postEvent({ tmux, pane: (process.env.TMUX_PANE || '').replace(/[^%0-9]/g, ''), hook }, 2000);
  } catch { /* cosmetic */ }
  process.exit(0);
});
