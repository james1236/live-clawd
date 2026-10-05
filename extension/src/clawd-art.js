/**
 * Clawd, the pixel mascot, as an animatable SVG sprite shared by the sidebar and the
 * in-page overlay. Must stay self-contained (no project globals): the overlay bundle is
 * injected into web pages.
 *
 * The sprite is described as data so it can be rendered either to a markup string
 * (sidebar) or straight to DOM nodes (overlay — pages with Trusted Types reject
 * innerHTML). Its mood is a class on the <svg>, `m-<kind>`; kinds are listed in
 * clawd-actions.js plus `idle`, `walk`, `water`, `done` and `error`.
 *
 * Coordinates: Clawd's body is the 16x10 grid at (0,0), one unit per Clawd pixel; the
 * viewBox leaves room for props on both sides and bubbles/hats above.
 */

export const VIEWBOX = { x: -5, y: -8, w: 26, h: 19 };

const R = (x, y, width, height, fill, cls) => ['rect', { x, y, width, height, fill, class: cls }];
const C = (cx, cy, r, fill, cls, extra) => ['circle', { cx, cy, r, fill, class: cls, ...extra }];
const T = (x, y, size, fill, text, cls) => ['text', {
  x, y, 'font-size': size, fill, class: cls, 'font-family': 'system-ui, sans-serif', 'font-weight': 700,
}, [text]];
const G = (cls, children) => ['g', { class: cls }, children];

const BODY = 'var(--clawd, #d97757)';
const EYE = 'var(--clawd-eye, #1f1e1d)';
const PAINT = 'var(--paint, #d97757)';
const WOOD = '#8a5a3c';
const STEEL = '#9aa0a8';
const DARK = '#2b2b2b';
const PAPER = '#fbfaf6';
const INK = '#b9b5aa';

/** Pixel heart, 5x4 pixels at `s` units each. */
function heart(x, y, s, cls) {
  const px = [];
  ['.#.#.', '#####', '.###.', '..#..'].forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '#') px.push(R(x + i * s, y + j * s, s, s, '#e8636f'));
  }));
  return G(cls, px);
}

/** Held in the right hand (rotates with the arm). Shown by `.m-<kind> .cw-p-<name>`. */
const RIGHT = [
  G('cw-prop cw-p-brush', [R(15, 1, 1, 4, WOOD), R(14.5, 0, 2, 1, STEEL), R(14.5, -2, 2, 2, PAINT)]),
  G('cw-prop cw-p-spray', [
    R(15, 0, 2, 4.5, '#7d8fa8'), R(15, 1.2, 2, 1, PAINT), R(15.5, -1, 1, 1, DARK),
    C(17.8, -1, 0.35, PAINT, 'cw-mist'), C(18.8, -1.6, 0.3, PAINT, 'cw-mist cw-m2'),
    C(18.6, -0.3, 0.3, PAINT, 'cw-mist cw-m3'), C(19.6, -1, 0.25, PAINT, 'cw-mist cw-m2'),
  ]),
  G('cw-prop cw-p-eraser', [R(15, 1, 3, 3, '#f2a7b5'), R(15, 3, 3, 1, '#6f8fc0')]),
  G('cw-prop cw-p-pencil', [R(15, 0, 1, 4, '#f2c94c'), R(15, 4, 1, 1, '#e9b38a'), R(15, -1, 1, 1, '#f28b9b')]),
  G('cw-prop cw-p-hammer', [R(15, -1, 1, 6, WOOD), R(13.5, -2, 4, 2, '#6b7078')]),
  G('cw-prop cw-p-wrench', [R(15, 0, 1, 5, STEEL), R(14, -2, 1, 2, STEEL), R(16, -2, 1, 2, STEEL), R(14, -1, 3, 1, STEEL)]),
  G('cw-prop cw-p-glass', [
    ['line', { x1: 15, y1: 5, x2: 16.2, y2: 2.6, stroke: WOOD, 'stroke-width': 0.9 }],
    C(17.2, 1, 1.9, 'rgba(190,225,255,.55)', null, { stroke: '#5b6068', 'stroke-width': 0.6 }),
  ]),
  G('cw-prop cw-p-paper', [R(14, 0, 4, 5, PAPER), R(14.5, 1, 3, 0.5, INK), R(14.5, 2, 3, 0.5, INK), R(14.5, 3, 2, 0.5, INK)]),
  G('cw-prop cw-p-tape', [R(15, 3, 3, 3, '#f2c94c'), R(15.8, 3.8, 1.4, 1.4, DARK), R(18, 4.4, 4, 0.7, '#f7e08a', 'cw-tape')]),
  G('cw-prop cw-p-camera', [
    R(14.5, 1, 4.5, 3, '#3b3b3b'), R(15, 0.4, 1.4, 0.6, '#3b3b3b'),
    C(16.8, 2.5, 1, '#8ab4d8', null, { stroke: '#222', 'stroke-width': 0.3 }), R(17.8, 1.3, 0.8, 0.5, '#fff6c4', 'cw-flashbulb'),
  ]),
  G('cw-prop cw-p-sponge', [R(15, 2, 3, 2.2, '#f5d061'), R(15.5, 2.5, 0.5, 0.5, '#d9ae35'), R(16.8, 3.3, 0.5, 0.5, '#d9ae35')]),
  G('cw-prop cw-p-sign', [R(15.5, 1, 0.8, 4, WOOD), R(14, -3.2, 5.5, 4.2, PAPER), T(14.4, 0, 3, '#1f1e1d', 'Aa', 'cw-sign-text')]),
  G('cw-prop cw-p-hose', [
    ['path', { d: 'M15.5 5.5 C 15.6 8.5, 17.2 9.2, 17.6 7', fill: 'none', stroke: '#666', 'stroke-width': 0.8 }],
    R(15.1, 0.6, 0.8, 5, '#888'), R(13.6, -0.6, 3.8, 1.3, '#d9534f'), R(13.6, -0.6, 3.8, 0.4, '#2b2b2b'),
  ]),
  G('cw-prop cw-p-bottle', [
    R(15, -3, 2.2, 6, 'rgba(120,190,240,.9)'), R(15, -3, 2.2, 1.6, 'rgba(255,255,255,.35)', 'cw-water-air'),
    R(15.4, -4, 1.4, 1, '#3a7bd5'), R(15, 0, 2.2, 1, '#ffffff'),
  ]),
  G('cw-prop cw-p-ask', [R(15.6, 1, 0.8, 4.5, WOOD), R(13.8, -4.4, 6, 5, '#fff3c4'), R(13.8, -4.4, 6, 0.6, '#e2b04a'), T(14.9, -0.5, 3.4, '#c0392b', '!?', 'cw-sign-text')]),
  G('cw-prop cw-p-plane', [
    ['polygon', { points: '14,1.4 20.4,-0.6 15.6,2.8', fill: PAPER, stroke: '#bdb8ac', 'stroke-width': 0.2, class: 'cw-plane' }],
  ]),
  G('cw-prop cw-p-timer', [C(16.2, 2.6, 1.7, '#e0533f'), R(15.8, 0.5, 0.8, 0.6, '#4caf6a'), R(16, 1.2, 0.4, 1.4, PAPER, 'cw-dial')]),
  G('cw-prop cw-p-tube', [
    R(15.2, -2, 1.5, 5.4, 'rgba(225,242,255,.75)'), R(15.2, 0.6, 1.5, 2.8, '#5ccf6a'), R(15, -2.3, 1.9, 0.5, '#c9d6e2'),
    C(15.9, -2.8, 0.35, '#9be6a6', 'cw-bub'), C(16.4, -3.6, 0.3, '#9be6a6', 'cw-bub cw-bub2'), C(15.6, -4.2, 0.25, '#9be6a6', 'cw-bub cw-bub3'),
  ]),
  G('cw-prop cw-p-key', [C(16, 0.5, 1.2, '#e2b04a'), C(16, 0.5, 0.45, '#8a6a1f'), R(15.6, 1.5, 0.8, 3.5, '#e2b04a'), R(16.4, 3.5, 0.8, 0.5, '#e2b04a')]),
];

