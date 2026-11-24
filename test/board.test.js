import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateBoard } from '../src/board/schema.js';
import { compileBoard } from '../src/board/compile.js';
import { render } from '../src/render.js';
import { guardian } from '../src/guardian.js';
import { slotId } from '../src/ids.js';

const boardOf = (elements, canvas = { w: 1080, h: 1920 }) => ({ name: 'Menu Board', canvas, elements });

const headline = (over = {}) => ({
  id: 'headline', type: 'text', x: 40, y: 60, w: 600, h: 120,
  value: 'Surf & Turf Spud', style: { fontSize: 72, fontWeight: 700, color: '#ffffff' },
  slot: { editable: true, label: 'Headline' }, ...over,
});

// --- schema (the design-time Guardian) -------------------------------------

test('validateBoard accepts a well-formed board', () => {
  assert.deepEqual(validateBoard(boardOf([headline()])), { ok: true });
});

test('validateBoard rejects an unknown element type', () => {
  const r = validateBoard(boardOf([{ ...headline(), type: 'iframe' }]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'bad_type'));
});

test('validateBoard rejects a non-whitelisted style property (no freeform CSS)', () => {
  const r = validateBoard(boardOf([headline({ style: { position: 'fixed' } })]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'unknown_style'));
});

test('validateBoard rejects an out-of-shape style value (e.g. url() smuggled into color)', () => {
  const r = validateBoard(boardOf([headline({ style: { background: 'url(javascript:alert(1))' } })]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'bad_style_value'));
});

test('validateBoard rejects duplicate element ids', () => {
  const r = validateBoard(boardOf([headline(), headline()]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'dup_id'));
});

test('validateBoard rejects a sentinel-forging value', () => {
  const r = validateBoard(boardOf([headline({ value: `xabcabcabcabc` })]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'forbidden_char'));
});

// --- compile ----------------------------------------------------------------

test('compileBoard emits a token + text slot for an editable text element', () => {
  const { slots, content, template } = compileBoard(boardOf([headline()]));
  const id = slotId('headline', 'text');
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0], { id, kind: 'text', field: 'text', urlLike: false, original: 'Surf & Turf Spud', required: true, label: 'Headline' });
  assert.equal(content[id], 'Surf & Turf Spud');
  assert.match(template, new RegExp(`${id}`)); // raw token in template
});

test('compileBoard freezes a non-editable text element (escaped, no slot)', () => {
  const frozen = headline({ id: 'tag', value: 'Hot. <Cheesy>. Loaded.', slot: { editable: false } });
  const { slots, template } = compileBoard(boardOf([frozen]));
  assert.equal(slots.length, 0);
  assert.match(template, /Hot\. &lt;Cheesy&gt;\. Loaded\./); // escaped once at compile
});

test('validateBoard accepts optional rotation and rejects out-of-range', () => {
  assert.deepEqual(validateBoard(boardOf([headline({ rotation: 45 })])), { ok: true });
  const r = validateBoard(boardOf([headline({ rotation: 999 })]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'bad_rotation'));
});

test('compileBoard emits a rotate transform only for rotated elements', () => {
  assert.match(compileBoard(boardOf([headline({ rotation: 30 })])).template, /transform:rotate\(30deg\)/);
  assert.doesNotMatch(compileBoard(boardOf([headline()])).template, /transform:rotate/);
});

test('compileBoard makes an editable image an attr/src/urlLike slot', () => {
  const img = { id: 'logo', type: 'image', x: 0, y: 0, w: 200, h: 80, value: 'assets/logo.svg', slot: { editable: true, label: 'Logo' } };
  const { slots } = compileBoard(boardOf([img]));
  const id = slotId('logo', 'src');
  assert.deepEqual(slots[0], { id, kind: 'attr', field: 'src', urlLike: true, original: 'assets/logo.svg', required: true, label: 'Logo' });
});

// --- the engine consumes the compiled artifact UNCHANGED --------------------

