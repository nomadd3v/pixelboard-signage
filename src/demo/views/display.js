// The screen: fullscreen kiosk showing the LATEST published snapshot — the demo
// equivalent of /sites/:id/live/screen (displayWrapper() in src/pages.js).
// ?snap=<id> pins an older snapshot. If another tab publishes, the screen flips.

import * as store from '../store.js';
import { h, href, relTime } from '../ui.js';

export function mount(app, id) {
  const board = store.getBoard(id);
  const W = board?.canvas.w || 1280, H = board?.canvas.h || 800;
  const pinned = new URLSearchParams(location.search).get('snap');
  document.title = `${store.getSite(id).meta.name} · screen · Pixelboard demo`;

  const frame = h('iframe.pbd-frame', { title: 'Live screen', scrolling: 'no', tabIndex: -1 });
  frame.setAttribute('sandbox', 'allow-same-origin'); // published HTML runs no scripts
  const stageEl = h('div.pbd-screen-stage', { style: { width: W + 'px', height: H + 'px' } }, frame);
  const label = h('span.pbd-screen-label');
  const flash = h('div.pbd-screen-flash');
  const bar = h('div.pbd-screen-bar',
    h('a.pbd-btn.ghost.sm', { href: href(`edit/${id}`) }, '← Edit content'),
    label,
    h('span.pbd-sp'),
    h('a.pbd-btn.ghost.sm', { href: href(`studio/${id}`) }, 'Studio'),
    h('a.pbd-btn.ghost.sm', { href: href('') }, 'All boards'));
  const empty = h('div.pbd-screen-empty', h('p', 'Not published yet.'), h('a.pbd-btn', { href: href(`edit/${id}`) }, 'Go publish it'));

  app.textContent = '';
  app.append(h('div.pbd-screen', stageEl, bar, flash));

  let shown = null;
  function show() {
    store.refresh();
    const snaps = store.listSnapshots(id);
    const snap = pinned ? snaps.find((s) => s.id === pinned) : snaps[0];
    if (!snap) {
      if (!app.contains(empty)) app.append(empty);
      label.textContent = pinned ? 'That snapshot no longer exists.' : 'Not published yet';
      return;
    }
    empty.remove();
    if (shown && shown !== snap.id) {
      flash.textContent = 'New snapshot published — the screen flipped.';
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
    }
    if (shown !== snap.id) frame.srcdoc = store.readSnapshot(id, snap.id);
    shown = snap.id;
    label.textContent = '';
    label.append(
      h('span.pbd-live-dot' + (pinned ? '.pinned' : '')),
      pinned ? `Pinned snapshot ${snap.id.slice(0, 6)}` : `LIVE · snapshot ${snap.id.slice(0, 6)}`,
      h('span.pbd-muted', ` · published ${relTime(snap.createdAt)}`));
  }

  function fit() {
    const vp = window.visualViewport;
    const vw = vp ? vp.width : innerWidth, vh = vp ? vp.height : innerHeight;
    stageEl.style.transform = `translate(-50%,-50%) scale(${Math.min(vw / W, vh / H)})`;
  }
  addEventListener('resize', fit);
  window.visualViewport?.addEventListener('resize', fit);
  addEventListener('storage', (e) => { if (e.key === null || e.key === 'pixelboard-demo') show(); });

  // the control bar fades out after a few seconds; any movement or tap brings it back
  let idle;
  const wake = () => { bar.classList.remove('hide'); clearTimeout(idle); idle = setTimeout(() => bar.classList.add('hide'), 4000); };
  ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, wake, { passive: true }));

  fit(); show(); wake();
}