/** Held in the left hand. */
const LEFT = [
  G('cw-lprop cw-l-palette', [
    ['ellipse', { cx: -0.7, cy: 4.6, rx: 2.6, ry: 1.7, fill: '#e8cfa0' }],
    C(-2, 4, 0.45, '#e05a4f'), C(-0.8, 3.6, 0.45, '#3d7fd6'), C(0.4, 4.1, 0.45, '#f2c94c'), C(-1.4, 5.3, 0.45, '#4caf6a'),
    C(0.1, 5.4, 0.45, PAINT),
  ]),
  G('cw-lprop cw-l-clipboard', [
    R(-3, 0.5, 4.5, 6, '#a9773f'), R(-2.6, 1.3, 3.7, 4.9, PAPER), R(-1.4, 0.1, 1.4, 0.8, STEEL),
    ...[0, 1, 2].flatMap(i => [
      R(-2.2, 2 + i * 1.4, 0.8, 0.8, '#d8d3c6'), R(-1.1, 2.25 + i * 1.4, 1.9, 0.35, INK),
      R(-2.3, 2.2 + i * 1.4, 0.35, 0.5, '#3a9a52', `cw-chk cw-c${i}`), R(-2, 1.75 + i * 1.4, 0.35, 0.95, '#3a9a52', `cw-chk cw-c${i}`),
    ]),
  ]),
  G('cw-lprop cw-l-flask', [
    R(-1.2, 1.4, 1.2, 2, 'rgba(225,242,255,.75)'), C(-0.6, 4.5, 1.7, 'rgba(225,242,255,.75)'), C(-0.6, 4.9, 1.25, '#b46be0'),
    C(-0.9, 4.4, 0.3, '#e0b9f5', 'cw-bub'), C(-0.2, 3.6, 0.25, '#e0b9f5', 'cw-bub cw-bub2'),
  ]),
  G('cw-lprop cw-l-chalk', [R(0.7, 2.6, 0.7, 1.6, '#f4f1e8'), R(0.7, 2.6, 0.7, 0.4, '#d9d4c6')]),
  G('cw-lprop cw-l-notepad', [R(-2.5, 1.5, 3.5, 4.5, PAPER), R(-2.5, 1.5, 3.5, 0.7, '#e05a4f'), R(-2, 3, 2.5, 0.4, INK), R(-2, 4, 2.5, 0.4, INK)]),
];

/** On Clawd's head / face. */
const HEAD = [
  G('cw-hat cw-h-hardhat', [R(4, -2.2, 8, 2.2, '#f2c94c'), R(2.6, -0.4, 10.8, 0.9, '#e0b43a'), R(7.6, -2.2, 0.8, 2.2, '#e0b43a')]),
  G('cw-hat cw-h-goggles', [
    R(3, 1.5, 10, 0.6, '#5d636b'), R(4, 1, 3, 2.6, 'rgba(170,220,255,.55)'), R(9, 1, 3, 2.6, 'rgba(170,220,255,.55)'),
    R(4, 1, 3, 0.4, '#8a9099'), R(9, 1, 3, 0.4, '#8a9099'),
  ]),
  G('cw-hat cw-h-shades', [R(4, 1.6, 3, 1.8, '#111'), R(9, 1.6, 3, 1.8, '#111'), R(7, 2, 2, 0.5, '#111'), R(4.4, 1.9, 0.8, 0.4, '#666')]),
  G('cw-hat cw-h-binos', [
    R(4, 1.2, 3, 2.8, '#333'), R(9, 1.2, 3, 2.8, '#333'), R(7, 2, 2, 1, '#333'),
    C(5.5, 2.6, 0.9, '#7fb0d6'), C(10.5, 2.6, 0.9, '#7fb0d6'),
  ]),
  G('cw-hat cw-h-phones', [R(3.6, -1.2, 8.8, 0.8, '#333'), R(2.4, 0.6, 1.4, 3, '#333'), R(12.2, 0.6, 1.4, 3, '#333'), R(2.6, -0.8, 0.8, 1.6, '#333'), R(12.6, -0.8, 0.8, 1.6, '#333')]),
  G('cw-hat cw-h-beret', [['ellipse', { cx: 7, cy: -0.4, rx: 4.2, ry: 1.2, fill: '#3b3b6b' }], R(6.6, -1.9, 0.8, 0.8, '#3b3b6b')]),
];

/** Carried overhead with both arms up. */
const OVERHEAD = [
  G('cw-over cw-o-block', [R(4.5, -4.5, 7, 4, PAPER), R(4.5, -4.5, 7, 0.6, BODY), R(7.5, -3.4, 1, 2, BODY), R(7, -2.9, 2, 1, BODY)]),
  G('cw-over cw-o-parcel', [R(4.5, -4.5, 7, 4, '#c79a62'), R(7.5, -4.5, 1, 4, '#a77c48')]),
  G('cw-over cw-o-chest', [R(4.5, -4.5, 7, 4, '#a0672f'), R(4.5, -3.2, 7, 0.5, '#e2b04a'), R(7.5, -3.5, 1, 1.2, '#e2b04a'), R(4.5, -4.5, 7, 0.5, '#7d4f22')]),
];

/** Behind Clawd. */
const CHALK = '#e9efe6';
/** Forking a helper: a copy of him slides out from behind and shrinks to baby size. */
const TWIN = G('cw-front cw-b-twin', [
  R(4, 8, 1, 2, BODY), R(6, 8, 1, 2, BODY), R(9, 8, 1, 2, BODY), R(11, 8, 1, 2, BODY),
  R(3, 0, 10, 8, BODY), R(1, 4, 2, 2, BODY), R(13, 4, 2, 2, BODY), R(5, 2, 1, 2, EYE), R(10, 2, 1, 2, EYE),
]);

const BOARD = G('cw-front cw-b-board', [
  R(-4.8, -6.8, 25.6, 9.1, WOOD), R(-4.5, -6.5, 25, 8.5, '#2f4f3a'),
  R(-3.6, 2.3, 0.6, 7.7, WOOD), R(19.6, 2.3, 0.6, 7.7, WOOD),
  T(-3.6, -3.4, 2.2, CHALK, 'x²+y', 'cw-chalk cw-k0'), R(-3.6, -2.6, 5, 0.25, CHALK, 'cw-chalk cw-k0'),
  T(3.4, -4.2, 2, CHALK, '∑ n·k', 'cw-chalk cw-k1'), T(4.6, -1.2, 1.8, CHALK, '→ O(n)', 'cw-chalk cw-k2'),
  T(13, -3.2, 2.4, CHALK, '= ?', 'cw-chalk cw-k3'),
]);