test('render() + guardian() consume a compiled board with no forking', () => {
  const { template, slots, content } = compileBoard(boardOf([headline()]));
  const id = slotId('headline', 'text');

  // publish render escapes the value
  const pub = render({ template, slots, content: { ...content, [id]: 'Today: $9 <special>' }, mode: 'publish' });
  assert.match(pub, /Today: \$9 &lt;special&gt;/);

  // edit render emits the click-to-edit span the inherited editor wires
  const edit = render({ template, slots, content, mode: 'edit' });
  assert.match(edit, new RegExp(`<span class="v-slot" data-v-slot="${id}"`));

  // the SAME Guardian gates a change to a compiled slot
  assert.deepEqual(guardian(slots, { [id]: 'New headline' }), { ok: true });
  assert.equal(guardian(slots, { [id]: '<b>nope</b>' }).ok, false);
});

// --- ACCEPTANCE TEST (ADR-004 Decision 1) -----------------------------------
// Author -> client edits a value -> designer MOVES + RESTYLES that element ->
// recompile -> the slot id is identical, so the client's content still maps.
// This is the studio analog of "structural slot ids" and is the whole ballgame.

test('ACCEPTANCE: slot id (and thus client content) survives moving + restyling an element', () => {
  const v1 = compileBoard(boardOf([headline()]));
  const id1 = Object.keys(v1.content)[0];

  // client edits the value in production
  const clientContent = { ...v1.content, [id1]: '$12 — Lobster Spud' };

  // designer moves it across the canvas and changes type size/color/weight
  const moved = headline({ x: 700, y: 1500, w: 300, h: 90, style: { fontSize: 40, color: '#ff2ec4', fontWeight: 900 } });
  const v2 = compileBoard(boardOf([moved], { w: 1920, h: 1080 }));
  const id2 = v2.slots[0].id;

  assert.equal(id2, id1, 'slot id must be stable across move + restyle');
  // re-applying the saved client content onto the recompiled artifact still resolves
  const merged = { ...v2.content, ...clientContent };
  assert.equal(merged[id2], '$12 — Lobster Spud', 'client edit survives the redesign');
});

// --- template library (v1) --------------------------------------------------
import { listTemplates, instantiateTemplate, TEMPLATES } from '../src/templates.js';

test('every built-in template is a schema-valid, compilable board', () => {
  assert.ok(TEMPLATES.length >= 4);
  for (const t of TEMPLATES) {
    const v = validateBoard(t.board);
    assert.equal(v.ok, true, `${t.id} invalid: ${JSON.stringify(v.errors)}`);
    const art = compileBoard(t.board);
    assert.ok(art.template.includes('pb-board'));
    assert.ok(art.slots.length >= 1, `${t.id} has no editable slots`);
  }
});

test('template tags obey the canonical grammar (facet:value, lowercase-kebab, no colon in value)', () => {
  for (const t of listTemplates()) {
    assert.ok(t.canvas.w > 0 && t.canvas.h > 0);
    for (const tag of t.tags) {
      assert.match(tag, /^[a-z][a-z-]*:[a-z0-9][a-z0-9-]*$/, `${t.id}: bad tag "${tag}"`);
    }
    // computed shape facets are present and agree with the canvas geometry
    const want = t.canvas.w > t.canvas.h ? 'landscape' : t.canvas.w < t.canvas.h ? 'portrait' : 'square';
    assert.ok(t.tags.includes(`orientation:${want}`), `${t.id}: missing/!computed orientation`);
    assert.ok(t.tags.some((x) => x.startsWith('aspect:')), `${t.id}: missing aspect`);
  }
});

test('instantiateTemplate deep-clones (mutating one instance never corrupts the library)', () => {
  const id = TEMPLATES[0].id;
  const a = instantiateTemplate(id);
  a.elements[0].x = 99999;
  a.canvas.w = 1;
  const b = instantiateTemplate(id);
  assert.notEqual(b.elements[0].x, 99999);
  assert.equal(b.canvas.w, TEMPLATES[0].board.canvas.w);
  assert.equal(instantiateTemplate('nope'), null);
});

