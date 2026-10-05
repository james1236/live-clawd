#!/usr/bin/env node
/*
 * Replays a recorded Live Clawd session (see clawd-record.mjs) with zero Claude usage.
 *
 *   node bridge/clawd-replay.mjs replays/<name> [--dry-run] [--duration 120] [--speed 2]
 *        [--max-gap 3] [--max-tool 15] [--clawd-room 3] [--hooks installed|all] [--project <dir>]
 *        [--restore] [--force]
 *
 * The bridge and the extension can't tell a replay from a live session, because it feeds
 * them exactly what a live one does:
 *  - spool files in ~/.claudemonkey/live/spool, shaped like live-hook.sh's (hook events)
 *    and clawd-mcp.js's (clawd calls, with an ackId it waits ≤1.2s on, like the tool);
 *  - the same file changes at the same moments, so Vite hot-reloads the same way and
 *    the bridge's git-based diff (scanChanges) sees the same edits;
 *  - a transcript that grows as playback goes, which the bridge reads for narration.
 *
 * Hook events are rebuilt from the recorded transcript: UserPromptSubmit, PreToolUse /
 * PostToolUse (each at its real time, so a long tool keeps its real duration), Stop,
 * plus - with --hooks all - events the live setup doesn't send yet: SubagentStart /
 * SubagentStop, PreCompact (a real compact boundary, or a recorded "marker"), and
 * BackgroundTaskStop (synthetic: a run_in_background command finishing, with its exit
 * code). PostToolUse carries tool_response {is_error, exit_code} for pass/fail reactions.
 *
 * Timing: --max-gap caps idle gaps (Claude thinking, the user reading). A gap while a tool
 * is running is never capped that way - its duration is what timers and dozing show - but
 * --max-tool shrinks a long tool to that many seconds, scaling everything inside it, so it
 * stays the longest stretch without dominating. --speed then divides everything, or
 * --duration picks the speed that makes the whole replay that many seconds. However fast it
 * plays, a clawd call is never followed sooner than --clawd-room seconds (default 3) per
 * step it had - the overlay plays every step in full, ~2.6s plus walking, so a squeezed
 * replay would otherwise stack Clawd's animations up. Without options, timing is exactly
 * as recorded. Before a replay that starts from the same base again,
 * reload the extension: the bridge remembers each file's last content and would diff
 * against the previous run's end state.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const expand = p => p && path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
const REC = expand(args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')));
if (!REC || !fs.existsSync(path.join(REC, 'meta.json'))) {
  console.error('usage: clawd-replay.mjs <recording dir> [--dry-run] [--speed N] [--max-gap S] [--hooks installed|all] [--project dir] [--restore] [--force]');
  process.exit(2);
}
const MAX_GAP = opt('max-gap') != null ? +opt('max-gap') * 1000 : Infinity;
const MAX_TOOL = opt('max-tool') != null ? +opt('max-tool') * 1000 : Infinity;
const DURATION = opt('duration') != null ? +opt('duration') * 1000 : null;
let SPEED = +opt('speed', 1);
const CLAWD_ROOM = +opt('clawd-room', 3) * 1000;
const HOOKS = opt('hooks', 'installed');
const DRY = flag('dry-run');

const meta = JSON.parse(fs.readFileSync(path.join(REC, 'meta.json'), 'utf8'));
const PROJECT = expand(opt('project')) || meta.project;
const LIVE_DIR = path.join(os.homedir(), '.claudemonkey', 'live');
const SPOOL_DIR = path.join(LIVE_DIR, 'spool');
const ACK_DIR = path.join(LIVE_DIR, 'acks');
const ACK_WAIT_MS = 1200;
const INSTALLED = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd']);
const readJsonl = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

// --- What the recording holds ---
const transcript = readJsonl(path.join(REC, 'transcript.jsonl'));
const recEvents = readJsonl(path.join(REC, 'events.jsonl'));
// files.jsonl (rebuilt from the transcript) wins over the watcher's own file events when present.
const fileEvents = fs.existsSync(path.join(REC, 'files.jsonl'))
  ? readJsonl(path.join(REC, 'files.jsonl'))
  : recEvents.filter(e => e.kind === 'file');
// The live session's tmux window/pane, from a spool file the recorder caught.
const sample = recEvents.find(e => e.kind === 'spool' && e.content)?.content || {};
const TMUX = opt('tmux', sample.tmux || '');
const PANE = opt('pane', sample.pane || meta.tmuxPane || '');
const SESSION_ID = transcript.find(o => o.sessionId)?.sessionId || 'replay';

const contentOf = o => (Array.isArray(o.message?.content) ? o.message.content : []);
const textOf = o => (typeof o.message?.content === 'string' ? o.message.content
  : contentOf(o).filter(c => c.type === 'text').map(c => c.text).join('\n'));

/** Build the timeline: [{t, type, ...}] in original wall-clock ms. */
function buildTimeline() {
  const tl = [];
  const tools = new Map(); // tool_use_id -> {name, input, t}
  const startedBg = new Set();
  for (const o of transcript) {
    const t = Date.parse(o.timestamp);
    if (!t) continue;
    if (o.type === 'user' && !o.isMeta && !o.toolUseResult) {
      const text = textOf(o).trim();
      if (text && !text.startsWith('<') && !/^Another Claude session sent a message/.test(text) && !contentOf(o).some(c => c.type === 'tool_result')) {
        tl.push({ t, type: 'hook', event: 'UserPromptSubmit', extra: { prompt: text } });
      }
    }
    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      tl.push({ t, type: 'hook', event: 'PreCompact', extra: { trigger: o.compactMetadata?.trigger || 'auto', custom_instructions: '' } });
    }
    if (o.type === 'queue-operation' && o.operation === 'enqueue' && /<task-notification>/.test(o.content || '')) {
      const id = (o.content.match(/<tool-use-id>([^<]+)/) || [])[1];
      const tool = tools.get(id);
      if (tool && !startedBg.has(`done:${id}`)) {
        startedBg.add(`done:${id}`);
        const exit = +((o.content.match(/exit code (\d+)/) || [])[1] ?? 0);
        const status = (o.content.match(/<status>([^<]+)/) || [])[1] || 'completed';
        if (tool.name === 'Agent') {
          tl.push({ t, type: 'hook', event: 'SubagentStop', extra: { agent_type: tool.input.subagent_type || 'general-purpose', agent_id: (o.content.match(/<task-id>([^<]+)/) || [])[1] || '', stop_hook_active: false } });
        } else {
          tl.push({ t, type: 'hook', event: 'BackgroundTaskStop', extra: { tool_name: tool.name, tool_input: tool.input, status, exit_code: exit } });
        }
      }
    }
    for (const c of contentOf(o)) {
      if (o.type === 'assistant' && c.type === 'tool_use') {
        tools.set(c.id, { name: c.name, input: c.input || {}, t });
        if (c.name === 'mcp__clawd__clawd') tl.push({ t, type: 'clawd', steps: (c.input?.steps || []).slice(0, 6), id: c.id });
        tl.push({ t, type: 'hook', event: 'PreToolUse', toolId: c.id, extra: { tool_name: c.name, tool_input: c.input || {}, tool_use_id: c.id } });
        if (c.name === 'Agent') {
          tl.push({ t, type: 'hook', event: 'SubagentStart', extra: { agent_type: c.input?.subagent_type || 'general-purpose' } });
        }
      }
      if (o.type === 'user' && c.type === 'tool_result' && tools.has(c.tool_use_id)) {
        const tool = tools.get(c.tool_use_id);
        const out = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : '');
        const exit = c.is_error ? +((out.match(/Exit code (\d+)/) || [])[1] ?? 1) : 0;
        tl.push({
          t, type: 'hook', event: 'PostToolUse', toolId: c.tool_use_id,
          extra: { tool_name: tool.name, tool_input: tool.input, tool_use_id: c.tool_use_id, tool_response: { is_error: !!c.is_error, exit_code: exit, output: out.slice(0, 2000) } },
        });
      }
    }
    if (o.type === 'assistant' && o.message?.stop_reason === 'end_turn') {
      // Stop fires once per turn: a later end_turn in the same turn replaces the earlier one.
      const prompt = tl.findLastIndex(e => e.event === 'UserPromptSubmit');
      const prev = tl.findLastIndex(e => e.event === 'Stop');
      if (prev > prompt) tl.splice(prev, 1);
      tl.push({ t: t + 1, type: 'hook', event: 'Stop', extra: { stop_hook_active: false } });
    }
  }
  for (const e of recEvents) {
    if (e.kind === 'marker' && e.event) tl.push({ t: e.t, type: 'hook', event: e.event, extra: { trigger: e.trigger || 'manual', custom_instructions: '' }, marker: true });
  }
  for (const e of fileEvents) tl.push({ t: e.t, type: 'file', path: e.path, blob: e.blob });
  // Stable order; at equal times a clawd call goes before the hook/edit it precedes live.
  const rank = { clawd: 0, hook: 1, file: 2 };
  tl.sort((a, b) => a.t - b.t || rank[a.type] - rank[b.type]);
  // Only the recorded window, not the session before the recorder started.
  const from = meta.startedAt - 1000;
  const to = Math.max(meta.stoppedAt || 0, ...fileEvents.map(e => e.t), ...recEvents.map(e => e.t)) + 1000;
  return tl.filter(e => e.t >= from && e.t <= to && (e.type !== 'hook' || HOOKS === 'all' || INSTALLED.has(e.event)));
}