/** In front of Clawd, on the ground. */
const FRONT = [
  G('cw-front cw-f-laptop', [
    R(3.3, 4.2, 9.4, 4, '#2f3136'), R(3.8, 4.6, 8.4, 3.2, '#06150b'),
    ...[[4.3, 0], [5.5, 1], [6.7, 2], [7.9, 0], [9.1, 1], [10.3, 2], [11.3, 0]].map(([x, d]) => (
      R(x, 4.8, 0.5, 0.5, '#36d15e', `cw-bit cw-b${d}`)
    )),
    ...[[4.9, 2], [6.1, 0], [8.5, 1], [9.7, 0], [10.9, 2]].map(([x, d]) => (
      R(x, 6.4, 0.5, 0.5, '#36d15e', `cw-bit cw-b${d}`)
    )),
    R(1.8, 8.2, 12.4, 1, '#9aa0a8'),
  ]),
  G('cw-front cw-f-vacuum', [R(16, 6.4, 4.2, 3, '#d9534f'), R(16.5, 5.8, 3.2, 0.7, '#b03a37'), C(16.8, 9.6, 0.6, DARK), C(19.4, 9.6, 0.6, DARK)]),
  G('cw-front cw-f-bricks', [
    R(16, 8.6, 2.6, 1.4, '#b5533c'), R(18.8, 8.6, 2.6, 1.4, '#a8492f'),
    G('cw-row cw-row1', [R(17.4, 7.1, 2.6, 1.4, '#a8492f'), R(16, 7.1, 1.2, 1.4, '#b5533c')]),
    G('cw-row cw-row2', [R(16.6, 5.6, 2.6, 1.4, '#b5533c')]),
  ]),
  G('cw-front cw-f-box', [
    R(5, 3.6, 1.2, 1.2, '#4caf6a', 'cw-item cw-i0'), R(8.4, 3.4, 1.1, 1.1, '#3d7fd6', 'cw-item cw-i1'), C(11, 4.2, 0.6, '#f2c94c', 'cw-item cw-i2'),
    R(2.5, 5.5, 11, 4.5, '#c79a62'), R(7.4, 5.5, 1.2, 4.5, '#a77c48'),
    R(0.8, 4.8, 2.6, 0.9, '#b8894f'), R(12.6, 4.8, 2.6, 0.9, '#b8894f'),
  ]),
  G('cw-front cw-f-book', [
    R(3.6, 7.4, 8.8, 0.6, '#7a4a2a'),
    R(4, 4.6, 3.8, 3, PAPER), R(8.2, 4.6, 3.8, 3, PAPER), R(7.8, 4.6, 0.4, 3.2, '#7a4a2a'),
    R(4.5, 5.3, 2.8, 0.3, INK), R(4.5, 6.2, 2.4, 0.3, INK), R(8.7, 5.3, 2.8, 0.3, INK), R(8.7, 6.2, 2.2, 0.3, INK),
    R(8.2, 4.6, 3.8, 3, '#efe9da', 'cw-page'),
  ]),
  G('cw-front cw-f-knit', [
    ['path', { d: 'M8.2 7 C 11 9.8, 14 10.4, 17 9.4', fill: 'none', stroke: '#e05a8a', 'stroke-width': 0.3 }],
    C(17.5, 9, 1.3, '#e05a8a', 'cw-yarn'), R(16.9, 8.4, 1.2, 0.3, '#f7c7d8', 'cw-yarn'),
    G('cw-scarf', [R(6.8, 7, 2.6, 3, '#e05a8a'), R(6.8, 7.8, 2.6, 0.5, '#f7c7d8'), R(6.8, 9, 2.6, 0.5, '#f7c7d8')]),
    ['line', { x1: 4.4, y1: 5, x2: 9.8, y2: 7.6, stroke: STEEL, 'stroke-width': 0.45, class: 'cw-needle cw-nl' }],
    ['line', { x1: 11.6, y1: 5, x2: 6.2, y2: 7.6, stroke: STEEL, 'stroke-width': 0.45, class: 'cw-needle cw-nr' }],
  ]),
  // The lab: an Erlenmeyer flask brewing on a ring stand over a Bunsen burner.
  G('cw-front cw-f-lab', [
    R(16.2, 9.4, 3.6, 0.6, '#5d636b'), R(17.6, 7.7, 0.8, 1.7, '#8a9099'),
    ['ellipse', { cx: 18, cy: 6.9, rx: 0.55, ry: 1, fill: '#4aa3ff', class: 'cw-flame' }],
    ['ellipse', { cx: 18, cy: 7.15, rx: 0.25, ry: 0.5, fill: '#d6efff', class: 'cw-flame' }],
    R(15.9, 5.6, 4.2, 0.35, STEEL), R(16, 5.6, 0.3, 4.4, STEEL), R(19.7, 5.6, 0.3, 4.4, STEEL),
    ['polygon', { points: '17.3,2 18.7,2 18.7,3.3 20.3,5.6 15.7,5.6 17.3,3.3', fill: 'rgba(225,242,255,.7)', stroke: '#b9cbd9', 'stroke-width': 0.2 }],
    ['polygon', { points: '16.4,4.6 19.6,4.6 20.3,5.6 15.7,5.6', class: 'cw-potion' }],
    C(17.4, 4.9, 0.25, '#ffffffaa', 'cw-fizz'), C(18.6, 5.1, 0.2, '#ffffffaa', 'cw-fizz cw-fz2'), C(18, 4.8, 0.2, '#ffffffaa', 'cw-fizz cw-fz3'),
    C(18, 1.3, 0.55, 'rgba(255,255,255,.7)', 'cw-steam'), C(18.6, 0.4, 0.45, 'rgba(255,255,255,.6)', 'cw-steam cw-st2'),
    C(19.6, 1.9, 0.28, '#5ccf6a', 'cw-pourdrop'),
  ]),
  G('cw-front cw-f-compactor', [
    R(15.5, 2.5, 6, 7.5, '#7d8590'), R(16.2, 4.6, 4.6, 4.6, '#2b2f36'),
    G('cw-wad', [R(16.6, 6.8, 3.8, 2.4, PAPER), R(17, 7.4, 3, 0.3, INK), R(17, 8.2, 2.4, 0.3, INK)]),
    G('cw-piston', [R(18.2, 2.5, 0.6, 2.4, '#5d636b'), R(16.2, 4.6, 4.6, 0.8, STEEL)]),
    R(14.6, 5, 0.9, 0.9, '#d9534f'),
  ]),
  G('cw-front cw-f-easel', [R(-4.4, -1, 0.6, 11, WOOD), R(-1.2, -1, 0.6, 11, WOOD), R(-4.8, -1.5, 4.6, 5, PAPER), R(-4.2, 0, 3.2, 1.4, PAINT, 'cw-canvas')]),
];

const FX = [
  G('cw-bubble', [
    C(13.6, -0.6, 0.5, PAPER, null, { stroke: '#c9c5b9', 'stroke-width': 0.25 }),
    C(15, -2, 0.8, PAPER, null, { stroke: '#c9c5b9', 'stroke-width': 0.25 }),
    ['ellipse', { cx: 16.6, cy: -5, rx: 3.3, ry: 2.2, fill: PAPER, stroke: '#c9c5b9', 'stroke-width': 0.25 }],
    C(15.3, -5, 0.45, '#6f6d66', 'cw-dot cw-d1'), C(16.6, -5, 0.45, '#6f6d66', 'cw-dot cw-d2'), C(17.9, -5, 0.45, '#6f6d66', 'cw-dot cw-d3'),
  ]),
  heart(-2.5, -3, 0.5, 'cw-heart cw-hh1'),
  heart(15.5, -4, 0.5, 'cw-heart cw-hh2'),
  heart(6.5, -6, 0.4, 'cw-heart cw-hh3'),
  // a little rain cloud of sadness
  G('cw-cloud', [
    ['ellipse', { cx: 6.4, cy: -4.6, rx: 2.4, ry: 1.5, fill: '#9aa3ad' }],
    ['ellipse', { cx: 9.2, cy: -5.4, rx: 2.8, ry: 2, fill: '#a9b2bc' }],
    ['ellipse', { cx: 11.4, cy: -4.4, rx: 2, ry: 1.3, fill: '#9aa3ad' }],
    R(4.4, -4.4, 9, 1.4, '#a2abb5'),
    R(6, -2.6, 0.4, 1, '#7fb8e6', 'cw-rain'), R(8.6, -2.4, 0.4, 1, '#7fb8e6', 'cw-rain cw-r2'), R(11, -2.6, 0.4, 1, '#7fb8e6', 'cw-rain cw-r3'),
  ]),
  G('cw-tears', [R(5, 4, 0.6, 1, '#8cc4ef', 'cw-tear'), R(10, 4, 0.6, 1, '#8cc4ef', 'cw-tear cw-t2')]),
  G('cw-sweat', [R(12.6, -0.6, 0.8, 1.2, '#8cc4ef'), R(12.8, -1.2, 0.4, 0.6, '#8cc4ef')]),
  G('cw-notes', [T(-3.5, -1.5, 3, PAINT, '♪', 'cw-note cw-n1'), T(15.5, -3, 3.4, PAINT, '♫', 'cw-note cw-n2')]),
  G('cw-glugs', [C(11.4, 1.6, 0.4, '#d6ecfb', 'cw-glug'), C(12.6, 0.6, 0.32, '#d6ecfb', 'cw-glug cw-g2'), C(13.6, -0.4, 0.28, '#d6ecfb', 'cw-glug cw-g3')]),
  G('cw-glints', [T(17.5, 0.5, 2.6, '#f2c94c', '✦', 'cw-glint'), T(-3.8, 0.5, 2, '#f2c94c', '✦', 'cw-glint cw-gl2'), T(14, -3.5, 1.8, '#f2c94c', '✦', 'cw-glint cw-gl3')]),
  G('cw-sparks', [T(17.5, -1.5, 2.6, '#f2c94c', '⚡', 'cw-spark'), T(-3.5, 2, 2.2, '#f2c94c', '⚡', 'cw-spark cw-sp2')]),
  G('cw-zap', [C(17, 2.5, 3.2, 'rgba(255,255,230,.9)', 'cw-flashburst')]),
  G('cw-zzz', [T(13, -0.5, 2.4, '#7a8aa0', 'z', 'cw-z'), T(15, -2.6, 3, '#7a8aa0', 'z', 'cw-z cw-z1'), T(17.2, -5, 3.6, '#7a8aa0', 'Z', 'cw-z cw-z2')]),
];