// --- backdrop library (codex-generated, applied by tag overlap) -------------
import { pickBackdrop, applyBackdrop, tagsForBoard } from '../src/backdrops.js';

test('pickBackdrop scores by tag overlap (color-theme weighted); null on empty library', () => {
  const list = [
    { file: '/backdrops/a.jpg', desc: '', tags: ['color-theme:dark', 'industry:bar'] },
    { file: '/backdrops/b.jpg', desc: '', tags: ['color-theme:warm', 'industry:cafe'] },
  ];
  assert.equal(pickBackdrop(['color-theme:warm'], list).file, '/backdrops/b.jpg');
  assert.equal(pickBackdrop(['industry:bar'], list).file, '/backdrops/a.jpg');
  assert.equal(pickBackdrop([], []), null);
});

test('applyBackdrop puts image+scrim under content, drops bg rect, stays valid, no double-stack', () => {
  const board = { name: 'B', canvas: { w: 1920, h: 1080 }, elements: [
    { id: 'bg', type: 'rect', x: 0, y: 0, w: 1920, h: 1080, style: { background: '#0a0a0a' } },
    { id: 'title', type: 'text', x: 140, y: 300, w: 1640, h: 200, value: 'Hi', style: { color: '#ffffff', fontFamily: 'inter', fontSize: 120, fontWeight: 800 }, slot: { editable: true, label: 'Title' } },
  ] };
  const out = applyBackdrop(board, { file: '/backdrops/x.jpg', tags: [] });
  assert.equal(out.elements[0].id, 'backdrop');
  assert.equal(out.elements[0].type, 'image');
  assert.equal(out.elements[1].id, 'scrim');
  assert.ok(!out.elements.some((e) => e.id === 'bg'));
  assert.equal(out.elements.at(-1).id, 'title');
  assert.equal(validateBoard(out).ok, true);
  const out2 = applyBackdrop(out, { file: '/backdrops/y.jpg', tags: [] });
  assert.equal(out2.elements.filter((e) => e.id === 'backdrop').length, 1);
});

test('removeBackdrop strips image+scrim and restores a full-bleed bg, stays valid', async () => {
  const { removeBackdrop } = await import('../src/backdrops.js');
  const board = { name: 'B', canvas: { w: 1920, h: 1080 }, elements: [
    { id: 'bg', type: 'rect', x: 0, y: 0, w: 1920, h: 1080, style: { background: '#0a0a0a' } },
    { id: 'title', type: 'text', x: 140, y: 300, w: 1640, h: 200, value: 'Hi', style: { color: '#fff', fontFamily: 'inter', fontSize: 120, fontWeight: 800 }, slot: { editable: true, label: 'Title' } },
  ] };
  const withBd = applyBackdrop(board, { file: '/backdrops/x.jpg', tags: [] });
  assert.ok(withBd.elements.some((e) => e.id === 'backdrop'));
  const out = removeBackdrop(withBd);
  assert.ok(!out.elements.some((e) => e.id === 'backdrop' || e.id === 'scrim'));
  assert.ok(out.elements.some((e) => e.type === 'rect' && e.w >= 1920 && e.h >= 1080)); // bg restored
  assert.equal(out.elements.at(-1).id, 'title');
  assert.equal(validateBoard(out).ok, true);
  // idempotent: removing again is a no-op shape (single bg, no dup ids)
  const out2 = removeBackdrop(out);
  assert.equal(validateBoard(out2).ok, true);
  assert.equal(out2.elements.filter((e) => e.type === 'rect' && e.w >= 1920).length, 1);
});

test('backdropByFile whitelists library files only', async () => {
  const { backdropByFile, BACKDROPS } = await import('../src/backdrops.js');
  assert.equal(backdropByFile(BACKDROPS[0].file).file, BACKDROPS[0].file);
  assert.equal(backdropByFile('/etc/passwd'), null);
  assert.equal(backdropByFile('https://evil.example/x.jpg'), null);
});

