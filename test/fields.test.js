// Operator field list: labels and grouping derived from the slot manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ingest } from '../src/ingest.js';
import { compileBoard } from '../src/board/compile.js';
import { fieldGroups, looksNumeric } from '../src/fields.js';

const BOARD = `<html><body>
<header><img src="/logo.png" alt="Shop"><h1>Tech <b>Cash</b> Challenge</h1><span>Week of 10/23</span></header>
<table>
  <thead><tr><th>Tech</th><th>Reviews</th><th>Total monthly</th></tr></thead>
  <tbody>
    <tr><td><span>1</span><span>Jeff</span></td><td>0</td><td><span>$184,729.84</span></td></tr>
    <tr><td><span>2</span><span>Chris</span></td><td>1</td><td><span>$185,953.74</span></td></tr>
  </tbody>
</table>
<footer><em>⏱</em>Beat the bid</footer>
<p>Sample numbers</p>
</body></html>`;

test('table rows become groups named after the person, cells labelled by column heading', () => {
  const { slots, content } = ingest(BOARD);
  const groups = fieldGroups(slots, content);
  const jeff = groups.find((g) => g.title === 'Jeff');
  assert.ok(jeff, 'row group titled by its lettered text');
  assert.equal(jeff.kind, 'row');
  const labels = jeff.fields.map((f) => f.label);
  assert.deepEqual(labels.sort(), ['Reviews', 'Tech', 'Tech 2', 'Total monthly'].sort());
  // the name keeps the plain heading; the rank number is the duplicate
  assert.equal(jeff.fields.find((f) => f.label === 'Tech').value, 'Jeff');
  assert.equal(jeff.fields.find((f) => f.label === 'Tech 2').value, '1');
  assert.equal(jeff.fields.find((f) => f.label === 'Total monthly').numeric, true);
  assert.equal(jeff.fields.find((f) => f.label === 'Tech').numeric, false);
  assert.ok(groups.find((g) => g.title === 'Chris'));
});

test('header/footer/thead/loose text land in named groups; attrs get plain labels', () => {
  const { slots, content } = ingest(BOARD);
  const groups = fieldGroups(slots, content);
  const top = groups.find((g) => g.title === 'Top of board');
  assert.ok(top);
  assert.deepEqual(top.fields.map((f) => f.label), ['Picture', 'Picture description', 'Headline', 'Bold text', 'Headline 2', 'Text']);
  assert.equal(groups.find((g) => g.kind === 'headings').fields.map((f) => f.label).join(','), 'Column 1,Column 2,Column 3');
  assert.equal(groups.find((g) => g.title === 'Bottom of board').fields[0].label, 'Icon');
  assert.equal(groups.find((g) => g.kind === 'other').fields[0].value, 'Sample numbers');
  // first group is the header (document order is preserved)
  assert.equal(groups[0].title, 'Top of board');
});

test('field values come from HEAD content, not the original', () => {
  const { slots, content } = ingest(BOARD);
  const total = slots.find((s) => s.original === '$184,729.84');
  const groups = fieldGroups(slots, { ...content, [total.id]: '$1.00' });
  const f = groups.flatMap((g) => g.fields).find((x) => x.slotId === total.id);
  assert.equal(f.value, '$1.00');
});

test('studio boards form one group with the designer labels', () => {
  const art = compileBoard({
    name: 'b', canvas: { w: 1920, h: 1080 },
    elements: [
      { id: 'title', type: 'text', x: 0, y: 0, w: 100, h: 50, value: 'Hi', style: {}, slot: { editable: true, label: 'Title' } },
      { id: 'price', type: 'text', x: 0, y: 0, w: 100, h: 50, value: '$9', style: {}, slot: { editable: true, label: 'Price' } },
      { id: 'pic', type: 'image', x: 0, y: 0, w: 100, h: 50, value: 'https://x.test/a.png', slot: { editable: true, label: 'Photo' } },
    ],
  });
  const groups = fieldGroups(art.slots, art.content);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'board');
  assert.deepEqual(groups[0].fields.map((f) => f.label), ['Title', 'Price', 'Photo']);
  assert.equal(groups[0].fields[1].numeric, true);
});

test('looksNumeric accepts money/counts/dashes, rejects words', () => {
  for (const v of ['$184,729.84', '0', '12 %', '(3)', '1/2']) assert.equal(looksNumeric(v), true, v);
  for (const v of ['Jeff', '—', '++--', '', 'Week of 10/23']) assert.equal(looksNumeric(v), false, v);
});