const SPRITE = ['svg', {
  viewBox: `${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`,
  class: 'cw-svg m-idle',
  'shape-rendering': 'crispEdges',
  'aria-hidden': 'true',
}, [
  G('cw-all', [
    G('cw-backs', [FRONT.find(f => f[1].class.includes('cw-f-easel')), BOARD, TWIN]),
    G('cw-leg cw-l1', [R(4, 8, 1, 2, BODY)]),
    G('cw-leg cw-l2', [R(6, 8, 1, 2, BODY)]),
    G('cw-leg cw-l3', [R(9, 8, 1, 2, BODY)]),
    G('cw-leg cw-l4', [R(11, 8, 1, 2, BODY)]),
    G('cw-overs', OVERHEAD),
    R(3, 0, 10, 8, BODY, 'cw-body'),
    G('cw-look', [G('cw-eyes', [R(5, 2, 1, 2, EYE), R(10, 2, 1, 2, EYE)])]),
    G('cw-mouth', [['ellipse', { cx: 8, cy: 5.6, rx: 1, ry: 0.9, fill: EYE }]]),
    G('cw-hats', HEAD),
    G('cw-arm cw-al', [R(1, 4, 2, 2, BODY), G('cw-lprops', LEFT)]),
    G('cw-arm cw-ar', [R(13, 4, 2, 2, BODY), G('cw-props', RIGHT)]),
    G('cw-fronts', FRONT.filter(f => !f[1].class.includes('cw-f-easel'))),
  ]),
  G('cw-fx', FX),
]];

const escText = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function toStr(node) {
  if (typeof node === 'string') return escText(node);
  const [tag, attrs, children] = node;
  const a = Object.entries(attrs).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${tag}${a}>${(children || []).map(toStr).join('')}</${tag}>`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function toDom(doc, node) {
  if (typeof node === 'string') return doc.createTextNode(node);
  const [tag, attrs, children] = node;
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children || []) el.appendChild(toDom(doc, c));
  return el;
}

const sized = (width, mood) => {
  const [tag, attrs, children] = SPRITE;
  const height = Math.round(width * VIEWBOX.h / VIEWBOX.w);
  return [tag, { ...attrs, class: `cw-svg m-${mood}`, width, height }, children];
};

/** Sprite markup; `width` in CSS px. */
export const clawdSpriteHtml = (width, mood = 'idle') => toStr(sized(width, mood));

/** Sprite as a DOM node; `width` in CSS px. */
export const clawdSpriteNode = (doc, width, mood = 'idle') => toDom(doc, sized(width, mood));

/** Switch the mood class on a sprite <svg>, keeping extra classes like cw-poke. */
export function setMood(svg, mood, extra = '') {
  svg.setAttribute('class', `cw-svg m-${mood}${extra ? ` ${extra}` : ''}`);
}

/**
 * Point Clawd's eyes at something `dx`,`dy` CSS px away from his eyes (null to stop
 * looking). Eyes move at most one Clawd pixel each way, like his idle glances.
 */
export function lookAt(svg, dx, dy) {
  const look = svg.querySelector('.cw-look');
  if (!look) return;
  if (dx == null) {
    look.style.removeProperty('animation');
    look.style.removeProperty('transform');
    return;
  }
  const d = Math.hypot(dx, dy) || 1;
  const x = Math.round(dx / d * 1.2);
  const y = Math.round(dy / d * 1.2);
  look.style.setProperty('animation', 'none');
  look.style.setProperty('transform', `translate(${Math.max(-1, Math.min(1, x))}px, ${Math.max(-1, Math.min(1, y))}px)`);
}

/** Where Clawd's eyes are within a sprite of `width` CSS px (for lookAt). */
export const eyeOffset = width => ({ x: (8 - VIEWBOX.x) * width / VIEWBOX.w, y: (3 - VIEWBOX.y) * width / VIEWBOX.w });

/**
 * Fling an empty water bottle from (x, y) at (tx, ty) — page-fixed coordinates inside
 * `parent` — and let it fly on until it falls off the screen. Aimed at the cursor
 * (`at` given), it flies straight; if `cursor()` is still there when it arrives it
 * bonks off it (`onHit()`: the dink) and tumbles away spinning, else it sails on past
 * (`onMiss()`). Aimed at nothing, it spins all the way. `at.scale` sizes the bottle.
 */
export function tossBottle(doc, parent, x, y, tx, ty, at) {
  const { cursor, onHit, onMiss, scale = 1 } = at || {};
  const win = doc.defaultView;
  const b = doc.createElement('div');
  const st = b.style;
  st.cssText = 'position:fixed;left:0;top:0;width:10px;height:22px;border-radius:3px 3px 4px 4px;'
    + 'background:linear-gradient(rgba(255,255,255,.55) 0 70%, rgba(120,190,240,.9) 70%);'
    + 'box-shadow:inset 0 0 0 1px rgba(58,123,213,.5);pointer-events:none;z-index:2147483647;will-change:transform';
  const cap = doc.createElement('div');
  cap.style.cssText = 'position:absolute;left:2px;top:-4px;width:6px;height:4px;border-radius:2px 2px 0 0;background:#3a7bd5';
  const label = doc.createElement('div');
  label.style.cssText = 'position:absolute;left:0;right:0;top:8px;height:5px;background:#fff';
  b.append(cap, label);
  parent.appendChild(b);
  const g = 1800; // px/s²
  const flight = Math.max(0.35, Math.min(0.8, Math.hypot(tx - x, ty - y) / 900)); // time to reach the cursor
  let vx = (tx - x) / flight;
  let vy = (ty - y) / flight - g * flight / 2;
  if (!Number.isFinite(vx)) { vx = -300; vy = -600; }
  let spin = at ? 0 : (vx >= 0 ? 1 : -1) * 900; // deg/s
  let px = x;
  let py = y;
  // Flying straight at the cursor: point along the flight path (cap first).
  let aligned = !!at;
  let rot = aligned ? Math.atan2(vy, vx) * 180 / Math.PI + 90 : 0;
  let left = at ? flight : 0; // seconds until it reaches the cursor
  let last = win.performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (left > 0 && (left -= dt) <= 0) {
      const m = cursor && cursor();
      if (m && Math.hypot(m.x - px, m.y - py) < 40) {
        // Dink! Bounces back off the cursor (a ring and a star) and starts spinning.
        aligned = false;
        if (onHit) onHit();
        bonkCursor(doc, parent, m.x, m.y, vx, scale);
        const dir = vx >= 0 ? -1 : 1;
        vx = dir * (160 + Math.random() * 120);
        vy = -Math.abs(vy) * 0.25 - 260;
        spin = dir * (1000 + Math.random() * 500);
      } else if (onMiss) {
        onMiss(); // dodged: it sails on past
      }
    }
    vy += g * dt;
    px += vx * dt;
    py += vy * dt;
    if (aligned) rot = Math.atan2(vy, vx) * 180 / Math.PI + 90;
    rot += spin * dt;
    st.transform = `translate(${px - 5}px, ${py - 11}px) rotate(${rot}deg)${scale !== 1 ? ` scale(${scale})` : ''}`;
    const { innerWidth: w, innerHeight: h } = win;
    if (py > h + 60 || px < -80 || px > w + 80) b.remove();
    else win.requestAnimationFrame(frame);
  };
  win.requestAnimationFrame(frame);
}

/** The bottle just hit the cursor at (x, y): an impact ring and a star flying off. */
function bonkCursor(doc, parent, x, y, vx, scale = 1) {
  const win = doc.defaultView;
  const box = doc.createElement('div');
  box.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;transform:translate(${x}px, ${y}px)`;
  const ring = doc.createElement('div');
  ring.style.cssText = `position:absolute;left:${-12 * scale}px;top:${-12 * scale}px;width:${24 * scale}px;height:${24 * scale}px;`
    + 'border-radius:50%;border:2px solid rgba(58,123,213,.8);transform:scale(.3);opacity:1;'
    + 'transition:transform .35s ease-out, opacity .35s ease-out';
  const star = doc.createElement('div');
  star.textContent = '✦';
  star.style.cssText = `position:absolute;left:${4 * scale}px;top:${-16 * scale}px;font:${12 * scale}px sans-serif;color:#f2b632;`
    + 'transition:transform .4s ease-out, opacity .4s ease-in;opacity:1';
  box.append(ring, star);
  parent.appendChild(box);
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    ring.style.transform = 'scale(1.6)';
    ring.style.opacity = '0';
    star.style.transform = `translate(${(vx >= 0 ? 1 : -1) * 7 * scale}px, ${-8 * scale}px) rotate(90deg)`;
    star.style.opacity = '0';
  }));
  setTimeout(() => box.remove(), 500);
}

