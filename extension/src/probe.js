/**
 * Chrome only, injected into the page's own world: finds React components for the
 * overlay (an isolated content script can't see React's fiber properties). The overlay
 * fires `clawd-find` with {names, token}; this marks the element with data-clawd-found.
 */
import { findComponentNode } from './fiber';

const visible = n => {
  if (!n || !n.getBoundingClientRect) return false;
  const r = n.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const cs = getComputedStyle(n);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};

if (!window.__clawdProbe) {
  window.__clawdProbe = true;
  document.addEventListener('clawd-find', e => {
    try {
      const { names, token } = JSON.parse(e.detail);
      const n = findComponentNode(names, x => x, visible);
      if (n) n.setAttribute('data-clawd-found', token);
    } catch { /* not a React page */ }
  });
}
