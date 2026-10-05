#!/usr/bin/env node
/*
 * Records a Live Clawd session so clawd-replay.mjs can play it back with zero Claude usage.
 *
 *   node tools/clawd-record.mjs --project ~/test/clawd_microEDA --out replays/<name>
 *   (run it in a tmux window; Ctrl-C stops it and copies the session transcript in)
 *
 * What it captures, each with a wall-clock ms timestamp in <out>/events.jsonl:
 *  - file: every version of every source file in the project (full content, stored once
 *    per hash in <out>/blobs/), plus the starting contents and base commit — the code
 *    at every point, however it was edited (Edit, sed, python, git checkout…).
 * Hook events and clawd calls come from the session transcript, which Ctrl-C copies in.
 *
 *   node tools/clawd-record.mjs --finish --out replays/<name> [--transcript <session.jsonl>]
 * redoes that copy (the session transcript and its subagents/ transcripts, trimmed to the
 * recording). The transcript is the one the recorded hook events name, else the newest.
 *
 *   node tools/clawd-record.mjs --rebuild --out replays/<name>
 * recovers the code at every point when the file watcher missed it: re-runs every Bash
 * command in transcript.jsonl that edited the project (sed -i, python heredocs, git
 * checkout of a file), in order, on a scratch clone at the base commit, and writes each
 * resulting file version to <out>/files.jsonl at that command's result time. Fails unless
 * the rebuilt end state matches the project's working tree exactly.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const expand = p => p && path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));
const OUT = expand(opt('out'));
if (!OUT) { console.error('--out <dir> required'); process.exit(2); }

// Same set the bridge's scanChanges() treats as source.
const SOURCE_FILE = /\.(tsx?|jsx?|vue|svelte|astro|html?|css|scss|sass|less|styl|mdx?|json)$/i;
const IGNORE = /(^|\/)(node_modules|\.git|dist|scripts\/output|scripts\/snapshots)(\/|$)/;

if (args.includes('--finish')) finish();
else if (args.includes('--rebuild')) rebuild();
else record();

function record() {
  const project = expand(opt('project'));
  if (!project) { console.error('--project <dir> required'); process.exit(2); }
  fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });
  const log = fs.openSync(path.join(OUT, 'events.jsonl'), 'a');
  const emit = ev => fs.writeSync(log, `${JSON.stringify({ t: Date.now(), ...ev })}\n`);
  const blob = text => {
    const h = crypto.createHash('sha1').update(text).digest('hex');
    const p = path.join(OUT, 'blobs', h);
    if (!fs.existsSync(p)) fs.writeFileSync(p, text);
    return h;
  };

  const git = a => execFileSync('git', ['-C', project, ...a], { encoding: 'utf8' }).trim();
  const tracked = git(['ls-files']).split('\n').filter(f => SOURCE_FILE.test(f) && !IGNORE.test(f));
  const last = new Map();
  const base = {};
  for (const f of tracked) {
    try { const c = fs.readFileSync(path.join(project, f), 'utf8'); base[f] = blob(c); last.set(f, base[f]); } catch { /* gone */ }
  }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    project,
    baseCommit: git(['rev-parse', 'HEAD']),
    dirtyAtStart: git(['status', '--porcelain']),
    startedAt: Date.now(),
    tmuxPane: process.env.TMUX_PANE || '',
    base,
  }, null, 2));

  // Files: recursive watch, then read whatever changed. Editors write via temp+rename, so
  // re-read on every event and only record when the content really differs.
  const onFile = rel => {
    if (!rel || IGNORE.test(rel) || !SOURCE_FILE.test(rel)) return;
    let c = null;
    try { c = fs.readFileSync(path.join(project, rel), 'utf8'); } catch { /* deleted */ }
    const h = c == null ? null : blob(c);
    if (last.get(rel) === h) return;
    last.set(rel, h);
    emit({ kind: 'file', path: rel, blob: h });
    console.log(new Date().toISOString().slice(11, 23), 'file ', rel, h ? h.slice(0, 8) : 'deleted');
  };
  // Not `fs.watch(project, {recursive: true})`: on Linux Node implements that in JS by
  // walking every directory, and an `npm install` filling node_modules pegged the event
  // loop at ~90% CPU forever (no events, SIGINT ignored) - which lost the first recording.
  // Watch the root's own files plus each top-level source directory recursively instead.
  fs.watch(project, (_, f) => onFile(f && f.toString()));
  for (const d of fs.readdirSync(project, { withFileTypes: true })) {
    if (d.isDirectory() && !IGNORE.test(d.name) && !d.name.startsWith('.') && d.name !== 'public') {
      fs.watch(path.join(project, d.name), { recursive: true }, (_, f) => onFile(f && path.join(d.name, f.toString())));
    }
  }

  // (Hook events and clawd calls aren't captured here: the replay rebuilds them all from
  // the session transcript, which the stop step copies in.)

  const stop = () => {
    emit({ kind: 'stop' });
    const m = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
    m.stoppedAt = Date.now();
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(m, null, 2));
    try { finish(); } catch (e) { console.error('copying the transcript failed - rerun with --finish:', e.message); }
    console.log('stopped; recording in', OUT);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`recording ${project} (base ${tracked.length} files) -> ${OUT}`);
}

