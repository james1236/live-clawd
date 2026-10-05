#!/usr/bin/env node
/*
 * Replays a recorded Live Clawd session (see clawd-record.mjs) with zero Claude usage.
 *
 *   node tools/clawd-replay.mjs replays/<name> [--dry-run] [--duration 180] [--speed 2]
 *        [--max-gap 1.5] [--max-tool 12] [--long-tool 22] [--long-gap 25 [--long-gaps 2]]
 *        [--compact 8] [--clawd-room 3] [--hooks installed|all] [--project <dir>] [--restore] [--force]
 *
 * The bridge and the extension can't tell a replay from a live session, because it feeds
 * them exactly what a live one does:
 *  - hook events posted to the bridge (plugin/server/bridge.mjs), as plugin/server/hook.mjs does
 *    and clawd-mcp.js's (clawd calls, with an ackId it waits ≤1.2s on, like the tool);
 *  - the same file changes at the same moments, so Vite hot-reloads the same way and
 *    the bridge's git-based diff (scanChanges) sees the same edits;
 *  - a transcript that grows as playback goes, which the bridge reads for narration.
 *
 * Hook events are rebuilt from the recorded transcript, shaped as Claude Code sends them:
 * UserPromptSubmit, PreToolUse, PostToolUse / PostToolUseFailure (each at its real time, so
 * a long tool keeps its real duration), SubagentStart / SubagentStop (paired by agent_id; a
 * background agent stops at its task notification), PreCompact / PostCompact (a real compact
 * boundary, or a recorded "marker" - moved to just after the tool that wrote it), and Stop.
 * By default only the events the plugin's hooks/hooks.json lists are sent, as live;
 * --hooks all sends every one.
 *
 * Timing: --max-gap caps idle gaps (Claude thinking, the user reading). A gap while a tool
 * is running is never capped that way - its duration is what timers and dozing show - but
 * --max-tool shrinks a long tool to that many seconds, scaling everything inside it, so it
 * stays the longest stretch without dominating. --speed then divides everything, or
 * --duration picks the speed that makes the whole replay that many seconds. Two floors keep
 * the overlay's slow animations reachable: a tool that really ran for at least --long-tool
 * seconds plays for at least that long (it sits down with a book or knitting at 20s; a
 * subagent's trip gets the same), a compaction plays for at least --compact (8s), and
 * the --long-gaps longest mid-turn pauses play for --long-gap seconds (water break and
 * bottle toss after 9-18s between steps, the chalkboard after 12s). However fast it
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
import { lead, PORT, postEvent } from '../plugin/server/bridge.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const expand = p => p && path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
const REC = expand(args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')));
if (!REC || !fs.existsSync(path.join(REC, 'meta.json'))) {
  console.error('usage: clawd-replay.mjs <recording dir> [options] - see the header comment');
  process.exit(2);
}
const MAX_GAP = opt('max-gap') != null ? +opt('max-gap') * 1000 : Infinity;
const MAX_TOOL = opt('max-tool') != null ? +opt('max-tool') * 1000 : Infinity;
const DURATION = opt('duration') != null ? +opt('duration') * 1000 : null;
let SPEED = +opt('speed', 1);
const CLAWD_ROOM = +opt('clawd-room', 3) * 1000;
const LONG_TOOL = opt('long-tool') != null ? +opt('long-tool') * 1000 : null;
const LONG_GAP = opt('long-gap') != null ? +opt('long-gap') * 1000 : null;
const LONG_GAPS = +opt('long-gaps', 2);
const COMPACT_MS = +opt('compact', 8) * 1000;
const HOOKS = opt('hooks', 'installed');
const DRY = flag('dry-run');

const meta = JSON.parse(fs.readFileSync(path.join(REC, 'meta.json'), 'utf8'));
const PROJECT = expand(opt('project')) || meta.project;
/** Hook events the live setup really sends: the ones the plugin's hooks.json lists. */
function installedHooks() {
  const f = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'plugin', 'hooks', 'hooks.json');
  return new Set(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).hooks));
}
const INSTALLED = installedHooks();
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

