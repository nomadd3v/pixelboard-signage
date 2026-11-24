// Demo build only: the fictional boards the static demo ships with.
// Every business, item, price, and line of copy here is invented for the demo —
// nothing is derived from data/ (real client boards) or src/templates.js.
//
// Each board is a parametric builder: the palette/type knobs change, the element
// ids never do. That is what lets the canned "✦ suggestions" in the studio
// restyle a board while the engine keeps the operator's content (slot ids derive
// from element ids — ADR-004 Decision 1).

import { photoFile } from './photos.js';

const rect = (id, x, y, w, h, style) => ({ id, type: 'rect', x, y, w, h, style });
const text = (id, x, y, w, h, value, style, label) => ({
  id, type: 'text', x, y, w, h, value, style,
  slot: label ? { editable: true, label } : { editable: false },
});
const image = (id, x, y, w, h, value, style, label) => ({
  id, type: 'image', x, y, w, h, value, style,
  slot: label ? { editable: true, label } : { editable: false },
});

// ---------------------------------------------------------------------------
// 1. Marigold Coffee Bar — landscape 16:9 drinks board with a pastry feature.
// ---------------------------------------------------------------------------
const MARIGOLD_LOOKS = {
  default: { name: 'Espresso & marigold', backdrop: 'espresso', scrim: '#0f0a07', scrimOpacity: 0.55, ink: '#f6ead8', accent: '#f2b24c', muted: '#cdb9a0', card: '#f6ead8', cardInk: '#2a1a10', cardAccent: '#b5541c', head: 'fraunces', price: 'oswald' },
  walnut: { name: 'Walnut & brass', backdrop: 'dark-wood', scrim: '#0b0705', scrimOpacity: 0.5, ink: '#fbf3e4', accent: '#d9a441', muted: '#c9b79c', card: '#1b120c', cardInk: '#fbf3e4', cardAccent: '#d9a441', head: 'playfair', price: 'oswald' },
  botanical: { name: 'Botanical green', backdrop: 'dark-botanical', scrim: '#050b07', scrimOpacity: 0.45, ink: '#eef3ea', accent: '#9fd4a3', muted: '#b5c7b3', card: '#eef3ea', cardInk: '#16301d', cardAccent: '#2f6b3a', head: 'fraunces', price: 'space-grotesk' },
  poster: { name: 'Bold condensed type', backdrop: 'amber-charcoal', scrim: '#000000', scrimOpacity: 0.4, ink: '#ffffff', accent: '#ffb000', muted: '#d0c3b0', card: '#ffb000', cardInk: '#140d05', cardAccent: '#140d05', head: 'bebas', price: 'bebas' },
};

