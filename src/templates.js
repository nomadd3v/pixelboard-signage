// Built-in template library. A template IS a board doc ({name, canvas, elements})
// that passes validateBoard() — no new artifact type (ADR-004). v1 ships curated
// built-ins; the durable roadmap (docs/template-system-roadmap.md) defines the
// canonical tagging system this `tags` shape will grow into.
//
// Tags follow the canonical grammar in docs/template-system-roadmap.md §2:
// `facet:value`, lowercase-kebab, controlled vocabulary, NO colon inside a value.
// Authors set only CONTENT facets (category/industry/style/color-theme/density/
// occasion); the SHAPE facets (orientation, aspect) are COMPUTED from canvas so
// they can never drift from the actual board geometry.

// orientation + aspect derived from canvas geometry (canonical computed-facet rule).
const ASPECT_BUCKETS = [
  { r: 16 / 9, tag: '16x9' }, { r: 9 / 16, tag: '9x16' }, { r: 1, tag: '1x1' },
  { r: 21 / 9, tag: '21x9' }, { r: 4 / 3, tag: '4x3' },
];
function shapeFacets({ w, h }) {
  const orientation = w > h ? 'landscape' : w < h ? 'portrait' : 'square';
  const r = w / h;
  const hit = ASPECT_BUCKETS.find((b) => Math.abs(b.r - r) / b.r < 0.02);
  return [`orientation:${orientation}`, `aspect:${hit ? hit.tag : 'custom'}`];
}

const BLUE = '#2E6BFF', VIOLET = '#7B2FF7', MAGENTA = '#FF2EC4', INK = '#0A0A0A', WHITE = '#FFFFFF';

// Helpers keep the literal boards terse and consistent.
const rect = (id, x, y, w, h, background, borderRadius = 0) => ({ id, type: 'rect', x, y, w, h, style: { background, ...(borderRadius ? { borderRadius } : {}) } });
const text = (id, x, y, w, h, value, style, label) => ({
  id, type: 'text', x, y, w, h, value,
  style: { fontFamily: 'inter', color: WHITE, ...style },
  ...(label ? { slot: { editable: true, label } } : {}),
});

