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
  ['wire', /(addEventListener\(|\bon(click|key\w+|input|change|submit|scroll)\s*=|\.click\(\))/g],
  ['spray', /(linear-gradient|radial-gradient|conic-gradient|filter\s*:|backdrop-filter|mix-blend-mode)/gi],
  ['paint', /((^|[^-\w])(color|background(-color)?|fill|stroke|accent-color|caret-color)\s*:|border(-\w+)?-color\s*:|\.style\.(color|background\w*)\s*=)/gi],
  ['font', /(font(-\w+)?\s*:|line-height\s*:|letter-spacing\s*:|text-transform\s*:|text-decoration\s*:|\.style\.font\w*\s*=)/gi],
  ['measure', /((^|[^-\w])((max|min)-)?(width|height)\s*:|\.style\.(width|height)\s*=)/gi],
  ['polish', /(border(-radius)?\s*:|box-shadow\s*:|outline\s*:|text-shadow\s*:)/gi],
  ['build', /((^|[^-\w])(display|position|margin(-\w+)?|padding(-\w+)?|gap|flex(-\w+)?|grid(-\w+)?|float|align-\w+|justify-\w+|z-index|top|left|right|bottom|overflow)\s*:)/gi],
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

/**
 * @param {string} name tool name (Edit, Write, Grep, Read, Bash, ...)
 * @param {string} [detail] edited code, grep pattern, file name or command
 * @return {ClawdAction}
 */
export function classifyTool(name, detail = '') {
  detail = String(detail || '');
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
  water: 'Hydrating… AI is thirsty work',
};