function marigold(base, look = 'default') {
  const L = MARIGOLD_LOOKS[look];
  const drinks = [
    ['Espresso', '$3.25'], ['Cortado', '$4.00'], ['Flat White', '$4.50'],
    ['Honey Oat Latte', '$5.75'], ['Cold Brew', '$4.75'], ['Masala Chai', '$4.95'],
  ];
  const headSize = L.head === 'bebas' ? 120 : 96;
  const els = [
    image('backdrop', 0, 0, 1920, 1080, `${base}backdrops/${L.backdrop}.jpg`, { objectFit: 'cover' }),
    rect('scrim', 0, 0, 1920, 1080, { background: L.scrim, opacity: L.scrimOpacity }),
    text('brand', 110, 70, 900, 120, 'Marigold', { color: L.ink, fontFamily: L.head, fontSize: headSize, fontWeight: 900, letterSpacing: 1 }),
    text('tagline', 114, 196, 700, 40, 'COFFEE BAR', { color: L.accent, fontFamily: 'inter', fontSize: 26, fontWeight: 700, letterSpacing: 10 }),
    rect('rule', 114, 258, 120, 6, { background: L.accent, borderRadius: 3 }),
    text('menu-head', 114, 300, 820, 40, 'ESPRESSO & MORE', { color: L.muted, fontFamily: 'inter', fontSize: 24, fontWeight: 700, letterSpacing: 6 }),
  ];
  drinks.forEach(([name, price], i) => {
    const y = 360 + i * 92;
    els.push(text(`drink-${i + 1}`, 110, y, 640, 70, name, { color: L.ink, fontFamily: L.head, fontSize: L.head === 'bebas' ? 62 : 50, fontWeight: 600 }, `Drink ${i + 1}`));
    els.push(text(`price-${i + 1}`, 760, y, 200, 70, price, { color: L.accent, fontFamily: L.price, fontSize: L.price === 'bebas' ? 62 : 50, fontWeight: 600, textAlign: 'right' }, `Price ${i + 1}`));
  });
  els.push(
    text('footer', 114, 950, 880, 40, 'Oat, almond & whole milk · Extra shot +$1', { color: L.muted, fontFamily: 'inter', fontSize: 26, fontWeight: 500 }, 'Footer note'),
    rect('card', 1060, 100, 750, 880, { background: L.card, borderRadius: 28 }),
    text('special-kicker', 1120, 150, 630, 40, "TODAY'S PASTRY", { color: L.cardAccent, fontFamily: 'inter', fontSize: 28, fontWeight: 800, letterSpacing: 8, textAlign: 'center' }, 'Feature kicker'),
    image('special-photo', 1205, 215, 460, 460, `${base}${photoFile('morning-bun')}`, { objectFit: 'cover', borderRadius: 24 }, 'Feature photo'),
    text('special-name', 1100, 705, 670, 80, 'Cardamom Morning Bun', { color: L.cardInk, fontFamily: L.head, fontSize: L.head === 'bebas' ? 68 : 48, fontWeight: 900, textAlign: 'center' }, 'Feature name'),
    text('special-price', 1120, 785, 630, 90, '$4.75', { color: L.cardAccent, fontFamily: L.price, fontSize: 76, fontWeight: 700, textAlign: 'center' }, 'Feature price'),
    text('special-note', 1120, 910, 630, 40, 'Baked in-house every morning', { color: L.cardInk, fontFamily: 'inter', fontSize: 26, fontWeight: 500, textAlign: 'center', opacity: 0.75 }, 'Feature note'),
  );
  return { name: 'Marigold Coffee Bar — drinks', canvas: { w: 1920, h: 1080 }, elements: els };
}

// ---------------------------------------------------------------------------
// 2. Taco Comet — portrait 9:16 late-night taco stand.
// ---------------------------------------------------------------------------
const TACO_LOOKS = {
  default: { name: 'Midnight indigo', bg: '#14112b', card: '#241f4a', ink: '#ffffff', accent: '#ffc53d', hot: '#ff4f7b', muted: '#b9b4e0', title: 'anton', item: 'oswald' },
  sunset: { name: 'Sunset orange', bg: '#2b0f0a', card: '#43190f', ink: '#fff4e8', accent: '#ffb000', hot: '#ff6a3d', muted: '#e6b8a2', title: 'anton', item: 'oswald' },
  tropical: { name: 'Tropical teal', bg: '#0c2826', card: '#123d3a', ink: '#f2fffb', accent: '#ffd166', hot: '#ef476f', muted: '#9fd3c9', title: 'archivo-black', item: 'space-grotesk' },
  poster: { name: 'Bold poster', bg: '#ffc53d', card: '#14112b', ink: '#14112b', accent: '#14112b', hot: '#d61f55', muted: '#3b3566', title: 'bebas', item: 'bebas' },
};