/** Copy the session transcript (and subagent transcripts), trimmed to the recording window. */
function finish() {
  const src = expand(opt('transcript')) || findTranscript();
  if (!src) throw new Error('no session transcript found; pass --transcript <session.jsonl>');
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
  const from = m.startedAt - 5 * 60e3;
  const to = (m.stoppedAt || Date.now()) + 60e3;
  const trim = (inFile, outFile) => {
    const keep = fs.readFileSync(inFile, 'utf8').split('\n').filter(l => {
      if (!l) return false;
      try { const t = Date.parse(JSON.parse(l).timestamp); return !t || (t >= from && t <= to); } catch { return false; }
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${keep.join('\n')}\n`);
    return keep.length;
  };
  console.log('transcript lines:', trim(src, path.join(OUT, 'transcript.jsonl')));
  const subDir = path.join(path.dirname(src), path.basename(src, '.jsonl'), 'subagents');
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).filter(n => n.endsWith('.jsonl'))) {
      console.log(f, trim(path.join(subDir, f), path.join(OUT, 'subagents', f)));
    }
  }
}

/** Rebuild per-step file versions by re-running the transcript's edit commands. */
function rebuild() {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
  const project = m.project;
  const home = os.homedir();
  const projTilde = project.startsWith(home) ? `~${project.slice(home.length)}` : project;
  const lines = fs.readFileSync(path.join(OUT, 'transcript.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const results = new Map();
  for (const o of lines) {
    for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (c.type === 'tool_result') results.set(c.tool_use_id, { t: Date.parse(o.timestamp), error: !!c.is_error });
    }
  }
  const EDITS = /sed -i|python3 - <<|git checkout (?!-)/;
  const cmds = [];
  for (const o of lines) {
    for (const c of Array.isArray(o.message?.content) ? o.message.content : []) {
      if (c.type !== 'tool_use' || c.name !== 'Bash') continue;
      const cmd = String(c.input?.command || '');
      const r = results.get(c.id);
      if (!r || r.error || !EDITS.test(cmd) || /\bnpm /.test(cmd)) continue;
      if (!cmd.includes(project) && !cmd.includes(projTilde)) continue;
      cmds.push({ cmd, t: r.t });
    }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-rebuild-'));
  execFileSync('git', ['clone', '-q', '--no-checkout', project, tmp]);
  execFileSync('git', ['-C', tmp, 'checkout', '-q', m.baseCommit]);
  const listSources = dir => execFileSync('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n').filter(f => f && SOURCE_FILE.test(f) && !IGNORE.test(f) && !f.endsWith('.json'));
  const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return null; } };
  const blob = text => {
    const h = crypto.createHash('sha1').update(text).digest('hex');
    const p = path.join(OUT, 'blobs', h);
    if (!fs.existsSync(p)) fs.writeFileSync(p, text);
    return h;
  };
  fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });
  const last = new Map(listSources(tmp).map(f => [f, read(tmp, f)]));
  const out = [];
  for (const { cmd, t } of cmds) {
    const local = cmd.split(project).join(tmp).split(projTilde).join(tmp);
    try { execFileSync('bash', ['-c', local], { cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
      console.warn('command failed on rebuild (kept going):', local.split('\n')[0], String(e.stderr || '').trim());
    }
    for (const f of new Set([...last.keys(), ...listSources(tmp)])) {
      const c = read(tmp, f);
      if (c === last.get(f)) continue;
      last.set(f, c);
      out.push({ t, kind: 'file', path: f, blob: c == null ? null : blob(c) });
      console.log(new Date(t).toISOString().slice(11, 23), f);
    }
  }
  fs.writeFileSync(path.join(OUT, 'files.jsonl'), out.map(e => JSON.stringify(e)).join('\n') + '\n');
  // The rebuilt end state must be exactly what the project holds now.
  const bad = [...new Set([...listSources(tmp), ...listSources(project)])].filter(f => read(tmp, f) !== read(project, f));
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad.length) { console.error('MISMATCH with the project working tree:', bad); process.exit(1); }
  console.log(`${out.length} file versions from ${cmds.length} edit commands; end state matches ${project}`);
}

/** The session transcript the recorded hook events name, else the newest one Claude Code wrote. */
function findTranscript() {
  const named = new Map();
  try {
    for (const l of fs.readFileSync(path.join(OUT, 'events.jsonl'), 'utf8').split('\n')) {
      const p = l && JSON.parse(l).content?.hook?.transcript_path;
      if (p) named.set(p, (named.get(p) || 0) + 1);
    }
  } catch { /* none */ }
  if (named.size) return [...named].sort((a, b) => b[1] - a[1])[0][0];
  const root = path.join(os.homedir(), '.claude', 'projects');
  let best = null;
  for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    for (const f of fs.readdirSync(path.join(root, d)).filter(n => n.endsWith('.jsonl'))) {
      const p = path.join(root, d, f);
      const t = fs.statSync(p).mtimeMs;
      if (!best || t > best.t) best = { p, t };
    }
  }
  return best && best.p;
}
