// Pixelboard studio — Fabric.js board editor (ADR-004 path A). Fabric drives the
// canvas (drag/resize/multi-select); on save we serialize Fabric objects BACK into
// the board schema, which compiles to the HTML the engine renders/guards. The
// production engine + Guardian + compiler are untouched.
import { Canvas, Textbox, Rect, FabricImage } from '/vendor/fabric/index.min.mjs';

const BOARD = window.__PB_BOARD__;
const SITE = window.__PB_SITE__;
// Fabric writes fontFamily straight into ctx.font, which can't parse a CSS stack
// with commas/quotes (it collapses to ~0-width glyphs). Use a SINGLE family here;
// the compiler still emits the full FONT_STACKS['inter'] stack for production HTML.
// key -> single family name for the canvas (full CSS stacks collapse glyphs in ctx.font).
const FONTS = window.__PB_FONTS__ || { inter: 'Inter' };
const fam = (key) => FONTS[key] || FONTS.inter || 'Inter';
const statusEl = document.getElementById('pb-status');
const panel = document.getElementById('pb-panel');

export const PRESETS = [
  { label: 'Landscape screen · 16:9 (1920×1080)', w: 1920, h: 1080 },
  { label: 'Portrait menu board · 9:16 (1080×1920)', w: 1080, h: 1920 },
  { label: 'Square · 1:1 (1080×1080)', w: 1080, h: 1080 },
  { label: 'Ultrawide · 21:9 (2560×1080)', w: 2560, h: 1080 },
];

const canvas = new Canvas('fabric-canvas', { backgroundColor: '#0a0a0a', preserveObjectStacking: true, enableRetinaScaling: false });

function prep(o) { return o; } // rotation is allowed (captured as element.rotation; compiler emits transform)
function uid(t) { let n = 1; while (canvas.getObjects().some((o) => o.pbId === t + '-' + n)) n++; return t + '-' + n; }
function dirty() { statusEl.textContent = 'Unsaved changes'; }

// --- board doc -> Fabric objects -----------------------------------------
// Fabric only models some style keys; keep the rest (opacity, letterSpacing, …)
// so serialize() can round-trip them instead of silently dropping them on save.
function keepStyle(o, s) { o.pbStyle = { ...s }; if (s.opacity != null) o.set({ opacity: s.opacity }); }
function addText(el) {
  const s = el.style || {};
  const o = new Textbox(el.value || 'Text', {
    left: el.x, top: el.y, width: el.w, originX: 'left', originY: 'top', angle: el.rotation || 0,
    fontSize: s.fontSize || 48, fill: s.color || '#ffffff',
    fontWeight: s.fontWeight || 400, fontFamily: fam(s.fontFamily),
    textAlign: s.textAlign || 'left', fontStyle: s.fontStyle || 'normal',
  });
  o.pbId = el.id; o.pbType = 'text'; o.pbSlot = el.slot || { editable: false }; o.pbFont = s.fontFamily || 'inter'; keepStyle(o, s);
  canvas.add(prep(o)); return o;
}
function addRect(el) {
  const s = el.style || {};
  const o = new Rect({ left: el.x, top: el.y, width: el.w, height: el.h, originX: 'left', originY: 'top', angle: el.rotation || 0, fill: s.background || '#2e6bff', rx: s.borderRadius || 0, ry: s.borderRadius || 0 });
  o.pbId = el.id; o.pbType = 'rect'; o.pbSlot = { editable: false }; keepStyle(o, s);
  canvas.add(prep(o)); return o;
}
// Resolves to the Fabric image (or null if it fails to load) WITHOUT adding it —
// loadBoard adds everything in document order once all images are in, so a slow
// full-bleed backdrop can't land on top of the text.
function makeImage(el) {
  return FabricImage.fromURL(el.value || '/branding/logomark-512.png', { crossOrigin: 'anonymous' }).then((o) => {
    o.set({ left: el.x, top: el.y, originX: 'left', originY: 'top', angle: el.rotation || 0 });
    // scaleToWidth+scaleToHeight independently stretches non-uniformly, which
    // silently mismatches the compiler's object-fit:contain (the box is a crop
    // frame, not a stretch target) — squishes anything whose native aspect
    // ratio doesn't match its box, e.g. a widget PNG in a wider/taller frame.
    if ((el.style || {}).objectFit === 'contain') {
      const s = Math.min(el.w / o.width, el.h / o.height);
      o.scale(s);
      o.set({ left: el.x + (el.w - o.getScaledWidth()) / 2, top: el.y + (el.h - o.getScaledHeight()) / 2 });
    } else {
      o.scaleToWidth(el.w); if (el.h) o.scaleToHeight(el.h);
    }
    o.pbId = el.id; o.pbType = 'image'; o.pbSlot = el.slot || { editable: false }; o.pbSrc = el.value || '/branding/logomark-512.png';
    keepStyle(o, el.style || {});
    return prep(o);
  }).catch((e) => { console.warn('image failed to load:', el.value, e); return null; });
}
function addImage(el) {
  return makeImage(el).then((o) => { if (o) { canvas.add(o); canvas.requestRenderAll(); } return o; });
}
async function swapImage(o, url) {
  const img = await FabricImage.fromURL(url || '/branding/logomark-512.png', { crossOrigin: 'anonymous' });
  img.set({ left: o.left, top: o.top, originX: 'left', originY: 'top' });
  img.scaleToWidth(o.getScaledWidth()); img.scaleToHeight(o.getScaledHeight());
  img.pbId = o.pbId; img.pbType = 'image'; img.pbSlot = o.pbSlot; img.pbSrc = url; img.pbStyle = o.pbStyle; img.set({ opacity: o.opacity });
  canvas.remove(o); canvas.add(prep(img)); canvas.setActiveObject(img); canvas.requestRenderAll(); renderPanel(); dirty();
}

