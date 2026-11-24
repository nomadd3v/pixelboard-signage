import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ingest } from '../src/ingest.js';
import { guardian } from '../src/guardian.js';
import { render } from '../src/render.js';
import { slotId, SENTINEL_OPEN } from '../src/ids.js';

const SAMPLE = `<!DOCTYPE html><html><head><title>Acme</title></head>
<body>
  <h1>Welcome to Acme</h1>
  <p>We sell <a href="https://acme.test/shop">great widgets</a>.</p>
  <img src="/logo.png" alt="Acme logo">
  <script>console.log('keep me frozen')</script>
</body></html>`;

// --- ingest -----------------------------------------------------------------

test('ingest extracts text, link, image-src and alt slots', () => {
  const { slots, content } = ingest(SAMPLE);
  const kinds = slots.map((s) => `${s.kind}:${s.field}`);
  assert.ok(kinds.includes('text:text'), 'has text slots');
  assert.ok(kinds.includes('attr:href'), 'has link slot');
  assert.ok(kinds.includes('attr:src'), 'has image src slot');
  assert.ok(kinds.includes('attr:alt'), 'has alt slot');
  // every slot has a default content value
  for (const s of slots) assert.equal(content[s.id], s.original);
});

test('ingest does not turn <script>/<title> text into slots', () => {
  const { slots } = ingest(SAMPLE);
  assert.ok(!slots.some((s) => s.original.includes('keep me frozen')), 'script text frozen');
  assert.ok(!slots.some((s) => s.original === 'Acme'), '<title> text frozen');
});

test('ingest strips scripts, script preloads and inline handlers (frozen = inert)', () => {
  const spa = `<html><head>
    <link rel="modulepreload" href="/chunk.js">
    <link rel="preload" as="script" href="/boot.js">
    <link rel="stylesheet" href="/a.css">
  </head><body>
    <h1 onclick="alert(1)">Hi</h1>
    <script src="/_next/static/chunks/main.js" async></script>
    <script>self.__next_f.push([0])</script>
  </body></html>`;
  const { template } = ingest(spa, 'https://example.test/');
  assert.doesNotMatch(template, /<script/i, 'no script tags survive');
  assert.doesNotMatch(template, /modulepreload|as="script"/i, 'no script preload hints survive');
  assert.doesNotMatch(template, /onclick/i, 'no inline handlers survive');
  assert.match(template, /rel="stylesheet"/, 'stylesheets untouched');
  assert.match(template, /<base href="https:\/\/example\.test\/">/, 'base href still injected');
});

test('ingest ids are stable across re-ingest of the same source', () => {
  const a = ingest(SAMPLE).slots.map((s) => s.id).sort();
  const b = ingest(SAMPLE).slots.map((s) => s.id).sort();
  assert.deepEqual(a, b);
});

test('slot ids are structural, not content-derived', () => {
  // same path + field => same id regardless of value
  assert.equal(slotId('html:1>body:1>h1:1>#text:0', 'text'), slotId('html:1>body:1>h1:1>#text:0', 'text'));
});

// --- render round-trips -----------------------------------------------------

test('publish render reproduces original content and strips edit markers', () => {
  const { template, slots, content } = ingest(SAMPLE);
  const html = render({ template, slots, content, mode: 'publish' });
  assert.ok(html.includes('Welcome to Acme'));
  assert.ok(html.includes('great widgets'));
  assert.ok(html.includes('src="/logo.png"'));
  assert.ok(!html.includes('data-v-attr'), 'edit markers stripped on publish');
  assert.ok(!html.includes(SENTINEL_OPEN), 'no sentinel leaks into output');
});

test('edit render wraps text slots and keeps attr markers', () => {
  const { template, slots, content } = ingest(SAMPLE);
  const html = render({ template, slots, content, mode: 'edit' });
  assert.ok(html.includes('data-v-slot='), 'text slots wrapped for editing');
  assert.ok(html.includes('data-v-attr='), 'attr markers present for editing');
});

test('edited content appears in publish output, escaped', () => {
  const { template, slots, content } = ingest(SAMPLE);
  const h1 = slots.find((s) => s.label === 'Heading 1');
  const next = { ...content, [h1.id]: 'Hello & <welcome>' };
  const html = render({ template, slots, content: next, mode: 'publish' });
  assert.ok(html.includes('Hello &amp; &lt;welcome&gt;'), 'value html-escaped');
  assert.ok(!html.includes('<welcome>'), 'raw markup not emitted');
});

