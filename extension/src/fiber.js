/**
 * Find the DOM element a React component renders, by component name. Dev builds of React
 * keep component names on the fiber tree hanging off DOM nodes. Shared by the overlay
 * (Firefox: it reads page objects through `wrappedJSObject`) and probe.js (Chrome: run in
 * the page's own world, since an isolated content script can't see React's properties).
 *
 * `raw(node)` gives the page's own view of a node; `visible(node)` says if it's on screen.
 */
export function findComponentNode(names, raw, visible) {
  if (!names || !names.length) return null;
  const want = new Set(names);
  let rootFiber = null;
  for (const n of [document.getElementById('root'), document.getElementById('app'), document.body, ...(document.body ? document.body.children : [])]) {
    const w = raw(n);
    if (!w) continue;
    let key;
    try { key = Object.keys(w).find(k => k.startsWith('__reactContainer$')); } catch { /* xray */ }
    if (key) { rootFiber = w[key]; break; }
  }
  if (!rootFiber) return null;
  const nameOf = f => {
    const t = f && f.type;
    if (!t || typeof t === 'string') return '';
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || '';
  };
  const hostNode = f => {
    for (let q = f, i = 0; q && i < 200; i++) {
      if (q.tag === 5 && q.stateNode && visible(q.stateNode)) return q.stateNode;
      q = q.child || (q === f ? null : nextOf(q, f));
    }
    return null;
  };
  const nextOf = (q, stop) => {
    while (q && q !== stop) {
      if (q.sibling) return q.sibling;
      q = q.return;
    }
    return null;
  };
  // One pass over the tree, then pick by the caller's priority (the most specific
  // component first; a parent like the file's own component is only a fallback).
  const found = new Map();
  const stack = [rootFiber.current || rootFiber];
  for (let seen = 0; stack.length && seen < 30000 && found.size < want.size; seen++) {
    const f = stack.pop();
    if (!f) continue;
    const nm = nameOf(f);
    if (want.has(nm) && !found.has(nm)) {
      const n = hostNode(f.child || f);
      if (n) found.set(nm, n);
    }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  for (const nm of names) if (found.has(nm)) return found.get(nm);
  return null;
}