async function loadBoard() {
  const imgs = await Promise.all(BOARD.elements.map((el) => (el.type === 'image' ? makeImage(el) : null)));
  canvas.remove(...canvas.getObjects());
  BOARD.elements.forEach((el, i) => {
    if (el.type === 'text') addText(el); else if (el.type === 'rect') addRect(el); else if (imgs[i]) canvas.add(imgs[i]);
  });
  canvas.requestRenderAll();
}

// --- fit: native backstore + CSS-only downscale (canonical Fabric pattern,
// keeps object coords == board coords, no zoom/clip math) -----------------
function fit() {
  const stage = document.getElementById('pb-stage');
  const pad = 48;
  const z = Math.min((stage.clientWidth - pad) / BOARD.canvas.w, (stage.clientHeight - pad) / BOARD.canvas.h, 1);
  canvas.setDimensions({ width: BOARD.canvas.w, height: BOARD.canvas.h });
  canvas.setDimensions({ width: BOARD.canvas.w * z + 'px', height: BOARD.canvas.h * z + 'px' }, { cssOnly: true });
}
window.addEventListener('resize', fit);

// --- Fabric objects -> board schema (the round-trip) ----------------------
function toHex(c) {
  if (!c) return '#000000';
  if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7);
  const m = c.match(/\d+/g); if (!m) return '#000000';
  return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
}
function serialize() {
  const elements = canvas.getObjects().map((o) => {
    const base = { id: o.pbId, type: o.pbType, x: Math.round(o.left), y: Math.round(o.top), w: Math.round(o.getScaledWidth()), h: Math.round(o.getScaledHeight()) };
    if (o.pbType === 'text') {
      base.value = o.text;
      base.style = { ...o.pbStyle, color: toHex(o.fill), fontFamily: o.pbFont || 'inter', fontSize: Math.round(o.fontSize * o.scaleY), fontWeight: Number(o.fontWeight) || 400, textAlign: o.textAlign };
      base.slot = o.pbSlot && o.pbSlot.editable ? { editable: true, label: o.pbSlot.label || 'Text' } : { editable: false };
    } else if (o.pbType === 'rect') {
      base.style = { ...o.pbStyle, background: toHex(o.fill), borderRadius: Math.round(o.rx || 0) };
    } else if (o.pbType === 'image') {
      base.value = o.pbSrc || ''; base.style = { ...o.pbStyle, objectFit: 'fill' };
      base.slot = o.pbSlot && o.pbSlot.editable ? { editable: true, label: o.pbSlot.label || 'Image' } : { editable: false };
    }
    if (Math.round(o.angle)) base.rotation = Math.round(o.angle);
    return base;
  });
  return { name: BOARD.name, canvas: BOARD.canvas, elements };
}