const OPENS = new Set(['PreToolUse', 'SubagentStart', 'PreCompact']);
const CLOSES = new Set(['PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'PostCompact']);
/** Which span (a held tool, a subagent's trip, a compaction) an opening/closing event belongs to. */
const spanKey = e => (/ToolUse/.test(e.event) ? `tool:${e.toolId}`
  : /Subagent/.test(e.event) ? `agent:${e.extra.agent_id}` : /Compact/.test(e.event) ? 'compact' : null);

/**
 * Build the timeline: [{t, type, ...}] in original wall-clock ms, with every hook event
 * shaped as Claude Code sends it (and the plugin's hook passes it on).
 */
function buildTimeline() {
  const tl = [];
  const tools = new Map(); // tool_use_id -> {name, input, t, start (SubagentStart event)}
  const done = new Set();
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
    // A background agent finishing arrives as a queued task notification, not a tool result.
    if (o.type === 'queue-operation' && o.operation === 'enqueue' && /<task-notification>/.test(o.content || '')) {
      const id = (o.content.match(/<tool-use-id>([^<]+)/) || [])[1];
      const tool = tools.get(id);
      if (tool && tool.start && !done.has(id)) {
        done.add(id);
        tl.push({ t, type: 'hook', event: 'SubagentStop', extra: { agent_id: tool.start.extra.agent_id, agent_type: tool.start.extra.agent_type, stop_hook_active: false } });
      }
    }
    for (const c of contentOf(o)) {
      if (o.type === 'assistant' && c.type === 'tool_use') {
        const tool = { name: c.name, input: c.input || {}, t };
        tools.set(c.id, tool);
        if (c.name === 'mcp__clawd__clawd') tl.push({ t, type: 'clawd', steps: (c.input?.steps || []).slice(0, 6), id: c.id });
        tl.push({ t, type: 'hook', event: 'PreToolUse', toolId: c.id, extra: { tool_name: c.name, tool_input: c.input || {}, tool_use_id: c.id } });
        if (c.name === 'Agent' || c.name === 'Task') {
          tool.start = { t, type: 'hook', event: 'SubagentStart', extra: { agent_id: c.id, agent_type: c.input?.subagent_type || 'general-purpose' } };
          tl.push(tool.start);
        }
      }
      if (o.type === 'user' && c.type === 'tool_result' && tools.has(c.tool_use_id)) {
        const tool = tools.get(c.tool_use_id);
        const out = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : '');
        const base = { tool_name: tool.name, tool_input: tool.input, tool_use_id: c.tool_use_id };
        if (c.is_error) {
          tl.push({ t, type: 'hook', event: 'PostToolUseFailure', toolId: c.tool_use_id, extra: { ...base, error: out.slice(0, 2000), is_interrupt: false } });
        } else {
          const response = tool.name === 'Bash' ? { stdout: out.slice(-4000), stderr: '', interrupted: false, isImage: false } : { content: out.slice(0, 2000) };
          tl.push({ t, type: 'hook', event: 'PostToolUse', toolId: c.tool_use_id, extra: { ...base, tool_response: response } });
        }
        if (tool.start) {
          // A background agent's result only says it launched (it reports back later);
          // a foreground one's result IS its report.
          const bgId = (out.match(/agentId: (\w+)/) || [])[1];
          if (bgId) tool.start.extra.agent_id = bgId;
          else if (!done.has(c.tool_use_id)) {
            done.add(c.tool_use_id);
            tl.push({ t, type: 'hook', event: 'SubagentStop', extra: { ...tool.start.extra, stop_hook_active: false } });
          }
        }
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
  const sort = () => tl.sort((a, b) => a.t - b.t || rank[a.type] - rank[b.type]);
  sort();
  // A compaction happens between tool calls, never during one: a recorded marker (written
  // by a tool) moves to just after that tool. It lasts until the next thing happens.
  for (const pre of tl.filter(e => e.event === 'PreCompact')) {
    const i = tl.indexOf(pre);
    const open = tl.slice(0, i).filter(e => e.event === 'PreToolUse' && !tl.slice(0, i).some(x => CLOSES.has(x.event) && x.toolId === e.toolId));
    const ends = open.map(o => tl.find(x => CLOSES.has(x.event) && x.toolId === o.toolId)).filter(Boolean);
    if (ends.length) pre.t = Math.max(...ends.map(x => x.t)) + 1;
    sort();
    const next = tl.find(x => x.t > pre.t && x !== pre);
    tl.push({ t: next ? Math.max(pre.t + 500, next.t - 1) : pre.t + 3000, type: 'hook', event: 'PostCompact', extra: { trigger: pre.extra.trigger } });
    sort();
  }
  // Only the recorded window, not the session before the recorder started.
  const from = meta.startedAt - 1000;
  const to = Math.max(meta.stoppedAt || 0, ...fileEvents.map(e => e.t), ...recEvents.map(e => e.t)) + 1000;
  return tl.filter(e => e.t >= from && e.t <= to && (e.type !== 'hook' || HOOKS === 'all' || INSTALLED.has(e.event)));
}

/**
 * Playback offsets (ms from start). Idle gaps are capped at --max-gap. Inside a span (a
 * held tool, a subagent's trip, a compaction) gaps are scaled so the span lasts at most
 * --max-tool. Then --speed (or the speed --duration implies) divides everything, a clawd
 * call gets --clawd-room per step before the next event, and a tool that really ran for
 * at least --long-tool seconds plays for at least that long.
 */
function schedule(tl) {
  const span = new Map(); // key -> {from, to}
  for (const e of tl) {
    const k = spanKey(e);
    if (k && OPENS.has(e.event) && !span.has(k)) span.set(k, { from: e.t });
    if (k && CLOSES.has(e.event) && span.has(k)) span.get(k).to ??= e.t;
  }
  const realDur = k => { const s = span.get(k); return s && s.to != null ? s.to - s.from : 0; };
  const running = new Map(); // key -> scale for gaps inside it
  const gaps = [];
  const busyIdle = []; // [index, real gap]: nothing running, mid-turn (Claude thinking)
  let busy = false;
  let prev = tl.length ? tl[0].t : 0;
  for (const [i, e] of tl.entries()) {
    const real = Math.max(0, e.t - prev);
    let gap = real;
    if (!running.size) { gap = Math.min(gap, MAX_GAP); if (busy) busyIdle.push([i, real]); } else gap *= Math.min(...running.values());
    gaps.push(gap);
    prev = e.t;
    if (e.event === 'UserPromptSubmit') busy = true;
    if (e.event === 'Stop') busy = false;
    const k = spanKey(e);
    if (k && OPENS.has(e.event)) { const d = realDur(k); running.set(k, d > MAX_TOOL ? MAX_TOOL / d : 1); }
    if (k && CLOSES.has(e.event)) running.delete(k);
  }
  // The longest mid-turn pauses play for --long-gap regardless of speed: Clawd only
  // pours a drink (and tosses the bottle) or pulls out the chalkboard between steps.
  const fixed = new Set(LONG_GAP ? busyIdle.sort((a, b) => b[1] - a[1]).slice(0, LONG_GAPS).map(([i]) => i) : []);
  const place = speed => {
    let t = 0;
    let free = 0;
    const openAt = new Map();
    for (let i = 0; i < tl.length; i++) {
      const e = tl[i];
      t += fixed.has(i) ? LONG_GAP : gaps[i] / speed;
      if (e.type === 'clawd') {
        t = Math.max(t, free);
        free = t + CLAWD_ROOM * e.steps.length;
      }
      const k = spanKey(e);
      if (k && OPENS.has(e.event)) openAt.set(k, t);
      if (k && CLOSES.has(e.event) && openAt.has(k)) {
        // A long tool or subagent trip keeps --long-tool; a compaction always gets --compact.
        if (LONG_TOOL && !k.startsWith('compact') && realDur(k) >= LONG_TOOL) t = Math.max(t, openAt.get(k) + LONG_TOOL);
        if (k === 'compact') t = Math.max(t, openAt.get(k) + COMPACT_MS);
      }
      e.at = Math.round(t);
    }
    return t;
  };
  if (DURATION) {
    // Total time falls as speed rises (the floors make it non-linear): bisect.
    let lo = 0.01;
    let hi = 1000;
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      if (place(mid) > DURATION) lo = mid; else hi = mid;
    }
    SPEED = hi;
    if (place(hi) > DURATION * 1.02) console.warn(`can't reach ${DURATION / 1000}s: the clawd room and long tools alone need more`);
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
  const res = e.event === 'PostToolUseFailure' ? ` [${(String(x.error).match(/Exit code \d+/) || ['failed'])[0]}]` : '';
  return `HOOK   ${e.event}${tool}${res}${e.event === 'UserPromptSubmit' ? `: ${x.prompt.replace(/\s+/g, ' ').slice(0, 60)}` : ''}${e.marker ? ' (recorded marker)' : ''}`;
}

// --- Playback ---
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Hand an event to the bridge, as a hook or the `clawd` tool would; resolves with its status. */
const send = obj => postEvent(obj);
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
  console.log(`${path.basename(REC)}: ${tl.length} events (${clawds} clawd, ${files} file writes), ${fmt(tl.at(-1)?.at || 0)} at speed ${+SPEED.toFixed(2)}${MAX_GAP < Infinity ? `, max-gap ${MAX_GAP / 1000}s` : ''}${MAX_TOOL < Infinity ? `, max-tool ${MAX_TOOL / 1000}s` : ''}${LONG_TOOL ? `, long-tool ${LONG_TOOL / 1000}s` : ''}, hooks: ${HOOKS}`);
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
  // Serve the bridge ourselves if no Claude session does, then wait a moment for the browser.
  if (await lead()) console.log(`serving the bridge on 127.0.0.1:${PORT}`);
  await sleep(2500);
  let browsers = 0;
  try { browsers = (await (await fetch(`http://127.0.0.1:${PORT}/status`, { headers: { 'x-clawd': '1' } })).json()).browsers; } catch { /* ours */ }
  if (!browsers) console.warn('warning: no browser with the Live Clawd extension is connected - events will be dropped');

  // Start from the base, then let hot reload settle before the first event.
  for (const f of touched) writeVersion(f, meta.base[f] ?? null);
  const fakeTranscript = path.join(os.tmpdir(), 'live-clawd-replay', `${path.basename(REC)}.jsonl`);
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
      pendingAck = send({ clawd: true, cwd: PROJECT, tmux: TMUX, pane: PANE, steps: e.steps, ackId }).then(s => { console.log(`${fmt(Date.now() - t0)}        ack: ${s}`); pendingAck = null; });
    } else if (e.type === 'file') {
      if (pendingAck) await pendingAck;
      writeVersion(e.path, e.blob);
    } else {
      if (e.event === 'PreToolUse' && pendingAck) await pendingAck;
      await send({ tmux: TMUX, pane: PANE.replace(/[^%0-9]/g, ''), hook: { session_id: SESSION_ID, transcript_path: fakeTranscript, cwd: PROJECT, permission_mode: 'default', hook_event_name: e.event, ...e.extra } });
    }
    console.log(fmt(Date.now() - t0), describe(e));
  }
  if (pendingAck) await pendingAck;
  await send({ tmux: TMUX, pane: PANE.replace(/[^%0-9]/g, ''), hook: { session_id: SESSION_ID, transcript_path: fakeTranscript, cwd: PROJECT, hook_event_name: 'SessionEnd', reason: 'other' } });
  process.exit(0); // (stop serving the bridge, if we were)
  if (flag('restore')) {
    await sleep(1500);
    for (const f of touched) writeVersion(f, meta.base[f] ?? null);
    console.log('restored base');
  }
  console.log(`done in ${fmt(Date.now() - t0)}`);
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
