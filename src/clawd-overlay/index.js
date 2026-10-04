/**
 * Clawd on the page: injected into the tab being edited (tabs.executeScript) while a
 * Clawdify job runs. The background calls `window.__cmClawd(msg)` with:
 *   {op: 'act', kind, selectors, pattern, color, measure, label}  walk to the element
 *       the change touches and act it out (palette for colours, laptop for network…)
 *   {op: 'done' | 'error'}  celebrate / droop, then leave
 *   {op: 'hide'}            vanish at once (before DOM snapshots and screenshots)
 *
 * Everything lives in a closed shadow root on a fixed, click-through layer, built with
 * DOM APIs (no innerHTML) so it works on pages enforcing Trusted Types.
 */
import { CLAWD_CSS, VIEWBOX, clawdSpriteNode, setMood } from '@/common/clawd-art';
import { MOOD_LABEL } from '@/common/clawd-actions';

function install() {
  const SPRITE_W = 96; // px
  const UNIT = SPRITE_W / VIEWBOX.w; // px per Clawd pixel
  const SPRITE_H = Math.round(UNIT * VIEWBOX.h);
  const FOOT_X = (8 - VIEWBOX.x) * UNIT; // Clawd's centre, from sprite's left
  const FOOT_Y = (10 - VIEWBOX.y) * UNIT; // Clawd's feet, from sprite's top
  const SPEED = 520; // px/s walking
  const NO_TARGET = new Set(['think', 'read', 'fetch', 'hack', 'stash']);

  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; font: 12px/1.3 system-ui, sans-serif;
  --clawd: #d97757; --clawd-eye: #1f1e1d; --accent: #d97757; }
.layer.out { opacity: 0; transition: opacity .5s; }
.hl { position: absolute; display: none; border: 2px dashed var(--accent); border-radius: 6px;
  background: rgba(217, 119, 87, .06); box-shadow: 0 0 0 4px rgba(217, 119, 87, .12); overflow: hidden;
  transition: border-color .3s, background .3s; }
.hl.on { display: block; }
.hl.ok { border-color: #4f9a45; border-style: solid; background: rgba(79, 154, 69, .12); }
.sprite { position: absolute; left: 0; top: 0; width: ${SPRITE_W}px; height: ${SPRITE_H}px; will-change: transform;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.25)); }
.face { width: 100%; height: 100%; transition: transform .15s; }
.face.flip { transform: scaleX(-1); }
.face.flip .cw-sign-text { transform: scaleX(-1); transform-origin: 16.7px 0; } /* keep "Aa" readable */
.label { position: absolute; left: 50%; bottom: calc(100% + 2px); transform: translateX(-50%); white-space: nowrap;
  max-width: 260px; overflow: hidden; text-overflow: ellipsis; padding: 3px 9px; border-radius: 10px;
  background: #1f1e1d; color: #faf9f5; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.label:empty { display: none; }
.water { position: absolute; left: 50%; top: calc(100% + 2px); transform: translateX(-50%); white-space: nowrap;
  font-size: 10px; color: #3a7bd5; background: rgba(255,255,255,.9); border-radius: 8px; padding: 1px 6px; display: none; }
.water.on { display: block; }

/* effects inside the highlight box */
.fx { position: absolute; inset: 0; }
@keyframes sweep { 0% { transform: scaleX(0); opacity: .35; } 70% { transform: scaleX(1); opacity: .3; } 100% { transform: scaleX(1); opacity: 0; } }
.wash { position: absolute; inset: 0; transform-origin: left; animation: sweep 1.8s ease-in-out infinite; }
@keyframes drip { 0% { transform: translateY(-10px); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateY(40px); opacity: 0; } }
.drop { position: absolute; top: 0; width: 6px; height: 9px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%; animation: drip 1.4s ease-in infinite; }
@keyframes mist { 0% { transform: scale(.2); opacity: .8; } 100% { transform: scale(1.4); opacity: 0; } }
.puff { position: absolute; width: 22px; height: 22px; border-radius: 50%; filter: blur(3px); animation: mist 1.1s ease-out infinite; }
@keyframes fade { 0%, 100% { opacity: 0; } 50% { opacity: .45; } }
.stripes { position: absolute; inset: 0; background: repeating-linear-gradient(-45deg, rgba(250,249,245,.8) 0 8px, transparent 8px 16px); animation: fade 1.2s infinite; }
@keyframes fall { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(30px); opacity: 0; } }
.dust { position: absolute; bottom: 4px; width: 4px; height: 4px; background: #b9b5aa; animation: fall .9s ease-in infinite; }
@keyframes suck { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; } }
.bit { position: absolute; width: 8px; height: 8px; background: var(--accent); border-radius: 2px; animation: suck 1s ease-in infinite; }
@keyframes blink { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
.caret { position: absolute; left: 8px; top: 8px; width: 2px; height: 18px; background: #1f1e1d; animation: blink .8s steps(1) infinite; }
@keyframes pop { 0% { transform: translateY(6px) scale(.5); opacity: 0; } 30% { transform: none; opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
.glyph { position: absolute; font: 700 16px Georgia, serif; color: #1f1e1d; animation: pop 1.6s ease-out infinite; }
@keyframes wobble { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.02, .98); } 60% { transform: scale(.99, 1.01); } }
.hl.wobble { animation: wobble .7s infinite; }
.star { position: absolute; font-size: 16px; color: #f2c94c; animation: blink .7s steps(2) infinite; text-shadow: 0 0 4px #fff; }
.ruler { position: absolute; left: 0; right: 0; top: 50%; height: 0; border-top: 2px solid #3a7bd5; }
.ruler::before, .ruler::after { content: ""; position: absolute; top: -7px; width: 2px; height: 12px; background: #3a7bd5; }
.ruler::before { left: 0; } .ruler::after { right: 0; }
.measure { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -130%); background: #3a7bd5; color: #fff; padding: 2px 7px; border-radius: 6px; font: 600 11px ui-monospace, Consolas, monospace; }
.plus { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 700 28px system-ui; color: var(--accent); animation: blink 1s infinite; }
@keyframes rain { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
.matrix { position: absolute; inset: 0; background: rgba(0, 20, 6, .55); }
.col { position: absolute; top: 0; font: 12px/1 ui-monospace, Consolas, monospace; color: #36d15e; text-shadow: 0 0 4px #36d15e; writing-mode: vertical-rl; animation: rain 2.2s linear infinite; }
@keyframes ping { 0% { transform: translate(-50%, -50%) scale(0); opacity: .8; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 0; } }
.radar { position: absolute; left: 50%; top: 50%; width: 160%; aspect-ratio: 1; border: 2px solid #4f9a45; border-radius: 50%; animation: ping 1.8s ease-out infinite; }
@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.hl.bounce { animation: bounce .5s ease-in-out infinite; }
.note { position: absolute; font-size: 18px; color: var(--accent); animation: pop 1.4s ease-out infinite; }
@keyframes flash { 0%, 80%, 100% { opacity: 0; } 84% { opacity: .9; } }
.flash { position: absolute; inset: 0; background: #fff; animation: flash 1.6s infinite; }
@keyframes scanline { 0% { top: 0; } 100% { top: 100%; } }
.scan { position: absolute; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, transparent, var(--accent), transparent); box-shadow: 0 0 8px var(--accent); animation: scanline 1.3s ease-in-out infinite alternate; }
.spark { position: absolute; font-size: 15px; animation: blink .35s steps(2) infinite; }
.gear { position: absolute; right: 6px; top: 6px; font-size: 18px; color: #6b7078; animation: spin 2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.ok-tick { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font: 700 30px system-ui; color: #4f9a45; }
${CLAWD_CSS}`;

  let host, layer, hl, fxEl, sprite, face, svg, label, waterEl;
  let target = null;
  let action = null;
  let pos = null; // sprite top-left
  let lastT = 0;
  let raf = 0;
  let mood = 'idle';
  let actMood = 'idle';
  let leaveTimer = 0;
  let waterUntil = 0;
  let nextWater = 0;
  let litres = 0;

  const el = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };

  function build() {
    host = document.createElement('clawdify-overlay');
    const st = host.style;
    st.setProperty('all', 'initial', 'important');
    st.setProperty('position', 'fixed', 'important');
    st.setProperty('inset', '0', 'important');
    st.setProperty('z-index', '2147483647', 'important');
    st.setProperty('pointer-events', 'none', 'important');
    st.setProperty('display', 'block', 'important');
    const root = host.attachShadow({ mode: 'closed' });
    el('style', null, root, STYLE);
    layer = el('div', 'layer', root);
    hl = el('div', 'hl', layer);
    fxEl = el('div', 'fx', hl);
    sprite = el('div', 'sprite', layer);
    face = el('div', 'face', sprite);
    svg = clawdSpriteNode(document, SPRITE_W);
    face.appendChild(svg);
    label = el('div', 'label', sprite);
    waterEl = el('div', 'water', sprite);
  }

  function ensure() {
    if (!host) build();
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    layer.classList.remove('out');
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
  }

  function hide() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(leaveTimer);
    if (host) host.remove();
    pos = null;
  }

  function visible(n) {
    if (!n || n === host || !n.getBoundingClientRect) return false;
    const r = n.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function firstVisible(sel) {
    let list;
    try { list = document.querySelectorAll(sel); } catch { return null; }
    for (const n of list) if (visible(n)) return n;
    return null;
  }

  function findByText(text) {
    if (!text || text.length < 3) return null;
    const needle = text.toLowerCase();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), i = 0; n && i < 20000; n = walker.nextNode(), i++) {
      if (n.data.toLowerCase().includes(needle) && visible(n.parentElement)) return n.parentElement;
    }
    return null;
  }

  function findTarget(a) {
    for (const s of a.selectors || []) {
      const n = firstVisible(s);
      if (n) return n;
    }
    if (a.pattern) {
      const p = a.pattern;
      const n = firstVisible(p);
      if (n) return n;
      const tokens = (p.match(/[A-Za-z][\w-]{2,}/g) || []).slice(0, 6);
      for (const t of tokens) {
        const m = firstVisible(`#${CSS.escape(t)}`) || firstVisible(`.${CSS.escape(t)}`)
          || firstVisible(`[class*="${t}" i]`) || firstVisible(`[id*="${t}" i]`);
        if (m) return m;
      }
      return findByText(p.replace(/\\[sdwb]|[\\^$.*+?()[\]{}|]/g, ' ').trim().split(/\s{2,}/)[0]);
    }
    return null;
  }

  function vp() { return { w: window.innerWidth, h: window.innerHeight }; }

  /** Where the sprite should stand: on the target's top edge, else bottom-right. */
  function destination() {
    const { w, h } = vp();
    let fx, fy;
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      fx = r.left + Math.min(56, r.width / 2);
      fy = r.top > SPRITE_H + 24 ? r.top + 4 : Math.min(r.bottom, r.top + SPRITE_H + 12);
    } else {
      fx = w - 70;
      fy = h - 14;
    }
    fx = Math.max(FOOT_X + 4, Math.min(w - (SPRITE_W - FOOT_X) - 4, fx));
    fy = Math.max(FOOT_Y + 26, Math.min(h - 6, fy));
    return { x: fx - FOOT_X, y: fy - FOOT_Y };
  }

  function placeHighlight() {
    if (!target || !target.isConnected || !action) {
      hl.classList.remove('on');
      return;
    }
    const { w, h } = vp();
    const r = target.getBoundingClientRect();
    const l = Math.max(2, r.left - 4);
    const t = Math.max(2, r.top - 4);
    const rr = Math.min(w - 2, r.right + 4);
    const b = Math.min(h - 2, r.bottom + 4);
    if (rr - l < 8 || b - t < 8) { hl.classList.remove('on'); return; }
    hl.style.left = `${l}px`;
    hl.style.top = `${t}px`;
    hl.style.width = `${rr - l}px`;
    hl.style.height = `${b - t}px`;
    hl.classList.add('on');
  }

  function show(m) {
    if (m === mood) return;
    mood = m;
    setMood(svg, m);
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const dest = destination();
    if (!pos) pos = { x: vp().w + 20, y: dest.y }; // walk in from the right edge
    const dx = dest.x - pos.x;
    const dy = dest.y - pos.y;
    const dist = Math.hypot(dx, dy);
    const walking = dist > (mood === 'walk' ? 2 : 36);
    if (walking) {
      const step = Math.min(dist, SPEED * dt);
      pos.x += dx / dist * step;
      pos.y += dy / dist * step;
      if (Math.abs(dx) > 2) face.classList.toggle('flip', dx < 0);
      show('walk');
    } else {
      // Small drifts (scrolling a little) are followed without breaking into a walk.
      if (dist > 0.5) { pos.x += dx * 0.3; pos.y += dy * 0.3; }
      const busy = !['done', 'error', 'idle'].includes(actMood);
      if (busy && now > nextWater && !waterUntil) {
        waterUntil = now + 3200;
        litres += 0.5;
        waterEl.textContent = `💧 ${litres.toFixed(1)} L`;
        waterEl.classList.add('on');
      }
      if (waterUntil && now > waterUntil) {
        waterUntil = 0;
        nextWater = now + 22000 + Math.random() * 20000;
        waterEl.classList.remove('on');
        label.textContent = action ? action.label : '';
      }
      if (waterUntil) {
        label.textContent = MOOD_LABEL.water;
        show('water');
      } else {
        show(actMood);
      }
    }
    sprite.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
    placeHighlight();
  }

  /** Effects drawn over the element being worked on, by kind of change. */
  function effects(a) {
    fxEl.replaceChildren();
    hl.classList.remove('wobble', 'bounce', 'ok');
    const color = a.color && CSS.supports('color', a.color) ? a.color : '#d97757';
    hl.style.setProperty('--paint', color);
    svg.style.setProperty('--paint', color);
    const rnd = (min, max) => min + Math.random() * (max - min);
    const at = (n, l, t) => { n.style.left = l; n.style.top = t; return n; };
    switch (a.kind) {
    case 'paint': {
      el('div', 'wash', fxEl).style.background = color;
      for (let i = 0; i < 5; i++) {
        const d = at(el('div', 'drop', fxEl), `${10 + i * 19}%`, '0');
        d.style.background = color;
        d.style.animationDelay = `${i * 0.27}s`;
      }
      break;
    }
    case 'spray':
      for (let i = 0; i < 7; i++) {
        const p = at(el('div', 'puff', fxEl), `${rnd(5, 90)}%`, `${rnd(5, 80)}%`);
        p.style.background = color;
        p.style.animationDelay = `${i * 0.16}s`;
      }
      break;
    case 'erase':
      el('div', 'stripes', fxEl);
      for (let i = 0; i < 6; i++) at(el('div', 'dust', fxEl), `${rnd(5, 95)}%`, 'auto').style.animationDelay = `${rnd(0, 0.9)}s`;
      break;
    case 'remove': {
      // bits get sucked toward Clawd's nozzle at the top-left corner
      for (let i = 0; i < 9; i++) {
        const b = at(el('div', 'bit', fxEl), `${rnd(20, 90)}%`, `${rnd(20, 90)}%`);
        b.style.setProperty('--dx', `${-rnd(40, 160)}px`);
        b.style.setProperty('--dy', `${-rnd(20, 90)}px`);
        b.style.animationDelay = `${rnd(0, 1)}s`;
      }
      break;
    }
    case 'write':
    case 'font': {
      el('div', 'caret', fxEl);
      const glyphs = a.kind === 'font' ? ['A', 'a', 'Ag', 'Aa'] : ['a', 'b', 'c', '✎'];
      glyphs.forEach((g, i) => {
        const n = at(el('div', 'glyph', fxEl, g), `${12 + i * 18}%`, '30%');
        if (a.kind === 'font') n.style.fontSize = `${14 + i * 5}px`;
        n.style.animationDelay = `${i * 0.35}s`;
      });
      break;
    }
    case 'build':
      hl.classList.add('wobble');
      ['✦', '✧', '✦'].forEach((s, i) => at(el('div', 'star', fxEl, s), `${8 + i * 6}%`, `${6 + i * 9}%`).style.animationDelay = `${i * 0.2}s`);
      break;
    case 'measure':
      el('div', 'ruler', fxEl);
      el('div', 'measure', fxEl, a.measure || '↔ resizing');
      break;
    case 'add':
      el('div', 'plus', fxEl, '+');
      for (let i = 0; i < 6; i++) at(el('div', 'star', fxEl, '✦'), `${rnd(5, 90)}%`, `${rnd(5, 80)}%`).style.animationDelay = `${rnd(0, 0.7)}s`;
      break;
    case 'wire':
      [['4%', '6%'], ['86%', '10%'], ['8%', '70%'], ['84%', '74%']].forEach(([l, t], i) => {
        at(el('div', 'spark', fxEl, '⚡'), l, t).style.animationDelay = `${i * 0.09}s`;
      });
      break;
    case 'hack': {
      el('div', 'matrix', fxEl);
      const chars = 'アイウエオカキクケコ01ﾊﾋﾌﾍﾎ<>{}#$';
      for (let i = 0; i < 14; i++) {
        let s = '';
        for (let j = 0; j < 14; j++) s += chars[Math.floor(Math.random() * chars.length)];
        const c = at(el('div', 'col', fxEl, s), `${i * 7.2}%`, '0');
        c.style.animationDelay = `${-rnd(0, 2.2)}s`;
        c.style.animationDuration = `${rnd(1.6, 3)}s`;
      }
      break;
    }
    case 'watch':
      el('div', 'radar', fxEl);
      el('div', 'radar', fxEl).style.animationDelay = '.9s';
      break;
    case 'dance':
      hl.classList.add('bounce');
      ['♪', '♫', '♪'].forEach((s, i) => at(el('div', 'note', fxEl, s), `${15 + i * 30}%`, '40%').style.animationDelay = `${i * 0.45}s`);
      break;
    case 'photo':
      el('div', 'flash', fxEl);
      break;
    case 'polish':
      for (let i = 0; i < 5; i++) at(el('div', 'star', fxEl, '✦'), `${rnd(3, 92)}%`, `${rnd(3, 85)}%`).style.animationDelay = `${rnd(0, 0.7)}s`;
      break;
    case 'search':
      el('div', 'scan', fxEl);
      break;
    default:
      el('div', 'gear', fxEl, '⚙');
    }
  }

  function act(a) {
    clearTimeout(leaveTimer);
    action = a;
    const t = findTarget(a);
    if (t) {
      target = t;
      const r = t.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vp().h) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (NO_TARGET.has(a.kind)) {
      target = null;
    } // else: keep standing at the previous target
    // Paint jobs with no element to stand on get an easel instead of a palette.
    actMood = a.kind === 'paint' && !target ? 'canvas' : a.kind;
    if (!nextWater) nextWater = performance.now() + 9000 + Math.random() * 9000;
    label.textContent = a.label || '';
    effects(a);
  }

  function finish(ok) {
    action = null;
    actMood = ok ? 'done' : 'error';
    waterUntil = 0;
    waterEl.classList.remove('on');
    label.textContent = MOOD_LABEL[actMood];
    fxEl.replaceChildren();
    hl.classList.remove('wobble', 'bounce');
    if (ok && target) {
      hl.classList.add('ok');
      el('div', 'ok-tick', fxEl, '✓');
    }
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      layer.classList.add('out');
      leaveTimer = setTimeout(hide, 600);
    }, ok ? 3200 : 4200);
  }

  window.__cmClawd = msg => {
    if (!msg || msg.op === 'hide') return hide();
    ensure();
    if (msg.op === 'act') act(msg);
    else if (msg.op === 'done') finish(true);
    else if (msg.op === 'error') finish(false);
  };
}

if (!window.__cmClawd) install();