async function save() {
  statusEl.textContent = 'Saving…';
  const board = serialize();
  const r = await fetch('/api/studio/boards/' + SITE, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board }) });
  const d = await r.json();
  if (r.status === 422) { statusEl.textContent = 'Rejected: ' + (d.errors || []).map((x) => x.path + ': ' + x.message).join('; '); return; }
  if (!r.ok) { statusEl.textContent = 'Error: ' + (d.error || r.status); return; }
  BOARD.elements = board.elements; statusEl.textContent = 'Saved ✓ ' + d.slotCount + ' editable slot(s)';
}

// --- toolbar -------------------------------------------------------------
document.querySelector('[data-add="text"]').onclick = () => { const o = addText({ id: uid('text'), x: 120, y: 120, w: 500, value: 'New text', style: { color: '#ffffff', fontSize: 56, fontWeight: 700 }, slot: { editable: true, label: 'Text' } }); canvas.setActiveObject(o); canvas.requestRenderAll(); dirty(); };
document.querySelector('[data-add="rect"]').onclick = () => { const o = addRect({ id: uid('rect'), x: 120, y: 120, w: 400, h: 200, style: { background: '#7b2ff7', borderRadius: 16 } }); canvas.setActiveObject(o); canvas.requestRenderAll(); dirty(); };
document.querySelector('[data-add="image"]').onclick = () => { addImage({ id: uid('image'), x: 120, y: 120, w: 300, h: 300, value: '/branding/logomark-512.png', slot: { editable: true, label: 'Image' } }); dirty(); };
document.getElementById('pb-save').onclick = save;
// --- backdrop picker: browse the curated library, click to apply -----------
const bdBtn = document.getElementById('pb-backdrop');
const bdModal = document.getElementById('pb-bd-modal');
const bdGrid = document.getElementById('pb-bd-grid');
let bdLoaded = false;

