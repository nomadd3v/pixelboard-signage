// Design surface. Builds the same DOM that boardStudioPage() (src/pages.js)
// serves, then loads the UNCHANGED src/studio/studio.js against the in-browser
// /api shim (../routes.js). Demo-only additions, all outside studio.js:
//   • a capture-phase keydown guard (studio.js deletes the selected element on
//     Backspace even while you type in the Properties panel — a product bug);
//   • the ✦ AI button is re-pointed at canned, clearly-labelled suggestions —
//     no model is called;
//   • "Production editing →" saves pending changes before leaving.
//   • compensations for three studio.js round-trip bugs (see patchFabric()):
//     async-loaded images land ON TOP of everything (a backdrop hides the whole
//     board), and rect/text opacity, letterSpacing, lineHeight and image
//     borderRadius/objectFit:cover are never drawn on the canvas. The matching
//     save-side loss is compensated in routes.js (mergeUnmanagedStyle).

import * as store from '../store.js';
import { seedById } from '../seeds.js';
import { installFetchShim, recompile } from '../routes.js';
import { compile, render, FONT_PRIMARY, BASE } from '../engine.js';
import { h, href, toast, fitFrame, boardFrame } from '../ui.js';
import { Canvas, Rect } from '/vendor/fabric/index.min.mjs'; // the same module instance studio.js imports
import { STUDIO_CSS } from 'virtual:studio-css';

// Every element studio.js reaches for at module load. Checked before import so
// markup drift fails loudly with a name instead of a half-mounted studio.
const REQUIRED = ['[data-add="text"]', '[data-add="image"]', '[data-add="rect"]', '[data-ai]', '#pb-save', '#pb-status',
  '#pb-panel', '#pb-stage', '#fabric-canvas', '#pb-backdrop', '#pb-bd-modal', '#pb-bd-grid'];

export async function mount(app, id) {
  const site = store.getSite(id);
  const board = store.getBoard(id);
  if (!board) { location.replace(href(`edit/${id}`)); return; }
  document.title = `Designing ${site.meta.name} · Pixelboard demo`;
  document.head.append(h('style', STUDIO_CSS));

  const icon = (name) => h('img', { src: href(`branding/layers/icon-${name}.svg`), alt: '' });
  const hint = h('div.pbd-studio-hint',
    h('strong', 'You’re the designer. '),
    'Select anything to move, resize or restyle it. Tick “Editable in production” to hand a field to staff — everything else stays locked. (What’s in those fields belongs to staff: text you type here is only the default.) Then save and switch to ',
    h('a', { href: href(`edit/${id}`), 'data-go-edit': '' }, 'production editing'), '.',
    h('button.pbd-hint-x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => hint.remove() }, '✕'));

  app.textContent = '';
  app.append(
    h('div.pb-app',
      h('div.pb-top',
        h('a.pbd-back', { href: href(''), title: 'All boards' }, '←'),
        h('h1', site.meta.name),
        h('span#pb-status.muted'),
        h('span.sp'),
        h('a', { href: href(`display/${id}`) }, 'Screen'),
        h('button.btn.ghost#pb-backdrop', { type: 'button', title: 'Add a matching photo backdrop from the library' }, '✦ Backdrop'),
        h('button.btn.ghost#pb-save', { type: 'button' }, 'Save & compile'),
        h('a.btn.pbd-go-edit', { href: href(`edit/${id}`), 'data-go-edit': '' }, 'Production editing →')),
      h('div.pb-tools',
        h('button', { type: 'button', 'data-add': 'text', title: 'Add text' }, icon('text')),
        h('button', { type: 'button', 'data-add': 'image', title: 'Add image' }, icon('image')),
        h('button', { type: 'button', 'data-add': 'rect', title: 'Add shape' }, icon('rect')),
        h('button.pbd-ai-btn', { type: 'button', 'data-ai': '', title: 'AI generate (canned in this demo)', style: { marginTop: 'auto' } }, icon('ai-sparkle'))),
      h('div.pb-stage#pb-stage', { style: { display: 'grid', placeItems: 'center' } }, h('canvas#fabric-canvas'), hint),
      h('div.pb-panel#pb-panel')),
    h('div.pb-modal#pb-bd-modal', { hidden: true },
      h('div.pb-modal-box',
        h('div.pb-modal-head',
          h('h2', 'Choose a backdrop'),
          h('div.pb-modal-actions',
            h('button.btn.ghost', { type: 'button', 'data-bd-action': 'auto', title: 'Pick the best match for this board' }, '✨ Auto-match'),
            h('button.btn.ghost', { type: 'button', 'data-bd-action': 'remove', title: 'Remove the current backdrop' }, 'Remove'),
            h('button.pb-modal-x', { type: 'button', 'data-bd-action': 'close', 'aria-label': 'Close' }, '✕'))),
        h('div.pb-bd-grid#pb-bd-grid', h('p.muted', 'Loading…')))));

  const missing = REQUIRED.filter((sel) => !document.querySelector(sel));
  if (missing.length) throw new Error('studio skeleton is missing: ' + missing.join(', '));

  // Keys typed into the side panel / dialogs must not reach studio.js's
  // document-level Delete/Backspace/arrow handler (see header note).
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('#pb-panel, .pb-modal, .pb-top, .pbd-modal')) e.stopPropagation();
  }, true);

  installFetchShim();
  patchFabric(board);
  window.__PB_BOARD__ = board;
  window.__PB_SITE__ = id;
  window.__PB_FONTS__ = FONT_PRIMARY;
  await import('../../studio/studio.js');

  const statusEl = document.getElementById('pb-status');
  try { const f = sessionStorage.getItem('pbd-flash'); if (f) { sessionStorage.removeItem('pbd-flash'); toast(f, 'ok'); } } catch { /* ignore */ }
  const aiBtn = document.querySelector('[data-ai]');
  aiBtn.onclick = () => openCanned(id, statusEl);

  // leaving for production editing: save first (studio.js marks dirty state in #pb-status)
  document.querySelectorAll('[data-go-edit]').forEach((a) => a.addEventListener('click', async (e) => {
    if (!statusEl.textContent.startsWith('Unsaved')) return;
    e.preventDefault();
    document.getElementById('pb-save').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 4000) {
      await new Promise((r) => setTimeout(r, 60));
      const s = statusEl.textContent;
      if (s.startsWith('Saved')) { location.href = a.href; return; }
      if (s.startsWith('Rejected') || s.startsWith('Error')) { toast('Fix the design error before leaving.', 'bad'); return; }
    }
  }));
}