function tacoComet(base, look = 'default') {
  const L = TACO_LOOKS[look];
  const cardInk = look === 'poster' ? '#ffffff' : L.ink;
  const cardAccent = look === 'poster' ? '#ffc53d' : L.accent;
  const titleSize = L.title === 'bebas' ? 250 : L.title === 'archivo-black' ? 170 : 200;
  const itemSize = L.item === 'bebas' ? 66 : 54;
  const lineup = [
    ['Al Pastor', '$3.75'], ['Carne Asada', '$4.25'], ['Pollo Asado', '$3.50'],
    ['Crispy Fish', '$4.25'], ['Rajas & Queso', '$3.25'],
  ];
  const els = [
    rect('bg', 0, 0, 1080, 1920, { background: L.bg }),
    rect('comet', 760, 90, 200, 200, { background: L.accent, borderRadius: 100 }),
    rect('trail-1', 560, 170, 180, 14, { background: L.accent, borderRadius: 7, opacity: 0.7 }),
    rect('trail-2', 500, 214, 220, 10, { background: L.hot, borderRadius: 5, opacity: 0.7 }),
    rect('trail-3', 600, 250, 130, 8, { background: L.accent, borderRadius: 4, opacity: 0.45 }),
    text('title-1', 80, 100, 920, 220, 'TACO', { color: L.accent, fontFamily: L.title, fontSize: titleSize, fontWeight: 400, lineHeight: 1 }),
    text('title-2', 80, 320, 920, 220, 'COMET', { color: L.ink, fontFamily: L.title, fontSize: titleSize, fontWeight: 400, lineHeight: 1 }),
    text('tagline', 84, 548, 920, 50, 'STREET TACOS · OPEN LATE', { color: L.hot, fontFamily: 'inter', fontSize: 36, fontWeight: 800, letterSpacing: 8 }, 'Tagline'),
    rect('card', 60, 640, 960, 600, { background: L.card, borderRadius: 36 }),
    image('special-photo', 100, 680, 440, 440, `${base}${photoFile('taco')}`, { objectFit: 'cover', borderRadius: 28 }, 'Special photo'),
    text('special-kicker', 580, 690, 410, 40, "TONIGHT'S SPECIAL", { color: L.hot, fontFamily: 'inter', fontSize: 28, fontWeight: 800, letterSpacing: 5 }, 'Special kicker'),
    text('special-name', 580, 745, 410, 150, 'Birria Quesataco', { color: cardInk, fontFamily: L.item, fontSize: L.item === 'bebas' ? 84 : 66, fontWeight: 700, lineHeight: 1.05 }, 'Special name'),
    text('special-desc', 580, 915, 410, 120, 'Slow-braised beef, melty cheese, cup of consommé', { color: look === 'poster' ? '#cfcaf2' : L.muted, fontFamily: 'inter', fontSize: 30, fontWeight: 400, lineHeight: 1.3 }, 'Special description'),
    text('special-price', 580, 1060, 410, 130, '$4.50', { color: cardAccent, fontFamily: L.title, fontSize: 110, fontWeight: 400, lineHeight: 1 }, 'Special price'),
    text('lineup-head', 84, 1300, 920, 44, 'THE LINEUP', { color: L.muted, fontFamily: 'inter', fontSize: 32, fontWeight: 800, letterSpacing: 8 }),
  ];
  lineup.forEach(([name, price], i) => {
    const y = 1370 + i * 94;
    els.push(text(`taco-${i + 1}`, 80, y, 700, 70, name, { color: L.ink, fontFamily: L.item, fontSize: itemSize, fontWeight: 600 }, `Taco ${i + 1}`));
    els.push(text(`taco-price-${i + 1}`, 780, y, 220, 70, price, { color: L.accent, fontFamily: L.item, fontSize: itemSize, fontWeight: 600, textAlign: 'right' }, `Taco price ${i + 1}`));
  });
  els.push(text('footer', 84, 1850, 920, 40, '3 for $11 before 9pm · Ask about our salsas', { color: L.muted, fontFamily: 'inter', fontSize: 28, fontWeight: 500 }, 'Footer note'));
  return { name: 'Taco Comet — tonight', canvas: { w: 1080, h: 1920 }, elements: els };
}

// ---------------------------------------------------------------------------
// 3. Sunday Loaf Bakery — square 1:1 daily bake feature.
// ---------------------------------------------------------------------------
const LOAF_LOOKS = {
  default: { name: 'Warm flour', backdrop: 'bakery-warm-flour', scrim: '#fff8ee', scrimOpacity: 0.2, ink: '#2a1a10', soft: '#6b5442', accent: '#b5541c', band: '#2a1a10', bandInk: '#f6ead8', bandAccent: '#e8a45f', head: 'playfair' },
  birch: { name: 'Birch wood', backdrop: 'light-birch-wood', scrim: '#fffaf2', scrimOpacity: 0.3, ink: '#1f2a1c', soft: '#4f5b47', accent: '#3d7a47', band: '#1f2a1c', bandInk: '#f3f1e7', bandAccent: '#a9d18e', head: 'fraunces' },
  moody: { name: 'Dark & moody', backdrop: 'amber-charcoal', scrim: '#000000', scrimOpacity: 0.35, ink: '#f6ead8', soft: '#cdb9a0', accent: '#f2b24c', band: '#f2b24c', bandInk: '#1a1108', bandAccent: '#1a1108', head: 'playfair' },
  modern: { name: 'Modern grotesk', backdrop: 'warm-linen', scrim: '#ffffff', scrimOpacity: 0.15, ink: '#161616', soft: '#555555', accent: '#e0572b', band: '#161616', bandInk: '#ffffff', bandAccent: '#e0572b', head: 'space-grotesk' },
};