async function applyBackdrop(payload, busyMsg) {
  statusEl.textContent = busyMsg;
  const r = await fetch('/api/studio/boards/' + SITE + '/backdrop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { statusEl.textContent = (d.error || ('Error ' + r.status)); return; }
  location.reload(); // server is the source of truth — reload the saved board into the canvas
}

function nameOf(file) { return file.split('/').pop().replace('.jpg', ''); }
function themeOf(tags) { return tags.filter((t) => t.startsWith('color-theme:')).map((t) => t.split(':')[1]).join('/'); }

async function loadBackdrops() {
  if (bdLoaded) return;
  const r = await fetch('/api/studio/backdrops');
  const d = await r.json().catch(() => ({ backdrops: [] }));
  bdGrid.innerHTML = '';
  for (const b of (d.backdrops || [])) {
    const light = b.tags.includes('color-theme:light');
    const card = document.createElement('button');
    card.className = 'pb-bd' + (light ? ' lt' : '');
    card.title = b.desc || nameOf(b.file);
    card.innerHTML = '<img loading="lazy" src="' + b.file + '"><span class="nm">' + nameOf(b.file) + '<span>' + themeOf(b.tags) + '</span></span>';
    card.onclick = () => applyBackdrop({ file: b.file }, 'Applying backdrop…');
    bdGrid.append(card);
  }
  bdLoaded = true;
}

function openBackdrops() { bdModal.hidden = false; loadBackdrops(); }
function closeBackdrops() { bdModal.hidden = true; }

if (bdBtn) bdBtn.onclick = openBackdrops;
if (bdModal) {
  bdModal.addEventListener('click', (e) => {
    const act = e.target.closest('[data-bd-action]')?.dataset.bdAction;
    if (e.target === bdModal || act === 'close') return closeBackdrops();
    if (act === 'auto') return applyBackdrop({}, 'Auto-matching a backdrop…');
    if (act === 'remove') return applyBackdrop({ remove: true }, 'Removing backdrop…');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bdModal.hidden) closeBackdrops(); });
}
// AI generate: describe a board -> validated doc loaded into the canvas for review
document.querySelector('[data-ai]').onclick = async () => {
  const msg = prompt('Describe the board to generate (e.g. "lunch special, blue background, big price"):');
  if (!msg) return;
  statusEl.textContent = 'Generating…';
  const r = await fetch('/api/studio/boards/' + SITE + '/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: msg }) });
  const d = await r.json();
  if (r.status === 503) { statusEl.textContent = 'AI not configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.'; return; }
  if (r.status === 422) { statusEl.textContent = 'AI produced an off-spec board: ' + (d.errors || []).map((x) => x.path + ': ' + x.message).join('; '); return; }
  if (!r.ok) { statusEl.textContent = 'Error: ' + (d.error || r.status); return; }
  BOARD.elements = d.board.elements; if (d.board.name) BOARD.name = d.board.name;
  loadBoard(); fit(); renderPanel(); dirty();
  statusEl.textContent = (d.reply || 'Generated') + ' — review and Save';
};
canvas.on('object:modified', dirty);
['selection:created', 'selection:updated', 'selection:cleared'].forEach((ev) => canvas.on(ev, renderPanel));

// --- properties panel: element when selected, board when not --------------
function el(tag, props, kids) { const n = Object.assign(document.createElement(tag), props || {}); (kids || []).forEach((k) => n.append(k)); return n; }
function labeled(label, node) { return el('div', { className: 'pb-field' }, [el('label', { textContent: label }), node]); }
// Curated marker/highlighter set — the colors actually used across the
// boards (traced widgets, hand-lettered text) — as one-click swatches next
// to the raw picker, so recoloring a line doesn't mean eyeballing a hex.
const MARKER_COLORS = ['#c0392b', '#1e5fb4', '#1a9e8f', '#e07b1e', '#1a1a1a', '#d6247a'];
function ctrlColor(label, get, set) {
  const i = el('input', { type: 'color', value: get() || '#ffffff' });
  i.oninput = (e) => { set(e.target.value); canvas.requestRenderAll(); dirty(); };
  const swatches = el('div', { className: 'pb-swatches' },
    MARKER_COLORS.map((c) => {
      const b = el('button', { className: 'pb-swatch', style: `background:${c}`, title: c, type: 'button' });
      b.onclick = () => { i.value = c; set(c); canvas.requestRenderAll(); dirty(); };
      return b;
    }));
  return labeled(label, el('div', {}, [i, swatches]));
}
function ctrlNum(label, get, set) { const i = el('input', { type: 'number', value: get() }); i.oninput = (e) => { set(Number(e.target.value) || 0); canvas.requestRenderAll(); dirty(); }; return labeled(label, i); }
function ctrlSelect(label, opts, get, set) { const s = el('select'); opts.forEach((v) => s.append(el('option', { value: v, textContent: String(v), selected: String(get()) === String(v) }))); s.onchange = (e) => { set(e.target.value); canvas.requestRenderAll(); dirty(); }; return labeled(label, s); }

function renderBoardPanel() {
  panel.innerHTML = '<h3>Board size</h3>';
  const grid = el('div', { className: 'pb-grid2' });
  ['w', 'h'].forEach((k) => {
    const i = el('input', { type: 'number', value: BOARD.canvas[k] });
    i.oninput = (e) => { BOARD.canvas[k] = Math.max(1, Number(e.target.value) || 1); fit(); dirty(); };
    grid.append(labeled(k === 'w' ? 'Width' : 'Height', i));
  });
  panel.append(grid);
  const sel = el('select');
  sel.append(el('option', { value: '', textContent: 'Presets…' }));
  PRESETS.forEach((p, idx) => sel.append(el('option', { value: idx, textContent: p.label })));
  sel.onchange = (e) => { const p = PRESETS[e.target.value]; if (p) { BOARD.canvas.w = p.w; BOARD.canvas.h = p.h; fit(); renderBoardPanel(); dirty(); } };
  panel.append(labeled('Preset', sel));
  panel.append(el('div', { className: 'pb-empty', textContent: 'Select an element to edit it, or add one from the toolbar. Drag, resize, multi-select — all Fabric.' }));
}

function renderPanel() {
  const o = canvas.getActiveObject();
  if (!o) return renderBoardPanel();
  panel.innerHTML = '<h3>Properties</h3>';
  if (o.getObjects) {
    panel.append(el('div', { className: 'muted', textContent: 'Multiple selected — move/resize/delete together.' }));
    const d = el('button', { className: 'btn ghost', textContent: 'Delete selected', style: 'margin-top:1rem' });
    d.onclick = () => { o.getObjects().forEach((x) => canvas.remove(x)); canvas.discardActiveObject(); renderPanel(); dirty(); canvas.requestRenderAll(); };
    panel.append(d); return;
  }
  panel.append(el('div', { className: 'muted', textContent: o.pbType + ' · ' + o.pbId, style: 'margin-bottom:.6rem' }));

  if (o.pbType === 'text') {
    const ta = el('textarea', { value: o.text });
    ta.oninput = (e) => { o.set('text', e.target.value); o.initDimensions && o.initDimensions(); canvas.requestRenderAll(); dirty(); };
    panel.append(labeled('Text', ta));
    panel.append(ctrlSelect('Font', Object.keys(FONTS), () => o.pbFont || 'inter', (v) => { o.pbFont = v; o.set('fontFamily', fam(v)); }));
    panel.append(ctrlColor('Color', () => toHex(o.fill), (v) => o.set('fill', v)));
    panel.append(el('div', { className: 'pb-grid2' }, [
      ctrlNum('Size', () => Math.round(o.fontSize), (v) => o.set('fontSize', Math.max(1, v))),
      ctrlSelect('Weight', [400, 500, 600, 700, 800, 900], () => o.fontWeight, (v) => o.set('fontWeight', Number(v))),
    ]));
    panel.append(ctrlSelect('Align', ['left', 'center', 'right'], () => o.textAlign, (v) => o.set('textAlign', v)));
  } else if (o.pbType === 'rect') {
    panel.append(ctrlColor('Fill', () => toHex(o.fill), (v) => o.set('fill', v)));
    panel.append(ctrlNum('Corner radius', () => Math.round(o.rx || 0), (v) => { o.set('rx', v); o.set('ry', v); }));
  } else if (o.pbType === 'image') {
    const i = el('input', { type: 'text', value: o.pbSrc || '' });
    i.onchange = (e) => swapImage(o, e.target.value);
    panel.append(labeled('Image URL', i));
    const up = el('input', { type: 'file', accept: 'image/*' });
    up.onchange = async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      statusEl.textContent = 'Uploading…';
      const r = await fetch('/api/sites/' + SITE + '/assets', { method: 'POST', headers: { 'content-type': f.type }, body: f });
      // a platform 413 (Vercel's 4.5 MB body cap) arrives as plain text, not our JSON
      const d = await r.json().catch(() => ({ error: r.status === 413 ? 'file too large (max 4 MB)' : r.statusText }));
      if (!r.ok) { statusEl.textContent = 'Upload failed: ' + (d.error || r.status); return; }
      statusEl.textContent = 'Uploaded ✓';
      swapImage(canvas.getActiveObject() || o, d.url);
    };
    panel.append(labeled('Upload image (hosted by Pixelboard)', up));
  }

  // arrange (z-order)
  panel.append(el('h3', { textContent: 'Arrange' }));
  const fwd = el('button', { className: 'btn ghost', textContent: 'Forward' });
  fwd.onclick = () => { canvas.bringObjectForward(o); canvas.requestRenderAll(); dirty(); };
  const bwd = el('button', { className: 'btn ghost', textContent: 'Back' });
  bwd.onclick = () => { canvas.sendObjectBackwards(o); canvas.requestRenderAll(); dirty(); };
  panel.append(el('div', { className: 'pb-grid2' }, [fwd, bwd]));

  // editable slot
  if (o.pbType !== 'rect') {
    panel.append(el('h3', { textContent: 'Editable in production' }));
    const cb = el('input', { type: 'checkbox', checked: !!(o.pbSlot && o.pbSlot.editable) });
    cb.onchange = (e) => { o.pbSlot = o.pbSlot || {}; o.pbSlot.editable = e.target.checked; dirty(); };
    panel.append(el('div', { className: 'pb-check' }, [cb, el('label', { textContent: 'Client can edit this', style: 'margin:0' })]));
    const lab = el('input', { type: 'text', placeholder: 'Field label', value: (o.pbSlot && o.pbSlot.label) || '' });
    lab.oninput = (e) => { o.pbSlot = o.pbSlot || { editable: false }; o.pbSlot.label = e.target.value; dirty(); };
    panel.append(labeled('Field label', lab));
  }

  const del = el('button', { className: 'btn ghost', textContent: 'Delete', style: 'margin-top:1rem' });
  del.onclick = () => { canvas.remove(o); canvas.discardActiveObject(); renderPanel(); dirty(); canvas.requestRenderAll(); };
  panel.append(del);
}