/**
 * Playback offsets (ms from start). Idle gaps are capped at --max-gap; inside a running
 * tool, gaps are scaled so the tool lasts at most --max-tool; then --speed (or the speed
 * --duration implies) divides everything.
 */
function schedule(tl) {
  // Each tool's real duration, from its PreToolUse to its PostToolUse.
  const span = new Map();
  for (const e of tl) {
    if (e.event === 'PreToolUse') span.set(e.toolId, { from: e.t });
    if (e.event === 'PostToolUse' && span.has(e.toolId)) span.get(e.toolId).to = e.t;
  }
  const running = new Map(); // toolId -> scale for gaps inside it
  const gaps = [];
  let at = 0;
  let prev = tl.length ? tl[0].t : 0;
  for (const e of tl) {
    let gap = Math.max(0, e.t - prev);
    if (!running.size) gap = Math.min(gap, MAX_GAP);
    else gap *= Math.min(...running.values());
    gaps.push(gap);
    prev = e.t;
    if (e.event === 'PreToolUse') {
      const s = span.get(e.toolId);
      const d = s && s.to ? s.to - s.from : 0;
      running.set(e.toolId, d > MAX_TOOL ? MAX_TOOL / d : 1);
    }
    if (e.event === 'PostToolUse') running.delete(e.toolId);
  }
  // Apply a speed, then hold everything after a clawd call back until it has had its room.
  const place = speed => {
    let t = 0;
    let free = 0;
    for (let i = 0; i < tl.length; i++) {
      t += gaps[i] / speed;
      if (tl[i].type === 'clawd') {
        t = Math.max(t, free);
        free = t + CLAWD_ROOM * tl[i].steps.length;
      }
      tl[i].at = Math.round(t);
    }
    return t;
  };
  if (DURATION) {
    // Total time falls as speed rises (the clawd floor makes it non-linear): bisect.
    let lo = 0.01;
    let hi = 1000;
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      if (place(mid) > DURATION) lo = mid; else hi = mid;
    }
    SPEED = hi;
    if (place(hi) > DURATION * 1.02) console.warn(`can't reach ${DURATION / 1000}s: the clawd room alone needs more; lower --clawd-room`);
  }
  place(SPEED);
  return tl;
}