// --- guardian ---------------------------------------------------------------

function fixture() {
  return ingest(SAMPLE);
}

test('guardian accepts a valid text change', () => {
  const { slots } = fixture();
  const h1 = slots.find((s) => s.label === 'Heading 1');
  assert.deepEqual(guardian(slots, { [h1.id]: 'New heading' }), { ok: true });
});

test('guardian rejects unknown slot', () => {
  const { slots } = fixture();
  const r = guardian(slots, { 'deadbeef0000': 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'unknown_slot');
});

test('guardian rejects emptying a required slot', () => {
  const { slots } = fixture();
  const h1 = slots.find((s) => s.label === 'Heading 1');
  const r = guardian(slots, { [h1.id]: '   ' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'empty_required');
});

test('guardian rejects markup in a plain-text slot', () => {
  const { slots } = fixture();
  const h1 = slots.find((s) => s.label === 'Heading 1');
  const r = guardian(slots, { [h1.id]: 'hi <script>alert(1)</script>' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'html_not_allowed');
});

test('guardian rejects javascript: url on a link slot', () => {
  const { slots } = fixture();
  const href = slots.find((s) => s.field === 'href');
  const r = guardian(slots, { [href.id]: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'unsafe_url');
});

test('guardian accepts a safe https url on a link slot', () => {
  const { slots } = fixture();
  const href = slots.find((s) => s.field === 'href');
  assert.deepEqual(guardian(slots, { [href.id]: 'https://acme.test/new' }), { ok: true });
});

test('guardian accepts scheme-less relative urls (ingest produces these)', () => {
  const { slots } = fixture();
  const src = slots.find((s) => s.field === 'src');
  // Bare relative (no leading slash), dot-relative, root-relative and anchors are
  // all safe — they cannot carry an executable scheme. Regressed: these used to
  // be rejected, which blocked editing a site's own ingested asset urls.
  for (const v of ['assets/spuddy.svg', './img/x.png', '../up.png', '/logo.png', '#top']) {
    assert.deepEqual(guardian(slots, { [src.id]: v }), { ok: true }, `should accept ${v}`);
  }
});

test('guardian allows data:image on src but rejects data:text/html', () => {
  const { slots } = fixture();
  const src = slots.find((s) => s.field === 'src');
  assert.deepEqual(
    guardian(slots, { [src.id]: 'data:image/png;base64,iVBORw0KGgo=' }),
    { ok: true },
  );
  const bad = guardian(slots, { [src.id]: 'data:text/html,<script>x</script>' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'unsafe_url');
});

test('ingest injects <base href> when given a source url, as first head child', () => {
  const { template } = ingest('<html><head><link rel="stylesheet" href="a.css"></head><body><p>hi</p></body></html>', 'https://example.test/');
  const headInner = /<head>([\s\S]*?)<\/head>/.exec(template)[1];
  assert.match(headInner, /^<base href="https:\/\/example\.test\/">/); // before the stylesheet
  // No base url -> template unchanged (existing callers/tests unaffected).
  assert.doesNotMatch(ingest(SAMPLE).template, /<base/);
});

test('guardian treats alt (non-url attr) as plain text: accepts plain, rejects markup', () => {
  const { slots } = fixture();
  const alt = slots.find((s) => s.field === 'alt');
  assert.deepEqual(guardian(slots, { [alt.id]: 'A new caption' }), { ok: true });
  const bad = guardian(slots, { [alt.id]: '<img onerror=alert(1)>' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].code, 'html_not_allowed');
});

test('guardian rejects a sentinel-forging value', () => {
  const { slots } = fixture();
  const h1 = slots.find((s) => s.label === 'Heading 1');
  const r = guardian(slots, { [h1.id]: `evil${SENTINEL_OPEN}abcabcabcabc` });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'forbidden_char');
});

test('guardian is pure — does not mutate inputs', () => {
  const { slots } = fixture();
  const snapshot = JSON.stringify(slots);
  guardian(slots, { nope: 'x' });
  assert.equal(JSON.stringify(slots), snapshot);
});