// --- Fabric compensation (demo only; studio.js itself is untouched) ---------------

function patchFabric(board) {
  const order = new Map(board.elements.map((e, i) => [e.id, i]));
  const byId = new Map(board.elements.map((e) => [e.id, e]));
  const origAdd = Canvas.prototype.add;
  Canvas.prototype.add = function (...objs) {
    const res = origAdd.apply(this, objs);
    for (const o of objs) {
      const el = byId.get(o.pbId);
      if (!el || el.type !== o.pbType) continue;
      drawStyle(o, el);
      // put the object back at its board z-index (images resolve asynchronously)
      const idx = order.get(o.pbId);
      const below = this.getObjects().filter((x) => x !== o && order.has(x.pbId) && order.get(x.pbId) < idx).length;
      this.moveObjectTo(o, below);
    }
    return res;
  };
}

function drawStyle(o, el) {
  const s = el.style || {};
  if (typeof s.opacity === 'number') o.set('opacity', s.opacity);
  if (el.type === 'text') {
    if (typeof s.letterSpacing === 'number' && s.fontSize) o.set('charSpacing', (s.letterSpacing / s.fontSize) * 1000);
    if (typeof s.lineHeight === 'number') o.set('lineHeight', s.lineHeight);
    o.initDimensions?.();
  }
  if (el.type === 'image' && o.width && o.height) {
    if (s.objectFit === 'cover' && el.w && el.h && !o.__pbCropped) {
      const k = Math.max(el.w / o.width, el.h / o.height);
      const cw = el.w / k, ch = el.h / k;
      o.set({ cropX: (o.width - cw) / 2, cropY: (o.height - ch) / 2, width: cw, height: ch, scaleX: k, scaleY: k, left: el.x, top: el.y });
      o.__pbCropped = true;
    }
    if (typeof s.borderRadius === 'number' && s.borderRadius > 0) {
      o.clipPath = new Rect({ width: o.width, height: o.height, rx: s.borderRadius / o.scaleX, ry: s.borderRadius / o.scaleY, originX: 'center', originY: 'center' });
    }
  }
  o.setCoords();
  o.dirty = true;
}

// --- ✦ canned suggestions (AI is off in the static demo) ---------------------------

function openCanned(id, statusEl) {
  const seed = seedById(id);
  const site = store.getSite(id);
  const close = () => modal.remove();
  const unsaved = statusEl.textContent.startsWith('Unsaved');
  const list = h('div.pbd-canned-list');
  const modal = h('div.pbd-modal', { onclick: (e) => { if (e.target === modal) close(); } },
    h('div.pbd-modal-box', { role: 'dialog', 'aria-label': 'Canned design suggestions' },
      h('div.pbd-modal-head',
        h('h2', '✦ Suggestions'),
        h('span.pbd-canned-tag', 'CANNED — NO AI'),
        h('span.pbd-sp'),
        h('button.pb-modal-x', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      h('p.pbd-muted',
        'In the product, ✦ asks a model to lay out a board — and even then the model can only produce a board document that must pass the same design validator. ',
        h('strong', 'This static demo makes no AI calls: '),
        'these are pre-written layouts for this board, run through that same validateBoard → compileBoard path. Your content edits survive the restyle.',
        unsaved ? h('span.pbd-warn', ' Applying replaces the current design, including unsaved canvas changes.') : null),
      list));

  if (!seed) list.append(h('p.pbd-muted', 'No canned suggestions for this board.'));
  else {
    for (const [key, look] of Object.entries(seed.looks)) {
      const next = seed.build(BASE, key);
      const art = compile(next);
      const content = {};
      for (const s of art.slots) content[s.id] = site.content[s.id] ?? art.content[s.id];
      const thumb = h('div.pbd-canned-thumb');
      const f = boardFrame(render({ template: art.template, slots: art.slots, content, mode: 'publish' }), { title: look.name });
      thumb.append(f);
      list.append(h('button.pbd-canned', {
        type: 'button',
        onclick: () => {
          const r = recompile(id, next, `Canned suggestion: ${look.name}`);
          if (r.status !== 200) { toast('Suggestion failed validation: ' + (r.body.errors || []).map((x) => x.message).join('; '), 'bad'); return; }
          statusEl.textContent = 'Applying suggestion…';
          try { sessionStorage.setItem('pbd-flash', `Applied the canned “${look.name}” layout — no AI involved; staff content kept.`); } catch { /* ignore */ }
          location.reload();
        },
      }, thumb, h('span', look.name)));
      requestAnimationFrame(() => fitFrame(thumb, f, next.canvas.w, next.canvas.h, 150));
    }
  }
  document.body.append(modal);
}