const TEMPLATES = [
  {
    id: 'daily-special-landscape',
    name: 'Daily Special',
    description: 'Bold single-item special with price — the workhorse menu board.',
    tags: ['category:menu-board', 'industry:restaurant', 'style:bold-modern', 'color-theme:dark', 'density:single-focus'],
    board: {
      name: 'Daily Special',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, INK),
        rect('accent', 0, 0, 1920, 16, MAGENTA),
        text('kicker', 120, 150, 1680, 90, "TODAY'S SPECIAL", { fontSize: 64, fontWeight: 700, color: MAGENTA, letterSpacing: 8 }, 'Kicker'),
        text('title', 120, 280, 1680, 320, 'Surf & Turf Spud', { fontSize: 200, fontWeight: 900 }, 'Title'),
        text('desc', 120, 640, 1280, 200, 'Loaded baked potato, garlic shrimp, and steak tips — made fresh.', { fontSize: 56, fontWeight: 400, color: '#cfcfd6', lineHeight: 1.3 }, 'Description'),
        text('price', 120, 860, 1680, 160, '$14.99', { fontSize: 150, fontWeight: 900, color: BLUE }, 'Price'),
      ],
    },
  },
  {
    id: 'two-column-menu-landscape',
    name: 'Two-Column Menu',
    description: 'Six items in two columns with prices — full menu at a glance.',
    tags: ['category:menu-board', 'industry:restaurant', 'style:minimal', 'color-theme:dark', 'density:multi-item-menu'],
    board: {
      name: 'Menu',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, INK),
        text('heading', 120, 70, 1680, 110, 'Menu', { fontSize: 96, fontWeight: 800, textAlign: 'center' }, 'Heading'),
        // left column
        text('l1', 120, 260, 700, 70, 'Classic Spud', { fontSize: 56, fontWeight: 700 }, 'Item 1'),
        text('l1p', 820, 260, 120, 70, '$9', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 1'),
        text('l2', 120, 400, 700, 70, 'Loaded Bacon', { fontSize: 56, fontWeight: 700 }, 'Item 2'),
        text('l2p', 820, 400, 120, 70, '$11', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 2'),
        text('l3', 120, 540, 700, 70, 'Veggie Deluxe', { fontSize: 56, fontWeight: 700 }, 'Item 3'),
        text('l3p', 820, 540, 120, 70, '$10', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 3'),
        // right column
        text('r1', 1020, 260, 700, 70, 'Surf & Turf', { fontSize: 56, fontWeight: 700 }, 'Item 4'),
        text('r1p', 1720, 260, 120, 70, '$15', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 4'),
        text('r2', 1020, 400, 700, 70, 'Pulled Pork', { fontSize: 56, fontWeight: 700 }, 'Item 5'),
        text('r2p', 1720, 400, 120, 70, '$13', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 5'),
        text('r3', 1020, 540, 700, 70, 'Chili Cheese', { fontSize: 56, fontWeight: 700 }, 'Item 6'),
        text('r3p', 1720, 540, 120, 70, '$12', { fontSize: 56, fontWeight: 700, color: BLUE, textAlign: 'right' }, 'Price 6'),
      ],
    },
  },
  {
    id: 'promo-sale-landscape',
    name: 'Promo / Sale',
    description: 'High-impact promo with a gradient-accent band and call to action.',
    tags: ['category:promo', 'industry:retail', 'style:bold-modern', 'color-theme:vibrant', 'density:single-focus', 'occasion:sale'],
    board: {
      name: 'Promo',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, INK),
        rect('band', 0, 360, 1920, 360, VIOLET),
        text('eyebrow', 120, 150, 1680, 90, 'LIMITED TIME', { fontSize: 60, fontWeight: 700, color: MAGENTA, letterSpacing: 10 }, 'Eyebrow'),
        text('headline', 120, 400, 1680, 280, '20% OFF', { fontSize: 240, fontWeight: 900, textAlign: 'center' }, 'Headline'),
        text('cta', 120, 800, 1680, 100, 'Order online for fast pickup', { fontSize: 64, fontWeight: 600, textAlign: 'center', color: '#dcdce4' }, 'Call to action'),
      ],
    },
  },
  {
    id: 'event-announcement-landscape',
    name: 'Event Announcement',
    description: 'Date, title, and details for live music, trivia, or happenings.',
    tags: ['category:event', 'industry:events', 'industry:bar', 'style:editorial', 'color-theme:dark', 'density:single-focus'],
    board: {
      name: 'Event',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, INK),
        rect('rule', 120, 250, 360, 10, MAGENTA),
        text('date', 120, 130, 1680, 90, 'FRIDAY · 8PM', { fontSize: 60, fontWeight: 700, color: BLUE, letterSpacing: 6 }, 'Date & time'),
        text('title', 120, 320, 1680, 300, 'Live Music Night', { fontSize: 170, fontWeight: 900, lineHeight: 1.05 }, 'Title'),
        text('details', 120, 720, 1680, 200, 'Featuring local artists · No cover · Full bar & kitchen open late', { fontSize: 56, fontWeight: 400, color: '#cfcfd6', lineHeight: 1.3 }, 'Details'),
      ],
    },
  },
  {
    id: 'now-hiring-portrait',
    name: 'Now Hiring',
    description: 'Portrait recruiting board with QR-ready space and roles.',
    tags: ['category:announcement', 'industry:restaurant', 'style:bold-modern', 'color-theme:dark', 'density:single-focus'],
    board: {
      name: 'Now Hiring',
      canvas: { w: 1080, h: 1920 },
      elements: [
        rect('bg', 0, 0, 1080, 1920, INK),
        rect('accent', 0, 0, 1080, 24, MAGENTA),
        text('eyebrow', 80, 160, 920, 90, 'JOIN THE TEAM', { fontSize: 56, fontWeight: 700, color: MAGENTA, letterSpacing: 8 }, 'Eyebrow'),
        text('title', 80, 300, 920, 360, 'NOW HIRING', { fontSize: 180, fontWeight: 900, lineHeight: 1.0 }, 'Title'),
        text('roles', 80, 720, 920, 400, 'Line cooks\nServers\nShift leads', { fontSize: 80, fontWeight: 600, color: '#dcdce4', lineHeight: 1.5 }, 'Roles'),
        text('cta', 80, 1640, 920, 120, 'Apply at the counter or scan →', { fontSize: 52, fontWeight: 500, color: BLUE }, 'Call to action'),
      ],
    },
  },
  {
    id: 'happy-hour-bar',
    name: 'Happy Hour',
    description: 'Nightlife happy-hour promo — electric on deep indigo, centered.',
    tags: ['category:promo', 'industry:bar', 'style:bold-modern', 'color-theme:cool', 'color-theme:dark', 'occasion:happy-hour', 'density:single-focus'],
    board: {
      name: 'Happy Hour',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, '#11121f'),
        text('kicker', 0, 170, 1920, 80, 'HAPPY HOUR', { fontFamily: 'space-grotesk', fontSize: 60, fontWeight: 700, color: '#6c8cff', textAlign: 'center', letterSpacing: 6 }, 'Kicker'),
        text('title', 0, 330, 1920, 240, 'HALF-PRICE DRINKS', { fontFamily: 'anton', fontSize: 140, fontWeight: 400, textAlign: 'center' }, 'Title'),
        text('time', 0, 680, 1920, 220, '4 – 7 PM', { fontFamily: 'bebas', fontSize: 200, fontWeight: 400, color: '#6c8cff', textAlign: 'center' }, 'Time'),
      ],
    },
  },
  {
    id: 'weekend-sale',
    name: 'Weekend Sale',
    description: 'Bold storewide sale — saturated color field, massive number.',
    tags: ['category:promo', 'industry:retail', 'style:bold-modern', 'color-theme:vibrant', 'occasion:sale', 'density:single-focus'],
    board: {
      name: 'Weekend Sale',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, BLUE),
        text('kicker', 0, 180, 1920, 80, 'THIS WEEKEND ONLY', { fontFamily: 'inter', fontSize: 56, fontWeight: 700, textAlign: 'center', letterSpacing: 6 }, 'Kicker'),
        text('headline', 0, 330, 1920, 380, '30% OFF', { fontFamily: 'archivo-black', fontSize: 300, fontWeight: 400, textAlign: 'center' }, 'Headline'),
        text('sub', 0, 800, 1920, 90, 'Storewide · in-store only', { fontFamily: 'inter', fontSize: 52, fontWeight: 500, textAlign: 'center', color: '#dbe6ff' }, 'Subtitle'),
      ],
    },
  },
  {
    id: 'coffee-hours',
    name: 'Cafe Hours',
    description: 'Warm cafe hours board — espresso header band on cream.',
    tags: ['category:hours', 'industry:cafe', 'style:elegant', 'color-theme:warm', 'color-theme:light', 'density:single-focus'],
    board: {
      name: 'Cafe Hours',
      canvas: { w: 1920, h: 1080 },
      elements: [
        rect('bg', 0, 0, 1920, 1080, '#f5efe6'),
        rect('band', 0, 0, 1920, 300, '#2a1d12'),
        text('title', 0, 95, 1920, 130, 'The Daily Grind', { fontFamily: 'playfair', fontSize: 100, fontWeight: 800, color: '#f5efe6', textAlign: 'center' }, 'Title'),
        text('hours', 0, 480, 1920, 220, 'OPEN 7 – 3 DAILY', { fontFamily: 'bebas', fontSize: 200, fontWeight: 400, color: '#2a1d12', textAlign: 'center' }, 'Hours'),
        text('sub', 0, 760, 1920, 80, 'Fresh pastries until sold out', { fontFamily: 'inter', fontSize: 48, fontWeight: 500, color: '#b8860b', textAlign: 'center' }, 'Subtitle'),
      ],
    },
  },
  {
    id: 'open-house-portrait',
    name: 'Open House',
    description: 'Elegant portrait open-house / event board with amber accents.',
    tags: ['category:event', 'industry:generic', 'style:elegant', 'color-theme:dark', 'color-theme:warm', 'density:single-focus'],
    board: {
      name: 'Open House',
      canvas: { w: 1080, h: 1920 },
      elements: [
        rect('bg', 0, 0, 1080, 1920, '#1a1a1a'),
        text('kicker', 80, 200, 920, 80, 'OPEN HOUSE', { fontFamily: 'inter', fontSize: 54, fontWeight: 700, color: '#f0a500', letterSpacing: 8, textAlign: 'center' }, 'Kicker'),
        text('addr', 80, 430, 920, 420, '123 Maple Ave', { fontFamily: 'fraunces', fontSize: 130, fontWeight: 900, lineHeight: 1.05, textAlign: 'center' }, 'Address'),
        text('time', 80, 1020, 920, 180, 'SAT 12 – 3 PM', { fontFamily: 'bebas', fontSize: 170, fontWeight: 400, color: '#f0a500', textAlign: 'center' }, 'Time'),
        text('detail', 80, 1320, 920, 120, '3 bed · 2 bath · 1,800 sqft', { fontFamily: 'inter', fontSize: 48, fontWeight: 500, color: '#cfcfd6', textAlign: 'center' }, 'Detail'),
      ],
    },
  },
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

/** Public list (no board payload) for the gallery. Shape facets are computed + merged. */
export function listTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id, name: t.name, description: t.description, canvas: t.board.canvas,
    tags: [...shapeFacets(t.board.canvas), ...t.tags],
  }));
}

/** Full template by id, or null. */
export function getTemplate(id) {
  return byId.get(id) || null;
}

/** A fresh DEEP CLONE of a template's board doc (never hand back the shared module object). */
export function instantiateTemplate(id) {
  const t = byId.get(id);
  return t ? structuredClone(t.board) : null;
}

export { TEMPLATES };