function sundayLoaf(base, look = 'default') {
  const L = LOAF_LOOKS[look];
  return {
    name: 'Sunday Loaf Bakery — fresh today',
    canvas: { w: 1080, h: 1080 },
    elements: [
      image('backdrop', 0, 0, 1080, 1080, `${base}backdrops/${L.backdrop}.jpg`, { objectFit: 'cover' }),
      rect('scrim', 0, 0, 1080, 1080, { background: L.scrim, opacity: L.scrimOpacity }),
      text('brand', 80, 70, 920, 40, 'SUNDAY LOAF · BAKERY', { color: L.accent, fontFamily: 'inter', fontSize: 28, fontWeight: 800, letterSpacing: 8 }),
      text('headline', 80, 125, 920, 100, 'Fresh out of the oven', { color: L.ink, fontFamily: L.head, fontSize: 74, fontWeight: 800, letterSpacing: -1 }, 'Headline'),
      image('photo', 80, 270, 460, 460, `${base}${photoFile('sourdough')}`, { objectFit: 'cover', borderRadius: 28 }, 'Photo'),
      text('item', 590, 290, 410, 140, 'Country Sourdough', { color: L.ink, fontFamily: L.head, fontSize: 56, fontWeight: 700, lineHeight: 1.1 }, 'Item'),
      text('desc', 590, 440, 410, 90, 'Naturally leavened, 36-hour ferment', { color: L.soft, fontFamily: 'inter', fontSize: 30, fontWeight: 400, lineHeight: 1.3 }, 'Description'),
      text('price', 590, 545, 410, 120, '$9', { color: L.accent, fontFamily: 'oswald', fontSize: 110, fontWeight: 700, lineHeight: 1 }, 'Price'),
      rect('badge', 590, 680, 320, 60, { background: L.band, borderRadius: 30 }),
      text('badge-text', 590, 694, 320, 40, 'WARM AT 7 & 11', { color: L.bandInk, fontFamily: 'inter', fontSize: 24, fontWeight: 800, letterSpacing: 3, textAlign: 'center' }, 'Badge'),
      rect('band', 0, 830, 1080, 250, { background: L.band }),
      text('also-head', 80, 868, 920, 36, 'ALSO TODAY', { color: L.bandAccent, fontFamily: 'inter', fontSize: 26, fontWeight: 800, letterSpacing: 6 }),
      text('also', 80, 915, 920, 100, 'Cinnamon rolls $4.25 · Seeded rye $10 · Olive fougasse $7', { color: L.bandInk, fontFamily: 'inter', fontSize: 32, fontWeight: 500, lineHeight: 1.35 }, 'Also today'),
    ],
  };
}

// id -> { build, looks, story } — `story` names the element ids the guided
// "try to break it" buttons aim at, so each board demos every Guardian rule.
export const SEEDS = [
  {
    id: 'marigold', build: marigold, looks: MARIGOLD_LOOKS, business: 'Marigold Coffee Bar', kind: 'Coffee bar · landscape 16:9 menu',
    story: { price: 'special-price', markup: 'special-name', image: 'special-photo', token: 'footer', design: 'brand' },
  },
  {
    id: 'taco-comet', build: tacoComet, looks: TACO_LOOKS, business: 'Taco Comet', kind: 'Taco stand · portrait 9:16 board',
    story: { price: 'special-price', markup: 'special-name', image: 'special-photo', token: 'tagline', design: 'title-1' },
  },
  {
    id: 'sunday-loaf', build: sundayLoaf, looks: LOAF_LOOKS, business: 'Sunday Loaf Bakery', kind: 'Bakery · square 1:1 feature',
    story: { price: 'price', markup: 'headline', image: 'photo', token: 'badge-text', design: 'brand' },
  },
];

export const seedById = (id) => SEEDS.find((s) => s.id === id) || null;
