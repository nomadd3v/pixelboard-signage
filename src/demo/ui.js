// Demo build only: tiny DOM helpers. Everything user-controlled goes in via
// textContent / attributes — never innerHTML.

import { BASE } from './engine.js';

export const href = (p = '') => BASE + p;

/** h('div.cls#id', {props}, ...children) */
export function h(sel, props, ...kids) {
  const [, tag = 'div', rest = ''] = /^([a-z0-9]*)(.*)$/i.exec(sel);
  const n = document.createElement(tag || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') n.classList.add(m[2]); else n.id = m[2];
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n && k !== 'list' && k !== 'form') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return n;
}

export function wordmark(size = 26) {
  return h('a.pbd-logo', { href: href(''), title: 'Pixelboard demo home' },
    h('img', { src: href('branding/wordmark-dark.svg'), alt: 'Pixelboard', height: size, style: { height: size + 'px' } }));
}

export function demoTag() {
  return h('span.pbd-tag', 'Interactive demo');
}

export function relTime(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString();
}

let toastTimer;
export function toast(msg, kind = '') {
  let t = document.getElementById('pbd-toast');
  if (!t) { t = h('div#pbd-toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.className = 'show ' + kind;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

/** Scale a fixed-size board iframe into `box` (width-driven, capped by maxH). */
export function fitFrame(box, frame, w, h, maxH = Infinity) {
  const apply = () => {
    const cw = box.clientWidth;
    if (!cw) return;
    const s = Math.min(cw / w, maxH / h);
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    frame.style.transform = `scale(${s})`;
    frame.style.transformOrigin = '0 0';
    frame.style.marginLeft = Math.max(0, (cw - w * s) / 2) + 'px';
    box.style.height = Math.round(h * s) + 'px';
  };
  new ResizeObserver(apply).observe(box);
  apply();
  return apply;
}

export function boardFrame(html, { sandbox = true, title = 'Board' } = {}) {
  const f = h('iframe.pbd-frame', { title, tabIndex: -1, scrolling: 'no' });
  if (sandbox) f.setAttribute('sandbox', 'allow-same-origin'); // no scripts in published HTML
  f.srcdoc = html;
  return f;
}