test('tagsForBoard derives color-theme from bg luminance', () => {
  const dark = { canvas: { w: 10, h: 10 }, elements: [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, style: { background: '#0a0a0a' } }] };
  const light = { canvas: { w: 10, h: 10 }, elements: [{ type: 'rect', x: 0, y: 0, w: 10, h: 10, style: { background: '#f5efe6' } }] };
  assert.ok(tagsForBoard(dark).includes('color-theme:dark'));
  assert.ok(tagsForBoard(light).includes('color-theme:light'));
});

// --- canonical tag validator (executable spec) ------------------------------
import { validateTags } from '../src/tags.js';

test('validateTags accepts every built-in template (the library conforms to the spec)', () => {
  for (const t of listTemplates()) {
    const v = validateTags(t.tags);
    assert.equal(v.ok, true, `${t.id}: ${JSON.stringify(v.errors)}`);
  }
});

test('validateTags enforces grammar, vocabulary, cardinality, and required facets', () => {
  const base = ['category:promo', 'orientation:landscape', 'aspect:16x9'];
  assert.equal(validateTags(base).ok, true);
  assert.ok(validateTags(['category:promo', 'orientation:landscape']).errors.some((e) => e.code === 'missing_required_facet')); // aspect missing
  assert.ok(validateTags([...base, 'Category:Promo']).errors.some((e) => e.code === 'bad_tag_format')); // uppercase
  assert.ok(validateTags([...base, 'aspect:16:9']).errors.some((e) => e.code === 'bad_tag_format')); // colon in value
  assert.ok(validateTags([...base, 'vibe:cozy']).errors.some((e) => e.code === 'unknown_facet'));
  assert.ok(validateTags([...base, 'industry:spaceship']).errors.some((e) => e.code === 'unknown_value'));
  assert.ok(validateTags([...base, 'category:event']).errors.some((e) => e.code === 'cardinality')); // category single-value
});

test('every backdrop tag is grammar-valid and in the canonical vocabulary', async () => {
  const { BACKDROPS } = await import('../src/backdrops.js');
  const { VOCAB } = await import('../src/tags.js');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const pubDir = fileURLToPath(new URL('../public', import.meta.url));
  assert.equal(BACKDROPS.length, 26);
  const seen = new Set();
  for (const b of BACKDROPS) {
    assert.match(b.file, /^\/backdrops\/[a-z0-9-]+\.jpg$/);
    assert.ok(!seen.has(b.file), `duplicate backdrop ${b.file}`);
    seen.add(b.file);
    assert.ok(existsSync(pubDir + b.file), `missing file for ${b.file}`);
    for (const tag of b.tags) {
      const m = /^([a-z][a-z-]*):([a-z0-9][a-z0-9-]*)$/.exec(tag);
      assert.ok(m, `bad tag "${tag}"`);
      assert.ok(VOCAB[m[1]] && VOCAB[m[1]].values.has(m[2]), `unknown ${tag}`);
    }
  }
});

// --- gradients (ADR-005 Decision 1) ----------------------------------------

const bgRect = (over = {}) => ({ id: 'bg', type: 'rect', x: 0, y: 0, w: 1080, h: 1920, ...over });

test('validateBoard accepts a linear gradient (rgba alpha stops)', () => {
  const g = { type: 'linear', angle: 180, stops: [
    { color: 'rgba(4,13,28,0.60)', at: 0 }, { color: 'rgba(4,13,28,0.06)', at: 100 },
  ] };
  assert.deepEqual(validateBoard(boardOf([bgRect({ style: { backgroundGradient: g } })])), { ok: true });
});

test('validateBoard accepts a radial gradient with off-box position + size', () => {
  const g = { type: 'radial', position: { x: 76, y: -8 }, size: { w: 135, h: 95 },
    stops: [{ color: '#1b4a82', at: 0 }, { color: '#04111f', at: 100 }] };
  assert.deepEqual(validateBoard(boardOf([bgRect({ style: { backgroundGradient: g } })])), { ok: true });
});