// keyboard: Delete removes selection, arrows nudge (Shift = 10px). Skips text editing.
document.addEventListener('keydown', (e) => {
  const o = canvas.getActiveObject();
  if (!o || o.isEditing) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    (o.getObjects ? o.getObjects() : [o]).forEach((x) => canvas.remove(x));
    canvas.discardActiveObject(); renderPanel(); dirty(); canvas.requestRenderAll();
  } else if (e.key.indexOf('Arrow') === 0) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') o.left -= d; else if (e.key === 'ArrowRight') o.left += d;
    else if (e.key === 'ArrowUp') o.top -= d; else if (e.key === 'ArrowDown') o.top += d;
    o.setCoords(); canvas.requestRenderAll(); dirty();
  }
});

loadBoard(); fit(); renderPanel();
// Canvas text never triggers the browser's normal font-loading path (only real
// DOM text does), so @font-face families used solely on the canvas would sit
// unloaded forever without an explicit request here. Force-load every family
// actually referenced by this board, then re-measure once ready (first paint
// may have used a fallback with different metrics).
if (document.fonts) {
  const used = new Set(BOARD.elements.filter((el) => el.type === 'text').map((el) => fam((el.style || {}).fontFamily)));
  Promise.all([...used].map((f) => document.fonts.load(`48px "${f}"`).catch(() => {})))
    .then(() => document.fonts.ready)
    .then(() => {
      // initDimensions() alone re-measures layout but leaves each object's
      // offscreen render cache (from the pre-load fallback paint) untouched —
      // Fabric only rebuilds it when `dirty` is set, so force that too.
      canvas.getObjects().forEach((o) => { if (o.initDimensions) o.initDimensions(); o.dirty = true; });
      canvas.requestRenderAll();
    });
}
window.addEventListener('beforeunload', (e) => { if (statusEl.textContent.startsWith('Unsaved')) { e.preventDefault(); e.returnValue = ''; } });
