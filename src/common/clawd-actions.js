/**
 * Turns a Claude tool call (name + detail from the bridge) into a Clawd action: what
 * kind of change it is, which page elements it touches, and a caption. Shared by the
 * background (to tag transcript events and drive the overlay) and the overlay bundle,
 * so it must stay self-contained.
 *
 * @typedef {{kind: string, selectors: string[], pattern?: string, color?: string,
 *   measure?: string, label: string}} ClawdAction
 */

/** Change kinds found in edited code, highest priority first (ties go to the earlier). */
const KINDS = [
  ['hack', /\b(fetch\s*\(|XMLHttpRequest|WebSocket|GM_xmlhttpRequest|GM\.xmlHttpRequest|sendBeacon|EventSource)/g],
  ['stash', /\b(localStorage|sessionStorage|GM_setValue|GM_getValue|GM\.setValue|GM\.getValue|indexedDB|document\.cookie)/g],
  ['remove', /(\.remove\(\)|removeChild\(|replaceChildren\(\))/g],
  ['erase', /(display\s*[:=]\s*['"]?none|visibility\s*[:=]\s*['"]?hidden|opacity\s*[:=]\s*['"]?0(?![.\d])|\.hidden\s*=\s*true)/gi],
  ['add', /(createElement\(|insertAdjacent(HTML|Element)\(|appendChild\(|\.append\(|\.prepend\(|\.before\(|\.after\(|innerHTML\s*\+=)/g],
  ['photo', /(<img|\.src\s*=|background-image\s*:\s*url|createElement\(\s*['"]img|\bcanvas\b)/gi],
  ['dance', /(animation|transition|@keyframes|transform\s*:)/gi],
  ['watch', /\b(MutationObserver|IntersectionObserver|ResizeObserver|setInterval|requestAnimationFrame)/g],
  ['wire', /(addEventListener\(|\bon(click|key\w+|input|change|submit|scroll)\s*=|\bon[A-Z]\w*=\{|\.click\(\))/g],
  ['spray', /(linear-gradient|radial-gradient|conic-gradient|filter\s*:|backdrop-filter|mix-blend-mode)/gi],
  ['paint', /((^|[^-\w])(color|background(-color)?|backgroundColor|bgcolor|fill|stroke|accent-color|caret-color)\s*:|border(-\w+)?-color\s*:|border\w*Color\s*:|\.style\.(color|background\w*)\s*=|palette\.)/g],
  ['font', /(font(-\w+)?\s*:|font[A-Z]\w*\s*:|line-?[hH]eight\s*:|letter-?[sS]pacing\s*:|text-?[tT]ransform\s*:|text-decoration\s*:|typography|variant=["']h\d|\.style\.font\w*\s*=)/g],
  ['measure', /((^|[^-\w])((max|min)-?)?([wW]idth|[hH]eight)\s*:|\.style\.(width|height)\s*=)/g],
  ['polish', /(border(-?[rR]adius)?\s*:|box-?[sS]hadow\s*:|outline\s*:|text-?[sS]hadow\s*:|elevation=)/g],
  ['build', /((^|[^-\w])(display|position|margin\w*|padding\w*|gap|flex\w*|grid\w*|float|align-?\w+|justify-?\w+|z-?[iI]ndex|top|left|right|bottom|overflow|[mp][xytblr]?)\s*:|<(Box|Stack|Grid|Container)\b)/g],
  ['write', /(textContent\s*=|innerText\s*=|\.title\s*=|placeholder|\.value\s*=|innerHTML\s*=)/g],
];

const VERB = {
  think: 'Thinking',
  read: 'Reading the page',
  search: 'Looking for',
  fetch: 'Fetching',
  paint: 'Painting',
  spray: 'Spray-painting',
  font: 'Restyling the text in',
  write: 'Writing in',
  erase: 'Hiding',
  remove: 'Vacuuming up',
  build: 'Rebuilding',
  measure: 'Measuring',
  add: 'Adding to',
  wire: 'Wiring up',
  hack: 'Hacking the network for',
  watch: 'Keeping watch on',
  dance: 'Choreographing',
  photo: 'Photographing',
  stash: 'Stashing data for',
  polish: 'Polishing',
  tinker: 'Tinkering with',
};

/** Clawdify's own tools (see bridge/mcp-browser.js). */
const TAB_TOOLS = {
  page_info: ['read', 'Checking the page'],
  page_snapshot: ['read', 'Reading the page'],
  page_eval: ['hack', 'Running a snippet'],
  click: ['wire', 'Clicking'],
  type: ['write', 'Typing'],
  navigate: ['fetch', 'Heading to another page'],
  reload: ['fetch', 'Reloading'],
  wait_for: ['watch', 'Waiting for the page'],
  screenshot: ['photo', 'Taking a screenshot'],
  save_output: ['stash', 'Saving a file for you'],
  notify: ['wave', 'Pinging you'],
  watch_create: ['watch', 'Setting up a watch'],
  watch_list: ['read', 'Checking watches'],
  watch_delete: ['erase', 'Stopping a watch'],
};

/** Captions when the change has no particular element to point at. */
const NO_SEL_LABEL = {
  hack: 'Hacking the network 😎',
  stash: 'Stashing data in the vault',
  add: 'Building something new',
  watch: 'Keeping watch over the page',
  wire: 'Wiring up some behaviour',
};

const JS_WORDS = /^(if|else|for|while|try|catch|finally|do|switch|return|function|const|let|var|class|new|async|await|=>|\))$/;

/** A string that could plausibly be a CSS selector (not a JS block header). */
function looksLikeSelector(s) {
  s = s.trim();
  if (!s || s.length > 120 || JS_WORDS.test(s)) return false;
  if (/[=;'"`]|\b(function|return|const|let|var|if|else)\b|=>/.test(s)) return false;
  if (/\(/.test(s) && !/:(not|is|where|has|nth-[\w-]+)\(/.test(s)) return false;
  return /^[\w\s.#*>+~:[\]\-(),="^$|]+$/.test(s);
}

/** CSS rule blocks found anywhere in the code (template-literal CSS, GM_addStyle, ...). */
function cssBlocks(code) {
  const out = [];
  const re = /([^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(code))) {
    let head = m[1].split(/[`'"\n;]/).pop().trim();
    if (head.startsWith('@')) continue;
    head = head.replace(/^.*\*\//, '').trim();
    const sels = head.split(',').map(s => s.trim()).filter(looksLikeSelector);
    if (sels.length && /:\s*[^;]+/.test(m[2])) out.push({ sels, decls: m[2] });
  }
  return out;
}

/** Selectors referenced from JS. */
function jsSelectors(code) {
  const out = [];
  let m;
  const q = /querySelector(?:All)?\(\s*(['"`])((?:(?!\1).){1,160})\1/g;
  while ((m = q.exec(code))) if (!/\$\{/.test(m[2])) out.push(m[2]);
  const id = /getElementById\(\s*['"`]([\w-]+)/g;
  while ((m = id.exec(code))) out.push(`#${m[1]}`);
  const cls = /getElementsByClassName\(\s*['"`]([\w-]+)/g;
  while ((m = cls.exec(code))) out.push(`.${m[1]}`);
  const tag = /getElementsByTagName\(\s*['"`]([\w-]+)/g;
  while ((m = tag.exec(code))) out.push(m[1]);
  return out;
}

function pickKind(code) {
  let best = null;
  let bestN = 0;
  for (const [kind, re] of KINDS) {
    const n = (code.match(re) || []).length;
    if (n > bestN) { best = kind; bestN = n; }
  }
  return best || 'tinker';
}

const COLOR_RE = /(?:^|[^-\w])(?:color|background(?:-color)?|fill|border(?:-\w+)?-color)\s*:\s*(#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)|[a-z]{3,20})/i;
const MEASURE_RE = /(?:^|[^-\w])((?:max-|min-)?(?:width|height))\s*:\s*([^;!}\n]{1,24})/i;

function shortSel(sel) {
  if (!sel) return 'the page';
  const s = sel.replace(/\s+/g, ' ').trim();
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}

/** What a shell command looks like it's doing (Live Clawd). */
const BASH_KINDS = [
  [/\b(vitest|jest|pytest|mocha|playwright|cypress|(npm|pnpm|yarn|bun)( run)? test|cargo test|go test|make test|check)\b/, 'search', 'Running the tests'],
  [/\b(eslint|prettier|lint|ruff|clippy|stylelint|black|biome)\b/, 'polish', 'Linting and tidying'],
  [/\b(tsc|build|make|cargo build|go build|webpack|vite build|gulp|compile|cmake|ninja)\b/, 'build', 'Building the project'],
  [/\b(npm (i|install|add)|pnpm (i|install|add)|yarn add|pip install|cargo add|apt|brew)\b/, 'fetch', 'Installing packages'],
  [/\bgit (commit|add|stash)\b/, 'stash', 'Committing to git'],
  [/\bgit (push|pull|fetch|clone)\b/, 'fetch', 'Syncing with the remote'],
  [/\bgit\b/, 'read', 'Checking git'],
  [/\b(curl|wget|http)\b/, 'fetch', 'Fetching from the web'],
  [/\b(ls|cat|head|tail|grep|rg|find|fd|tree|wc|less)\b/, 'search', 'Poking around the files'],
  [/\b(rm|mv|cp|mkdir)\b/, 'tinker', 'Shuffling files around'],
];

const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html?)$/i;
const STYLE_EXT = /\.(css|scss|sass|less|styl)$/i;

/** Selectors and React component names referenced by a UI source edit. */
function sourceTargets(code, file) {
  const sels = [];
  const comps = [];
  let m;
  const cls = /className\s*=\s*["'`{]?\s*["'`]([\w\s-]+)["'`]/g;
  while ((m = cls.exec(code))) sels.push(`.${m[1].trim().split(/\s+/)[0]}`);
  const id = /\bid\s*=\s*["'`{]?\s*["'`]([\w-]+)["'`]/g;
  while ((m = id.exec(code))) sels.push(`#${m[1]}`);
  const tid = /data-testid\s*=\s*["'`{]?\s*["'`]([\w-]+)["'`]/g;
  while ((m = tid.exec(code))) sels.push(`[data-testid="${m[1]}"]`);
  const fn = /\b(?:function|const|let|class)\s+([A-Z]\w+)/g;
  while ((m = fn.exec(code))) comps.push(m[1]);
  const base = (file || '').split('/').pop().replace(/\.\w+$/, '');
  if (/^[A-Z]\w+$/.test(base)) comps.unshift(base);
  else if (base === 'index') {
    const dir = (file || '').split('/').slice(-2, -1)[0] || '';
    if (/^[A-Z]\w+$/.test(dir)) comps.unshift(dir);
  }
  return { sels: [...new Set(sels)].filter(looksLikeSelector), comps: [...new Set(comps)].slice(0, 8) };
}

const fileName = f => (f || '').split('/').pop();

/** Live Clawd: a tool call from a Claude Code session on a local project. */
function classifySource(name, detail, file) {
  const short = fileName(file);
  if (name === 'Bash') {
    const hit = BASH_KINDS.find(([re]) => re.test(detail));
    return { kind: hit ? hit[1] : 'hack', selectors: [], label: hit ? hit[2] : `Running ${detail.split(/\s+/)[0] || 'a command'}` };
  }
  if (name === 'Read' || name === 'NotebookRead') return { kind: 'read', selectors: [], label: `Reading ${short || 'a file'}` };
  if (name === 'Grep' || name === 'Glob') return { kind: 'search', selectors: [], pattern: name === 'Grep' ? detail : '', label: `Searching for “${detail.slice(0, 24)}”` };
  if (name === 'WebFetch' || name === 'WebSearch') return { kind: 'fetch', selectors: [], label: 'Browsing the web' };
  if (name === 'Task' || name === 'Agent') return { kind: 'think', selectors: [], label: 'Briefing a helper' };
  if (name === 'TodoWrite') return { kind: 'write', selectors: [], label: 'Updating the to-do list' };
  if (!/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return { kind: 'think', selectors: [], label: `${VERB.think}…` };
  if (/\.(md|mdx|txt|rst)$/i.test(short)) return { kind: 'write', selectors: [], label: `Writing ${short}` };
  if (/\.(test|spec)\.\w+$|(^|\/)(tests?|__tests__)\//.test(file || '')) return { kind: 'search', selectors: [], label: `Writing tests in ${short}` };
  if (/\.(json|ya?ml|toml|ini|env|lock)$|config\./i.test(short)) return { kind: 'tinker', selectors: [], label: `Tweaking ${short}` };
  const isStyle = STYLE_EXT.test(short);
  const isUi = UI_EXT.test(short) || /styled|sx=|css`|className/.test(detail);
  if (!isStyle && !isUi) {
    const kind = pickKind(detail);
    return { kind: kind === 'tinker' ? 'hack' : kind, selectors: [], label: `Editing ${short || 'code'}` };
  }
  const action = classifyCode(detail);
  if (isUi) {
    const t = sourceTargets(detail, file);
    action.selectors = [...new Set([...action.selectors, ...t.sels])].slice(0, 12);
    action.components = t.comps;
  }
  const who = action.components && action.components[0] ? `<${action.components[0]}>` : shortSel(action.selectors[0]) || short;
  action.label = `${VERB[action.kind]} ${who === 'the page' ? short : who}`;
  return action;
}

/**
 * @param {string} name tool name (Edit, Write, Grep, Read, Bash, ...)
 * @param {string} [detail] edited code, grep pattern, file name or command
 * @param {string} [file] for Live Clawd: the edited/read file, relative to the project
 * @return {ClawdAction}
 */
export function classifyTool(name, detail = '', file = '') {
  detail = String(detail || '');
  if (name.startsWith('mcp__clawdify__')) {
    const [kind, label] = TAB_TOOLS[name.slice(15)] || ['think', 'Thinking…'];
    return { kind, selectors: /click|type|wait_for|page_snapshot/.test(name) && looksLikeSelector(detail) ? [detail] : [], label };
  }
  if (file || name === 'Bash' && !/^curl\b/.test(detail)) return classifySource(name, detail, file);
  if (name === 'Grep') {
    return { kind: 'search', selectors: [], pattern: detail.slice(0, 200), label: `${VERB.search} “${detail.slice(0, 28)}”` };
  }
  if (name === 'Read' || name === 'Glob') {
    if (/userscript/.test(detail)) return { kind: 'think', selectors: [], label: 'Re-reading my script' };
    if (/screenshot/.test(detail)) return { kind: 'photo', selectors: [], label: 'Looking at a screenshot' };
    if (/assets?\//.test(detail) || /\.(css|js)$/.test(detail)) return { kind: 'read', selectors: [], label: 'Reading the site’s code' };
    return { kind: 'read', selectors: [], label: VERB.read };
  }
  if (name === 'Bash') return { kind: 'fetch', selectors: [], label: 'Fetching something from the web' };
  if (name !== 'Edit' && name !== 'Write' && name !== 'MultiEdit') {
    return { kind: 'think', selectors: [], label: `${VERB.think}…` };
  }
  return classifyCode(detail);
}

/** Kind, target selectors, colour/size details of a piece of edited code. */
function classifyCode(detail) {
  const kind = pickKind(detail);
  const blocks = cssBlocks(detail);
  const kindRe = KINDS.find(([k]) => k === kind)?.[1];
  // Prefer selectors from the CSS rule that actually made us pick this kind.
  const matching = kindRe ? blocks.filter(b => (kindRe.lastIndex = 0, kindRe.test(b.decls))) : [];
  const selectors = [...new Set([
    ...matching.flatMap(b => b.sels),
    ...jsSelectors(detail),
    ...blocks.flatMap(b => b.sels),
  ])].slice(0, 12);
  const action = { kind, selectors, label: `${VERB[kind]} ${shortSel(selectors[0])}` };
  if (!selectors.length && NO_SEL_LABEL[kind]) action.label = NO_SEL_LABEL[kind];
  if (kind === 'paint' || kind === 'spray') {
    const src = matching.map(b => b.decls).join(';') || detail;
    const m = src.match(COLOR_RE);
    if (m && !/^(inherit|initial|unset|none|transparent|var|currentcolor|important)$/i.test(m[1])) action.color = m[1];
  }
  if (kind === 'measure') {
    const m = (matching.map(b => b.decls).join(';') || detail).match(MEASURE_RE);
    if (m) action.measure = `${m[1]}: ${m[2].trim()}`;
  }
  return action;
}

/** Caption for moods that aren't tool calls. */
export const MOOD_LABEL = {
  idle: 'Ready when you are',
  think: 'Thinking…',
  done: 'All done!',
  error: 'Oops, that didn’t work',
  wave: 'Need you in the terminal 👋',
  water: 'Hydrating… AI is thirsty work',
};