test('validateBoard rejects malformed gradients (still no freeform CSS)', () => {
  const cases = [
    'linear-gradient(180deg,#000,#fff)',                                  // a raw CSS string
    { type: 'conic', stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 1 }] }, // bad type
    { type: 'linear', angle: 180, stops: [{ color: '#000', at: 0 }] },    // <2 stops
    { type: 'linear', angle: 180, stops: [{ color: 'red', at: 0 }, { color: '#fff', at: 100 }] }, // named color
    { type: 'linear', angle: 180, stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 140 }] }, // at>100
    { type: 'linear', stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 100 }] }, // linear missing angle
    { type: 'linear', angle: 180, stops: [{ color: '#000', at: 0, evil: 1 }, { color: '#fff', at: 100 }] }, // smuggled key
    { type: 'linear', angle: 180, expr: 'x', stops: [{ color: '#000', at: 0 }, { color: '#fff', at: 100 }] }, // smuggled top key
  ];
  for (const g of cases) {
    const r = validateBoard(boardOf([bgRect({ style: { backgroundGradient: g } })]));
    assert.equal(r.ok, false, `should reject ${JSON.stringify(g)}`);
    assert.ok(r.errors.some((e) => e.code === 'bad_style_value' || e.code === 'unknown_style'));
  }
});

test('compiler emits gradient CSS and it wins over a solid background', () => {
  const g = { type: 'linear', angle: 90, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 100 }] };
  const { template } = compileBoard(boardOf([bgRect({ style: { background: '#ff0000', backgroundGradient: g } })]));
  assert.ok(template.includes('background:linear-gradient(90deg, #000000 0%, #ffffff 100%)'), 'gradient emitted');
  assert.ok(!template.includes('background:#ff0000'), 'solid background dropped when a gradient is present');
});

// --- the proof: reproduce the layered gradients of a real ingested menu board -------------------

test('layered gradients round-trip through validate -> compile -> publish', () => {
  // Two layers taken from an ingested menu board.
  const base = { type: 'radial', position: { x: 76, y: -8 }, size: { w: 135, h: 95 }, stops: [
    { color: '#1b4a82', at: 0 }, { color: '#103663', at: 30 }, { color: '#0a2750', at: 52 },
    { color: '#061a39', at: 78 }, { color: '#04111f', at: 100 },
  ] };
  const overlay = { type: 'linear', angle: 180, stops: [
    { color: 'rgba(4,13,28,0.60)', at: 0 }, { color: 'rgba(4,13,28,0.23)', at: 32 },
    { color: 'rgba(4,13,28,0.06)', at: 64 }, { color: 'rgba(4,13,28,0.22)', at: 100 },
  ] };
  const board = boardOf([
    bgRect({ id: 'bg', style: { backgroundGradient: base } }),
    bgRect({ id: 'overlay', style: { backgroundGradient: overlay, opacity: 1 } }),
    headline(),
  ], { w: 1920, h: 1080 });

  assert.deepEqual(validateBoard(board), { ok: true }, 'board validates');
  const artifact = compileBoard(board);
  const html = render({ ...artifact, mode: 'publish' });

  assert.ok(html.includes('background:radial-gradient(135% 95% at 76% -8%, #1b4a82 0%, #103663 30%, #0a2750 52%, #061a39 78%, #04111f 100%)'), 'radial base layer reproduced');
  assert.ok(html.includes('background:linear-gradient(180deg, rgba(4,13,28,0.60) 0%, rgba(4,13,28,0.23) 32%, rgba(4,13,28,0.06) 64%, rgba(4,13,28,0.22) 100%)'), 'tonal overlay reproduced');
  assert.ok(html.includes('Surf &amp; Turf Spud'), 'headline text rendered + escaped');
  assert.ok(!html.includes('⟦'), 'no sentinel leak');
});