const fmt = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
function describe(e) {
  if (e.type === 'clawd') return `CLAWD  ${e.steps.map(s => `${s.action} "${s.say}"`).join(' | ')}`;
  if (e.type === 'file') return `FILE   ${e.path}${e.blob ? '' : ' (deleted)'}`;
  const x = e.extra || {};
  const tool = x.tool_name ? ` ${x.tool_name}${x.tool_input?.command ? `: ${String(x.tool_input.command).split('\n')[0].slice(0, 60)}` : ''}` : '';
  const res = e.event === 'PostToolUse' && x.tool_response?.is_error ? ` [exit ${x.tool_response.exit_code}]` : '';
  return `HOOK   ${e.event}${tool}${res}${e.event === 'UserPromptSubmit' ? `: ${x.prompt.replace(/\s+/g, ' ').slice(0, 60)}` : ''}${e.marker ? ' (recorded marker)' : ''}`;
}

// --- Playback ---
const sleep = ms => new Promise(r => setTimeout(r, ms));
function spool(obj) {
  fs.mkdirSync(SPOOL_DIR, { recursive: true });
  const f = path.join(SPOOL_DIR, `${process.hrtime.bigint()}-${process.pid}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  fs.renameSync(`${f}.tmp`, f);
}
async function waitAck(ackId) {
  const p = path.join(ACK_DIR, ackId);
  for (const end = Date.now() + ACK_WAIT_MS; Date.now() < end;) {
    if (fs.existsSync(p)) {
      let s = '';
      try { s = fs.readFileSync(p, 'utf8'); fs.unlinkSync(p); } catch { /* raced */ }
      return s || 'played';
    }
    await sleep(40);
  }
  return 'timeout';
}
const blobText = h => fs.readFileSync(path.join(REC, 'blobs', h), 'utf8');
const touched = [...new Set(fileEvents.map(e => e.path))];
const sha = text => crypto.createHash('sha1').update(text).digest('hex');
const current = f => { try { return sha(fs.readFileSync(path.join(PROJECT, f), 'utf8')); } catch { return null; } };
function writeVersion(f, h) {
  const p = path.join(PROJECT, f);
  if (h == null) { try { fs.unlinkSync(p); } catch { /* gone */ } return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, blobText(h));
}

async function main() {
  const tl = schedule(buildTimeline());
  const clawds = tl.filter(e => e.type === 'clawd').length;
  const files = tl.filter(e => e.type === 'file').length;
  console.log(`${path.basename(REC)}: ${tl.length} events (${clawds} clawd, ${files} file writes), ${fmt(tl.at(-1)?.at || 0)} at speed ${+SPEED.toFixed(2)}${MAX_GAP < Infinity ? `, max-gap ${MAX_GAP / 1000}s` : ''}${MAX_TOOL < Infinity ? `, max-tool ${MAX_TOOL / 1000}s` : ''}, hooks: ${HOOKS}`);
  console.log(`project ${PROJECT}  tmux "${TMUX}" pane ${PANE || '(none)'}`);
  if (DRY) {
    for (const e of tl) console.log(fmt(e.at), describe(e));
    return;
  }

  // Preflight: the project must be at the recording's base or its end state, file by file.
  const head = execFileSync('git', ['-C', PROJECT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== meta.baseCommit && !flag('force')) throw new Error(`${PROJECT} is at ${head.slice(0, 7)}, the recording's base is ${meta.baseCommit.slice(0, 7)} (--force to play anyway)`);
  const known = f => [meta.base[f] ?? null, ...fileEvents.filter(e => e.path === f).map(e => e.blob)];
  const stray = touched.filter(f => !known(f).includes(current(f)));
  if (stray.length && !flag('force')) throw new Error(`these files hold changes that aren't the recording's (--force overwrites them):\n  ${stray.join('\n  ')}`);
  let alive = false;
  try { alive = Date.now() - fs.statSync(path.join(LIVE_DIR, 'alive')).mtimeMs < 20000; } catch { /* no bridge */ }
  if (!alive) console.warn('warning: Firefox/Clawdify isn\'t listening (~/.claudemonkey/live/alive is stale) - events will be dropped');

  // Start from the base, then let hot reload settle before the first event.
  for (const f of touched) writeVersion(f, meta.base[f] ?? null);
  const fakeTranscript = path.join(LIVE_DIR, '..', 'replay', `${path.basename(REC)}.jsonl`);
  fs.mkdirSync(path.dirname(fakeTranscript), { recursive: true });
  fs.writeFileSync(fakeTranscript, '');
  let written = 0;
  const growTranscript = upTo => {
    let chunk = '';
    while (written < transcript.length && !(Date.parse(transcript[written].timestamp) > upTo)) chunk += `${JSON.stringify(transcript[written++])}\n`;
    if (chunk) fs.appendFileSync(fakeTranscript, chunk);
  };
  growTranscript(tl[0]?.t - 1);
  console.log('reset to base; starting in 2s');
  await sleep(2000);

  const t0 = Date.now();
  let pendingAck = null; // a clawd call's ack wait: the edit after it waits too, as live
  for (const e of tl) {
    const wait = t0 + e.at - Date.now();
    if (wait > 0) await sleep(wait);
    growTranscript(e.t);
    if (e.type === 'clawd') {
      const ackId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      spool({ clawd: true, cwd: PROJECT, tmux: TMUX, pane: PANE, steps: e.steps, ackId });
      pendingAck = waitAck(ackId).then(s => { console.log(`${fmt(Date.now() - t0)}        ack: ${s}`); pendingAck = null; });
    } else if (e.type === 'file') {
      if (pendingAck) await pendingAck;
      writeVersion(e.path, e.blob);
    } else {
      if (e.event === 'PreToolUse' && pendingAck) await pendingAck;
      spool({ tmux: TMUX, pane: PANE.replace(/[^%0-9]/g, ''), hook: { session_id: SESSION_ID, transcript_path: fakeTranscript, cwd: PROJECT, permission_mode: 'default', hook_event_name: e.event, ...e.extra } });
    }
    console.log(fmt(Date.now() - t0), describe(e));
  }
  if (pendingAck) await pendingAck;
  spool({ tmux: TMUX, pane: PANE.replace(/[^%0-9]/g, ''), hook: { session_id: SESSION_ID, transcript_path: fakeTranscript, cwd: PROJECT, hook_event_name: 'SessionEnd', reason: 'other' } });
  if (flag('restore')) {
    await sleep(1500);
    for (const f of touched) writeVersion(f, meta.base[f] ?? null);
    console.log('restored base');
  }
  console.log(`done in ${fmt(Date.now() - t0)}`);
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