/** Which prop groups each mood shows. */
const SHOW = {
  read: ['cw-p-paper'],
  search: ['cw-p-glass'],
  fetch: ['cw-o-parcel'],
  paint: ['cw-p-brush', 'cw-l-palette', 'cw-h-beret'],
  spray: ['cw-p-spray', 'cw-h-shades'],
  font: ['cw-p-sign', 'cw-l-notepad'],
  write: ['cw-p-pencil', 'cw-l-notepad'],
  erase: ['cw-p-eraser'],
  remove: ['cw-p-hose', 'cw-f-vacuum'],
  build: ['cw-p-hammer', 'cw-h-hardhat'],
  measure: ['cw-p-tape', 'cw-h-hardhat'],
  add: ['cw-o-block'],
  wire: ['cw-p-wrench', 'cw-sparks'],
  hack: ['cw-f-laptop', 'cw-h-shades'],
  watch: ['cw-h-binos'],
  dance: ['cw-h-phones', 'cw-notes'],
  photo: ['cw-p-camera', 'cw-zap'],
  stash: ['cw-o-chest', 'cw-p-key'],
  polish: ['cw-p-sponge', 'cw-glints'],
  tinker: ['cw-p-wrench'],
  water: ['cw-p-bottle', 'cw-glugs'],
  throw: ['cw-p-bottle'],
  wave: ['cw-p-ask'],
  canvas: ['cw-f-easel', 'cw-p-brush', 'cw-h-beret'],
  // long-running work, waiting, results
  test: ['cw-l-clipboard', 'cw-p-pencil'],
  lab: ['cw-h-goggles', 'cw-p-tube', 'cw-l-flask', 'cw-f-lab'],
  compile: ['cw-h-hardhat', 'cw-p-hammer', 'cw-f-bricks'],
  install: ['cw-f-box'],
  mail: ['cw-p-plane'],
  ponder: ['cw-b-board', 'cw-l-chalk'],
  fork: ['cw-b-twin', 'cw-glints'],
  accept: ['cw-o-parcel'],
  wait: ['cw-f-book'],
  knit: ['cw-f-knit'],
  doze: ['cw-zzz', 'cw-mouth'],
  cheer: ['cw-glints'],
  facepalm: ['cw-sweat'],
  timer: ['cw-p-timer'],
  compact: ['cw-f-compactor'],
};
const showCss = Object.entries(SHOW)
  .map(([mood, groups]) => `${groups.map(g => `.m-${mood} .${g}`).join(', ')} { display: inline; }`)
  .join('\n');

/*
 * Lengths inside SVG transforms are user units (1 unit = one Clawd pixel), so the
 * keyframes below move things by whole "pixels" where it matters.
 */
