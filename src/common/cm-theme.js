/**
 * Shared look for the ClaudeMonkey popup and sidebar: warm Claude-style palette,
 * light/dark via prefers-color-scheme, and the pixel-art Clawd mark.
 */

const CLAWD_ROWS = [
  '...##########...',
  '...##########...',
  '...##o####o##...',
  '...##o####o##...',
  '.##############.',
  '.##############.',
  '...##########...',
  '...##########...',
  '....#.#..#.#....',
  '....#.#..#.#....',
];

/** Inline SVG of Clawd, `size` px wide. */
export function clawdSvg(size = 20) {
  let rects = '';
  CLAWD_ROWS.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="var(--clawd)"/>`;
    else if (ch === 'o') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="var(--clawd-eye)"/>`;
  }));
  const h = Math.round(size * CLAWD_ROWS.length / 16);
  return `<svg class="cm-clawd" width="${size}" height="${h}" viewBox="0 0 16 ${CLAWD_ROWS.length}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #faf9f5;
  --surface: #ffffff;
  --surface-2: #f0eee6;
  --border: #e3e0d6;
  --text: #1f1e1d;
  --muted: #6f6d66;
  --faint: #9b998f;
  --accent: #c96442;
  --accent-hover: #b4583a;
  --accent-text: #ffffff;
  --accent-soft: #f6e7e0;
  --ok: #4f7a45;
  --err: #b3261e;
  --err-soft: #fbe9e7;
  --code-bg: #1f1e1d;
  --code-fg: #e8e6dc;
  --clawd: #d97757;
  --clawd-eye: #1f1e1d;
  --shadow: 0 1px 2px rgba(31, 30, 29, .06), 0 2px 8px rgba(31, 30, 29, .05);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #262624;
    --surface: #30302e;
    --surface-2: #3a3936;
    --border: #46443f;
    --text: #f2f0e8;
    --muted: #b0ada3;
    --faint: #85837b;
    --accent: #d97757;
    --accent-hover: #e38a6c;
    --accent-text: #1f1e1d;
    --accent-soft: #42302a;
    --ok: #9cc68d;
    --err: #f2938a;
    --err-soft: #43272499;
    --code-bg: #1b1b1a;
    --code-fg: #e8e6dc;
    --clawd-eye: #1b1b1a;
    --shadow: 0 1px 2px rgba(0, 0, 0, .25);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--text);
  background: var(--bg);
}
button { font: inherit; color: inherit; cursor: pointer; user-select: none; }
button:disabled { cursor: default; opacity: .55; }
a { color: var(--accent); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cm-clawd { display: block; flex: none; image-rendering: pixelated; }

.cm-btn {
  border: 0; border-radius: 8px; padding: 7px 14px; font-weight: 600;
  background: var(--accent); color: var(--accent-text);
  transition: background .12s;
}
.cm-btn:not(:disabled):hover { background: var(--accent-hover); }
.cm-btn-ghost {
  border: 1px solid var(--border); border-radius: 8px; padding: 4px 10px;
  background: var(--surface); color: var(--muted); font-size: 12px;
}
.cm-btn-ghost:not(:disabled):hover { color: var(--text); border-color: var(--faint); }

.cm-input {
  width: 100%; resize: none; border: 1px solid var(--border); border-radius: 12px;
  padding: 10px 12px; font: inherit; color: var(--text); background: var(--surface);
  box-shadow: var(--shadow); outline: none;
}
.cm-input:focus { border-color: var(--accent); }
.cm-input::placeholder { color: var(--faint); }

.cm-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 2px 9px; border-radius: 999px; font-size: 12px;
  background: var(--surface-2); color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cm-muted { color: var(--muted); }
.cm-kbd { font-size: 11px; color: var(--faint); }

.cm-switch { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--muted); }
.cm-switch input { position: absolute; opacity: 0; pointer-events: none; }
.cm-switch .track {
  width: 28px; height: 16px; border-radius: 999px; background: var(--border);
  position: relative; transition: background .15s; flex: none;
}
.cm-switch .track::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: #fff; transition: transform .15s;
}
.cm-switch input:checked + .track { background: var(--accent); }
.cm-switch input:checked + .track::after { transform: translateX(12px); }
.cm-switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 1px; }

@keyframes cm-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
.cm-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.cm-dot.live { animation: cm-pulse 1.2s ease-in-out infinite; }
`;

export function injectTheme(extraCss = '') {
  const style = document.createElement('style');
  style.textContent = CSS + extraCss;
  document.head.appendChild(style);
}

export const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Hostname of an http(s) URL, else null. */
export function siteOf(url) {
  try {
    return url && /^https?:/.test(url) ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}