export const CLAWD_CSS = `
.cw-svg { overflow: visible; display: block; }
.cw-svg * { transform-box: view-box; }
.cw-svg text { shape-rendering: auto; }
.cw-all { transform-origin: 8px 10px; animation: cw-bob 2.6s ease-in-out infinite; }
.cw-look { animation: cw-look 9s steps(1) infinite; }
.cw-eyes { transform-origin: 8px 3px; animation: cw-blink 4.3s infinite; }
.cw-al { transform-origin: 2px 5px; }
.cw-ar { transform-origin: 14px 5px; }
.cw-prop, .cw-lprop, .cw-hat, .cw-over, .cw-front, .cw-bubble, .cw-heart, .cw-sweat,
.cw-notes, .cw-glugs, .cw-glints, .cw-sparks, .cw-zap, .cw-cloud, .cw-tears, .cw-zzz, .cw-mouth { display: none; }
${showCss}

@keyframes cw-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.5px); } }
@keyframes cw-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.15); } }
@keyframes cw-look { 0% { transform: none; } 45% { transform: translateX(-1px); } 60% { transform: translateX(1px); } 75% { transform: none; } }
@keyframes cw-step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes cw-hop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
@keyframes cw-dots { 0%, 100% { opacity: .25; } 40% { opacity: 1; } }
@keyframes cw-float { 0% { opacity: 0; transform: translateY(1px); } 25% { opacity: 1; } 100% { opacity: 0; transform: translateY(-5px); } }
@keyframes cw-blinkfx { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
@keyframes cw-scan { 0%, 100% { transform: translate(0, .5px); } 50% { transform: translate(1px, .5px); } }
@keyframes cw-shake { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(.3px); } }

/* walking: legs alternate in whole pixels */
.m-walk .cw-all, .m-fetch .cw-all { animation: cw-hop .32s steps(2) infinite; }
.m-walk .cw-l1, .m-walk .cw-l3, .m-fetch .cw-l1, .m-fetch .cw-l3 { animation: cw-step .32s steps(2) infinite; }
.m-walk .cw-l2, .m-walk .cw-l4, .m-fetch .cw-l2, .m-fetch .cw-l4 { animation: cw-step .32s steps(2) -.16s infinite; }
.m-walk .cw-look { animation: none; transform: translateX(1px); }

/* thinking: eyes up, bubble with dots */
.m-think .cw-bubble { display: inline; }
.m-think .cw-look { animation: none; transform: translate(1px, -1px); }
.cw-dot { animation: cw-dots 1.2s infinite; }
.cw-d2 { animation-delay: .2s; } .cw-d3 { animation-delay: .4s; }

/* reading: holds a sheet, eyes scan it */
.m-read .cw-ar { transform: translateY(-1px); }
.m-read .cw-look { animation: cw-scan 1.4s steps(2) infinite; }

/* searching: sweeps the magnifying glass */
@keyframes cw-sweep { 0%, 100% { transform: rotate(-25deg); } 50% { transform: rotate(20deg); } }
.m-search .cw-ar { animation: cw-sweep 1.3s ease-in-out infinite; }
.m-search .cw-look { animation: cw-scan 1.3s steps(2) infinite; }

/* oil painting: palette in one hand, brush strokes with the other, beret on */
@keyframes cw-stroke { 0% { transform: rotate(-35deg); } 100% { transform: rotate(15deg); } }
.m-paint .cw-ar, .m-canvas .cw-ar { animation: cw-stroke .45s ease-in-out infinite alternate; }
.m-paint .cw-look { animation: none; transform: translateX(1px); }
.m-paint .cw-al { transform: translateY(-1px); }
.m-canvas .cw-look { animation: none; transform: translateX(-1px); }

/* spray paint: shades on, can shakes, mist puffs */
@keyframes cw-rattle { 0%, 100% { transform: rotate(-12deg) translateY(0); } 50% { transform: rotate(8deg) translateY(-.5px); } }
.m-spray .cw-ar { animation: cw-rattle .2s steps(2) infinite; }
.cw-mist { animation: cw-blinkfx .5s steps(2) infinite; }
.cw-m2 { animation-delay: .17s; } .cw-m3 { animation-delay: .33s; }

/* typography: holds up an "Aa" sign that pulses bigger */
@keyframes cw-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }
.m-font .cw-p-sign { transform-origin: 16.7px 0; animation: cw-pulse 1s ease-in-out infinite; }
.m-font .cw-ar { transform: rotate(-10deg); }

/* writing: pencil taps on the notepad, eyes down */
@keyframes cw-tap { 0% { transform: translateY(0) rotate(10deg); } 100% { transform: translateY(1px) rotate(25deg); } }
.m-write .cw-ar { animation: cw-tap .14s steps(2) infinite alternate; }
.m-write .cw-look, .m-font .cw-look { animation: none; transform: translate(-1px, 1px); }

/* erasing: rubs back and forth */
@keyframes cw-rub { 0% { transform: translate(-1px, 0); } 100% { transform: translate(1px, .5px); } }
.m-erase .cw-ar { animation: cw-rub .16s steps(2) infinite alternate; }
.m-erase .cw-all { animation: cw-shake .16s infinite; }

/* removing: vacuum cleaner rumbles */
.m-remove .cw-all { animation: cw-shake .1s infinite; }
@keyframes cw-suck { 0%, 100% { transform: rotate(-20deg); } 50% { transform: rotate(-35deg); } }
.m-remove .cw-ar { animation: cw-suck .4s ease-in-out infinite; }
.m-remove .cw-f-vacuum { animation: cw-shake .08s infinite; }

/* building: hard hat, hammer bonks with a squash on impact */
@keyframes cw-bonk { 0%, 55% { transform: rotate(-80deg); } 75% { transform: rotate(20deg); } 100% { transform: rotate(-80deg); } }
@keyframes cw-squash { 0%, 70%, 100% { transform: scale(1, 1); } 78% { transform: scale(1.06, .92); } }
.m-build .cw-ar { animation: cw-bonk .7s ease-in infinite; }
.m-build .cw-all { animation: cw-squash .7s infinite; }

/* measuring: tape extends and snaps back */
@keyframes cw-tape { 0%, 100% { transform: scaleX(.2); } 60% { transform: scaleX(1.6); } }
.m-measure .cw-tape { transform-origin: 18px 4.7px; animation: cw-tape 1.6s ease-in-out infinite; }
.m-measure .cw-look { animation: none; transform: translateX(1px); }

/* adding: carries a new block overhead */
.m-add .cw-arm, .m-fetch .cw-arm, .m-stash .cw-al { transform: translateY(-3px); }
.m-add .cw-all { animation: cw-hop .5s steps(2) infinite; }
.m-stash .cw-ar { transform: rotate(-30deg); }
@keyframes cw-turn { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(-60deg); } }
.m-stash .cw-p-key { transform-origin: 16px 3px; animation: cw-turn .8s steps(2) infinite; }

/* wiring behaviour: wrench twists, sparks fly */
@keyframes cw-twist { 0% { transform: rotate(-30deg); } 100% { transform: rotate(25deg); } }
.m-wire .cw-ar { animation: cw-twist .22s steps(2) infinite alternate; }
.m-tinker .cw-ar { animation: cw-twist .6s ease-in-out infinite alternate; }
.cw-spark { animation: cw-blinkfx .3s steps(2) infinite; }
.cw-sp2 { animation-delay: .15s; }

/* hacking: shades, laptop, both hands typing, matrix bits flicker */
@keyframes cw-type { 0% { transform: translateY(1px); } 100% { transform: translateY(2px); } }
.m-hack .cw-al { animation: cw-type .12s steps(2) infinite alternate; }
.m-hack .cw-ar { animation: cw-type .12s steps(2) -.06s infinite alternate; }
.m-hack .cw-all { animation: none; }
.cw-bit { animation: cw-blinkfx .6s steps(2) infinite; }
.cw-b1 { animation-delay: .2s; } .cw-b2 { animation-delay: .4s; }

/* keeping watch: binoculars sweep */
.m-watch .cw-hats { animation: cw-scan 2s steps(4) infinite; }
.m-watch .cw-arm { transform: translateY(-2px); }

/* animations/transitions: headphones on, dancing */
@keyframes cw-dance { 0%, 100% { transform: rotate(-6deg) translateY(0); } 50% { transform: rotate(6deg) translateY(-1px); } }
.m-dance .cw-all { animation: cw-dance .5s ease-in-out infinite; }
.m-dance .cw-al { animation: cw-wave .5s steps(2) infinite; }
.m-dance .cw-ar { animation: cw-wave .5s steps(2) -.25s infinite; }
.cw-note { animation: cw-float 1.4s ease-out infinite; }
.cw-n2 { animation-delay: .7s; }

/* photos: camera flash */
@keyframes cw-burst { 0%, 80%, 100% { opacity: 0; } 85% { opacity: 1; } }
.cw-flashburst { animation: cw-burst 1.6s infinite; }
.m-photo .cw-ar { transform: translateY(-1px); }
.m-photo .cw-eyes { animation: cw-wink 1.6s infinite; }
@keyframes cw-wink { 0%, 80%, 100% { transform: scaleY(1); } 85% { transform: scaleY(.15); } }

/* polishing: sponge circles, glints */
@keyframes cw-circle { 0% { transform: translate(0, 0); } 25% { transform: translate(1px, -.5px); } 50% { transform: translate(0, -1px); } 75% { transform: translate(-1px, -.5px); } 100% { transform: translate(0, 0); } }
.m-polish .cw-ar { animation: cw-circle .5s linear infinite; }
.cw-glint { animation: cw-blinkfx 1s steps(2) infinite; }
.cw-gl2 { animation-delay: .33s; } .cw-gl3 { animation-delay: .66s; }

/* water break (3s, once): hand to the face, cap at the mouth, tip it back as it empties.
   The arm moves the hand in front of the face; the bottle pivots on its cap, which
   lands at (9.6, 4.6) — where Clawd's mouth would be, just under his eyes. */
@keyframes cw-sip { 0%, 100% { transform: none; } 14%, 86% { transform: translate(-3px, -.5px); } }
@keyframes cw-tip {
  0%, 100% { transform: none; }
  14% { transform: translate(-3.5px, 8.6px) rotate(-100deg); }
  50% { transform: translate(-3.5px, 8.6px) rotate(-122deg); }
  86% { transform: translate(-3.5px, 8.6px) rotate(-138deg); }
}
.m-water .cw-ar { animation: cw-sip 3s ease-in-out forwards; }
.m-water .cw-p-bottle { transform-origin: 16.1px -3.5px; animation: cw-tip 3s ease-in-out forwards; }
.m-water .cw-eyes { animation: none; transform: scaleY(.15); }
.m-water .cw-all { animation: cw-bob 1.2s ease-in-out infinite; }
@keyframes cw-drain { 0%, 14% { transform: scaleY(1); } 86%, 100% { transform: scaleY(3.6); } }
.m-water .cw-water-air { transform-origin: 16px -3px; animation: cw-drain 3s ease-in forwards; }
.cw-glug { animation: cw-float .9s ease-out infinite; animation-delay: .5s; }
.cw-g2 { animation-delay: .8s; } .cw-g3 { animation-delay: 1.1s; }

/* tossing the empty bottle: wind up and fling (the flying bottle is drawn separately) */
@keyframes cw-throw { 0% { transform: rotate(35deg); } 60% { transform: rotate(35deg); } 100% { transform: rotate(-150deg); } }
.m-throw .cw-ar { animation: cw-throw .45s cubic-bezier(.5, 0, .9, .4) forwards; }
.m-throw .cw-water-air { transform-origin: 16px -3px; transform: scaleY(3.6); }
.m-throw .cw-look { animation: none; transform: translate(1px, -1px); }

/* the page broke: rain cloud, tears, droopy everything */
@keyframes cw-rainfall { 0% { opacity: 0; transform: translateY(0); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(4px); } }
@keyframes cw-cry { 0% { opacity: 0; transform: translateY(0); } 25% { opacity: 1; } 100% { opacity: 0; transform: translateY(3.5px); } }
@keyframes cw-mope { 0%, 100% { transform: translateY(.8px) rotate(-2deg); } 50% { transform: translateY(1px) rotate(2deg); } }
.m-sad .cw-cloud, .m-sad .cw-tears { display: inline; }
.m-sad .cw-all { animation: cw-mope 2.4s ease-in-out infinite; }
.m-sad .cw-arm { transform: translateY(1.5px); }
.m-sad .cw-look { animation: none; transform: translateY(1px); }
.m-sad .cw-eyes { animation: none; transform: scaleY(.45); }
.cw-rain { animation: cw-rainfall .7s linear infinite; }
.cw-r2 { animation-delay: .25s; } .cw-r3 { animation-delay: .5s; }
.cw-tear { animation: cw-cry 1.1s ease-in infinite; }
.cw-t2 { animation-delay: .55s; }

/* running the tests: ticks off a checklist */
@keyframes cw-chk0 { 0%, 8% { opacity: 0; } 9%, 94% { opacity: 1; } 95%, 100% { opacity: 0; } }
@keyframes cw-chk1 { 0%, 38% { opacity: 0; } 39%, 94% { opacity: 1; } 95%, 100% { opacity: 0; } }
@keyframes cw-chk2 { 0%, 68% { opacity: 0; } 69%, 94% { opacity: 1; } 95%, 100% { opacity: 0; } }
.m-test .cw-c0 { animation: cw-chk0 2.6s steps(1) infinite; }
.m-test .cw-c1 { animation: cw-chk1 2.6s steps(1) infinite; }
.m-test .cw-c2 { animation: cw-chk2 2.6s steps(1) infinite; }
.m-test .cw-al { transform: translateY(-1px); }
.m-test .cw-ar { animation: cw-tap .26s steps(2) infinite alternate; }
.m-test .cw-look { animation: none; transform: translate(-1px, 1px); }

/* ...or, half the time, brewing in the lab: goggles on, tipping a test tube into a flask
   that bubbles, steams and changes colour over a Bunsen burner */
@keyframes cw-pour { 0%, 100% { transform: rotate(36deg); } 50% { transform: rotate(44deg); } }
@keyframes cw-bubble { 0% { opacity: 0; transform: translateY(1px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-2.5px); } }
@keyframes cw-brew { 0%, 100% { fill: #5ccf6a; } 33% { fill: #4aa3ff; } 66% { fill: #b46be0; } }
@keyframes cw-flicker { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(.85, 1.2); } }
@keyframes cw-fall { 0% { opacity: 0; transform: none; } 15% { opacity: 1; } 80% { opacity: 1; transform: translateY(2.8px); } 100% { opacity: 0; transform: translateY(3px); } }
.m-lab .cw-ar { animation: cw-pour 1.2s ease-in-out infinite; }
.cw-potion { fill: #5ccf6a; }
.m-lab .cw-potion { animation: cw-brew 4.5s linear infinite; }
.m-lab .cw-flame { transform-origin: 18px 7.9px; animation: cw-flicker .25s steps(2) infinite; }
.m-lab .cw-fizz { animation: cw-bubble .8s ease-out infinite; }
.m-lab .cw-fz2 { animation-delay: .27s; } .m-lab .cw-fz3 { animation-delay: .53s; }
.m-lab .cw-steam { animation: cw-float 1.6s ease-out infinite; }
.m-lab .cw-st2 { animation-delay: .8s; }
.m-lab .cw-pourdrop { animation: cw-fall .6s ease-in infinite; }
.m-lab .cw-al { transform: translateY(-1px); }
.m-lab .cw-bub { animation: cw-bubble 1s ease-out infinite; }
.m-lab .cw-bub2 { animation-delay: .33s; } .m-lab .cw-bub3 { animation-delay: .66s; }
.m-lab .cw-look { animation: none; transform: translate(1px, -1px); }

/* building the project: hard hat, hammers away while the wall grows */
@keyframes cw-row1 { 0%, 32% { opacity: 0; } 33%, 100% { opacity: 1; } }
@keyframes cw-row2 { 0%, 65% { opacity: 0; } 66%, 100% { opacity: 1; } }
.m-compile .cw-ar { animation: cw-bonk .7s ease-in infinite; }
.m-compile .cw-all { animation: cw-squash .7s infinite; }
.m-compile .cw-row1 { animation: cw-row1 2.7s steps(1) infinite; }
.m-compile .cw-row2 { animation: cw-row2 2.7s steps(1) infinite; }
.m-compile .cw-look { animation: none; transform: translateX(1px); }

/* installing packages: digs through a parcel, things pop out */
@keyframes cw-dig { 0% { transform: translateY(1px); } 100% { transform: translateY(-1.5px); } }
@keyframes cw-popout { 0% { opacity: 0; transform: translateY(2px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-5px); } }
.m-install .cw-al { animation: cw-dig .3s steps(2) infinite alternate; }
.m-install .cw-ar { animation: cw-dig .3s steps(2) -.15s infinite alternate; }
.m-install .cw-item { animation: cw-popout 1.5s ease-out infinite; }
.m-install .cw-i1 { animation-delay: .5s; } .m-install .cw-i2 { animation-delay: 1s; }
.m-install .cw-look { animation: none; transform: translateY(1px); }

/* git push/pull: folds and flings paper planes */
@keyframes cw-fling { 0%, 50% { transform: rotate(30deg); } 62% { transform: rotate(-70deg); } 100% { transform: rotate(30deg); } }
@keyframes cw-fly { 0%, 58% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translate(9px, -9px); } }
.m-mail .cw-ar { animation: cw-fling 1.8s ease-in infinite; }
.m-mail .cw-plane { animation: cw-fly 1.8s ease-in infinite; }
.m-mail .cw-look { animation: none; transform: translate(1px, -1px); }

/* thinking hard: paces in front of a chalkboard, hand on chin */
@keyframes cw-pace { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
@keyframes cw-chalk { 0% { opacity: 0; } 8%, 92% { opacity: 1; } 100% { opacity: 0; } }
.m-ponder .cw-all { animation: cw-pace 4s ease-in-out infinite; }
/* ...while the board (inside the same group) stands still: the exact opposite motion */
@keyframes cw-unpace { 0%, 100% { transform: translateX(2px); } 50% { transform: translateX(-2px); } }
.m-ponder .cw-b-board { animation: cw-unpace 4s ease-in-out infinite; }
.m-ponder .cw-l1, .m-ponder .cw-l3 { animation: cw-step .5s steps(2) infinite; }
.m-ponder .cw-l2, .m-ponder .cw-l4 { animation: cw-step .5s steps(2) -.25s infinite; }
.m-ponder .cw-ar { transform: translate(-4px, 0); }
/* a hand in front of his own body: a shade darker, or it disappears */
.m-ponder .cw-ar > rect, .m-facepalm .cw-ar > rect { filter: brightness(.8); }
.m-ponder .cw-look { animation: none; transform: translate(1px, -1px); }
.m-ponder .cw-chalk { opacity: 0; animation: cw-chalk 8s steps(1) infinite; }
.m-ponder .cw-k1 { animation-delay: 1.6s; } .m-ponder .cw-k2 { animation-delay: 3.2s; } .m-ponder .cw-k3 { animation-delay: 4.8s; }

/* ...writing on it with a stick of chalk */
@keyframes cw-scribble { 0% { transform: translate(-.4px, -2.6px); } 50% { transform: translate(.4px, -2.2px); } 100% { transform: translate(-.2px, -2.4px); } }
.m-ponder .cw-al { animation: cw-scribble .35s steps(3) infinite; }

/* forking a helper: strains, and a copy of him slides out and shrinks to baby size */
@keyframes cw-strain { 0%, 100% { transform: scale(1, 1); } 30% { transform: scale(1.08, .9); } 45% { transform: scale(.94, 1.06); } 60% { transform: scale(1, 1); } }
@keyframes cw-split { 0%, 22% { opacity: 0; transform: none; } 30% { opacity: 1; transform: translateX(-2px); }
  70% { opacity: 1; transform: translateX(-10px) scale(.48); } 74%, 100% { opacity: 0; transform: translateX(-10px) scale(.48); } }
.m-fork .cw-all { animation: cw-strain 1.5s ease-in-out 1; }
.m-fork .cw-b-twin { transform-origin: 8px 10px; animation: cw-split 1.5s ease-in-out forwards; }
.m-fork .cw-eyes { animation: none; transform: scaleY(.3); }
.m-fork .cw-arm { transform: translateY(-1px); }

/* a helper's coming back: arms out for its parcel */
@keyframes cw-reach { 0%, 100% { transform: translate(0, -1.5px); } 50% { transform: translate(0, -2.5px); } }
.m-expect .cw-al { animation: cw-reach .6s ease-in-out infinite; }
.m-expect .cw-ar { animation: cw-reach .6s ease-in-out -.3s infinite; }
.m-expect .cw-look { animation: none; transform: translateX(-1px); }
/* ...and takes it: parcel overhead, a happy hop, hearts */
.m-accept .cw-arm { transform: translateY(-3px); }
.m-accept .cw-all { animation: cw-jump .75s ease-in-out infinite; }
.m-accept .cw-eyes { animation: none; transform: scaleY(.5); }
.m-accept .cw-heart { display: inline; animation: cw-float 1.4s ease-out infinite; }
.m-accept .cw-hh2 { animation-delay: .45s; } .m-accept .cw-hh3 { animation-delay: .9s; }

/* a long wait: sits down with a book, or some knitting */
.cw-leg { transform-origin: 0 10px; }
.m-wait .cw-all, .m-knit .cw-all { animation: none; transform: translateY(1px); }
.m-wait .cw-leg, .m-knit .cw-leg, .m-doze .cw-leg { transform: scaleY(.5); }
.m-wait .cw-arm { transform: translateY(1px); }
.m-wait .cw-look { animation: cw-scan 2.4s steps(2) infinite; }
@keyframes cw-pageflip { 0%, 84% { transform: scaleX(1); } 92% { transform: scaleX(0); } 100% { transform: scaleX(-1); } }
.m-wait .cw-page { transform-origin: 8px 6px; animation: cw-pageflip 5s ease-in-out infinite; }
@keyframes cw-knitl { 0% { transform: rotate(-7deg); } 100% { transform: rotate(5deg); } }
@keyframes cw-grow { 0% { transform: scaleY(.3); } 100% { transform: scaleY(1.3); } }
@keyframes cw-roll { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(.4px); } }
.m-knit .cw-arm { transform: translateY(.5px); }
.m-knit .cw-nl { transform-origin: 8px 6.3px; animation: cw-knitl .19s steps(2) infinite alternate; }
.m-knit .cw-nr { transform-origin: 8px 6.3px; animation: cw-knitl .19s steps(2) -.1s infinite alternate-reverse; }
.m-knit .cw-scarf { transform-origin: 8px 7px; animation: cw-grow 30s linear infinite; }
.m-knit .cw-yarn { animation: cw-roll .8s steps(2) infinite; }
.m-knit .cw-look { animation: none; transform: translateY(1px); }

/* a very long wait: yawns, nods off */
@keyframes cw-breathe { 0%, 100% { transform: translateY(1px) scale(1, 1); } 50% { transform: translateY(1px) scale(1.03, .97); } }
@keyframes cw-yawnmouth { 0% { transform: scale(0); } 25%, 45% { transform: scale(1, 1.3); } 60%, 100% { transform: scale(0); } }
@keyframes cw-zfloat { 0% { opacity: 0; transform: translate(0, 1px); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(1.5px, -3px); } }
.m-doze .cw-all { animation: cw-breathe 3.2s ease-in-out infinite; }
.m-doze .cw-eyes { animation: none; transform: scaleY(.15); }
.m-doze .cw-look { animation: none; transform: translateY(1px); }
.m-doze .cw-arm { transform: translateY(1.5px); }
.m-doze .cw-mouth { transform-origin: 8px 5.6px; animation: cw-yawnmouth 3s ease-in-out forwards; }
.m-doze .cw-z { animation: cw-zfloat 3s ease-out infinite; animation-delay: 2.4s; opacity: 0; }
.m-doze .cw-z1 { animation-delay: 3.4s; } .m-doze .cw-z2 { animation-delay: 4.4s; }

/* it worked: fist pump */
@keyframes cw-pump { 0% { transform: translateY(-2px) rotate(0); } 100% { transform: translateY(-4.5px) rotate(-12deg); } }
.m-cheer .cw-all { animation: cw-jump .7s ease-in-out infinite; }
.m-cheer .cw-ar { animation: cw-pump .18s steps(2) infinite alternate; }
.m-cheer .cw-eyes { animation: none; transform: scaleY(.5); }

/* it didn't: facepalm */
@keyframes cw-tsk { 0%, 100% { transform: translateY(.6px) rotate(0); } 25% { transform: translateY(.6px) rotate(-3deg); } 75% { transform: translateY(.6px) rotate(3deg); } }
.m-facepalm .cw-all { animation: cw-tsk .7s ease-in-out 2; }
.m-facepalm .cw-ar { transform: translate(-4px, -2.5px); }
.m-facepalm .cw-al { transform: translateY(1px); }
.m-facepalm .cw-eyes { animation: none; transform: scaleY(.3); }
.m-facepalm .cw-sweat { display: inline; animation: cw-drip 1.6s ease-in infinite; }

/* background task: winds a kitchen timer */
@keyframes cw-dialturn { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }
.m-timer .cw-dial { transform-origin: 16.2px 2.6px; animation: cw-dialturn 1.2s steps(12) infinite; }
.m-timer .cw-ar { transform: translateY(-1.5px); }
.m-timer .cw-look { animation: none; transform: translateX(1px); }

/* compacting the conversation: the trash compactor squashes it */
@keyframes cw-press { 0%, 15%, 100% { transform: translateY(0); } 50%, 65% { transform: translateY(2.4px); } }
@keyframes cw-squish { 0%, 15%, 100% { transform: scaleY(1); } 50%, 65% { transform: scaleY(.35); } }
.m-compact .cw-piston { animation: cw-press 1.3s ease-in-out infinite; }
.m-compact .cw-wad { transform-origin: 18px 9.2px; animation: cw-squish 1.3s ease-in-out infinite; }
.m-compact .cw-ar { animation: cw-type .65s steps(2) infinite alternate; }
.m-compact .cw-eyes { animation: none; transform: scaleY(.5); }

/* tickled: giggles and wiggles */
@keyframes cw-giggle { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(7deg) translateY(-.5px); } }
.cw-tickle .cw-all { animation: cw-giggle .14s infinite !important; }
.cw-tickle .cw-eyes { animation: none !important; transform: scaleY(.3) !important; }
.cw-tickle .cw-arm { animation: cw-wave .2s steps(2) infinite !important; }
.cw-tickle .cw-heart { display: inline; animation: cw-float 1s ease-out infinite; }
.cw-tickle .cw-hh2 { animation-delay: .3s; } .cw-tickle .cw-hh3 { animation-delay: .6s; }

/* noticed the cursor: a little start */
@keyframes cw-start { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-2px) scale(1.04, .97); } }
.cw-notice .cw-all { animation: cw-start .35s ease-out 1; }

/* needs the user: waves a sign, taps a foot */
@keyframes cw-waggle { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
.m-wave .cw-ar { animation: cw-waggle .6s ease-in-out infinite; }
.m-wave .cw-al { animation: cw-wave .6s steps(2) infinite; }
.m-wave .cw-l4 { animation: cw-step .4s steps(2) infinite; }
.m-wave .cw-look { animation: none; transform: translateY(-.5px); }

/* done: happy jumps, arms up, hearts */
@keyframes cw-jump {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  12% { transform: translateY(0) scale(1.08, .9); }
  40% { transform: translateY(-3px) scale(.95, 1.06); }
  70% { transform: translateY(0) scale(1, 1); }
  80% { transform: translateY(0) scale(1.06, .93); }
}
@keyframes cw-wave { 0%, 100% { transform: translateY(-3px) rotate(0); } 50% { transform: translateY(-3px) rotate(-20deg); } }
.m-done .cw-all { animation: cw-jump .9s ease-in-out infinite; }
.m-done .cw-arm { animation: cw-wave .45s steps(2) infinite; }
.m-done .cw-eyes { animation: none; transform: scaleY(.5); }
.m-done .cw-heart { display: inline; animation: cw-float 1.8s ease-out infinite; }
.m-done .cw-hh2 { animation-delay: .6s; } .m-done .cw-hh3 { animation-delay: 1.2s; }

/* error: droops, sweats */
.m-error .cw-all { animation: none; transform: translateY(.6px); }
.m-error .cw-arm { transform: translateY(1px); }
.m-error .cw-look { animation: none; transform: translateY(1px); }
.m-error .cw-eyes { animation: none; transform: scaleY(.5); }
@keyframes cw-drip { 0% { opacity: 0; transform: translateY(0); } 20% { opacity: 1; } 100% { opacity: 0; transform: translateY(3px); } }
.m-error .cw-sweat { display: inline; animation: cw-drip 1.6s ease-in infinite; }

/* a click on Clawd */
.cw-poke .cw-all { animation: cw-jump .6s ease-in-out 1; }
.cw-poke .cw-hh1 { display: inline; animation: cw-float 1s ease-out 1; }

@media (prefers-reduced-motion: reduce) {
  .cw-svg * { animation-duration: 0s !important; animation-iteration-count: 1 !important; }
}
`;
