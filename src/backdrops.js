// Backdrop library — pre-generated atmospheric images (codex/OpenAI, batch) the
// AI/operator can drop behind a board. Codex is a batch tool, not a sync API
// (ADR note), so backdrops are generated offline into public/backdrops/ and
// served statically; the app PICKS one by canonical-tag overlap (roadmap §2.5)
// and applies it full-bleed under a dark scrim so text stays legible.
//
// BACKDROPS — generated offline via codex (ChatGPT-sub image gen), normalized to
// 1920x1080 JPEGs in public/backdrops/. Tags use the canonical content facets
// (color-theme/industry/occasion/style). Dark backdrops have dark, text-safe
// centers (verified); color-theme:light backdrops are calm-center light boards
// meant for dark text.
export const BACKDROPS = [
  { file: '/backdrops/amber-charcoal.jpg', desc: 'Near-black charcoal with warm amber smoky rim light from the top edges.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:restaurant', 'style:elegant'] },
  { file: '/backdrops/dark-wood.jpg', desc: 'Dark rustic walnut wood grain, raked edge lighting at the top.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:restaurant', 'industry:bar', 'style:editorial'] },
  { file: '/backdrops/smoky-embers.jpg', desc: 'Dark BBQ atmosphere, glowing orange embers and smoke at the lower-left and edges.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:restaurant', 'style:bold-modern'] },
  { file: '/backdrops/espresso.jpg', desc: 'Deep espresso and coffee tones, crema-like swirl with light in the upper corners.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:cafe', 'style:elegant'] },
  { file: '/backdrops/dark-slate.jpg', desc: 'Cool dark slate and blue-grey stone with a faint cool glow along the top edge.', tags: ['color-theme:dark', 'color-theme:cool', 'industry:generic', 'style:minimal'] },
  { file: '/backdrops/indigo-neon.jpg', desc: 'Deep indigo nightlife with soft magenta and cyan neon bleeding from the corners.', tags: ['color-theme:dark', 'color-theme:vibrant', 'industry:bar', 'occasion:happy-hour', 'style:bold-modern'] },
  { file: '/backdrops/dark-marble.jpg', desc: 'Elegant black-and-charcoal marble with subtle grey veining, refined upper-edge light.', tags: ['color-theme:dark', 'color-theme:mono', 'industry:retail', 'style:elegant'] },
  { file: '/backdrops/dark-botanical.jpg', desc: 'Deep dark-green foliage into near-black, dappled light through the top corners.', tags: ['color-theme:dark', 'color-theme:cool', 'industry:cafe', 'occasion:seasonal', 'style:editorial'] },
  { file: '/backdrops/warm-linen.jpg', desc: 'Soft warm cream linen, calm mid-tone center — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:warm', 'industry:bakery', 'style:minimal'] },
  { file: '/backdrops/violet-magenta.jpg', desc: 'Vibrant violet-to-magenta haze at the side edges over a pure-black center.', tags: ['color-theme:vibrant', 'color-theme:dark', 'industry:bar', 'occasion:grand-opening', 'style:playful'] },
  { file: '/backdrops/golden-hour.jpg', desc: 'Warm golden-hour flare and bokeh from the top corners over a black lower frame.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:generic', 'occasion:seasonal', 'style:editorial'] },
  { file: '/backdrops/dark-concrete.jpg', desc: 'Minimal charcoal concrete with soft grazing light on one top edge.', tags: ['color-theme:dark', 'color-theme:mono', 'industry:retail', 'style:minimal'] },
  // --- v2 library growth (codex batch) — light boards for dark text + more themes ---
  { file: '/backdrops/clean-white-studio.jpg', desc: 'Bright seamless white studio sweep, soft even light — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:mono', 'industry:retail', 'style:minimal'] },
  { file: '/backdrops/soft-pastel-pink.jpg', desc: 'Airy pastel pink-and-cream gradient, dreamy and calm — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:pastel', 'industry:salon', 'style:playful'] },
  { file: '/backdrops/light-birch-wood.jpg', desc: 'Pale blonde birch wood grain, soft diffused light — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:warm', 'industry:cafe', 'style:handcrafted'] },
  { file: '/backdrops/light-marble.jpg', desc: 'Bright white Carrara marble with faint grey veining — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:mono', 'industry:retail', 'style:elegant'] },
  { file: '/backdrops/sunset-gradient.jpg', desc: 'Cinematic sunset gradient, orange into pink into deep purple, darker lower center.', tags: ['color-theme:vibrant', 'color-theme:warm', 'industry:bar', 'occasion:summer', 'style:bold-modern'] },
  { file: '/backdrops/neon-cyan-pink.jpg', desc: 'Near-black center with soft cyan and pink neon glow bleeding from the edges.', tags: ['color-theme:dark', 'color-theme:vibrant', 'industry:bar', 'occasion:happy-hour', 'style:bold-modern'] },
  { file: '/backdrops/tropical-teal.jpg', desc: 'Deep teal and emerald with shadowy palm-leaf silhouettes at the edges, dark center.', tags: ['color-theme:dark', 'color-theme:cool', 'industry:restaurant', 'occasion:summer', 'style:editorial'] },
  { file: '/backdrops/deep-blue-gradient.jpg', desc: 'Sleek navy-to-electric-blue gradient with a dark calm lower center.', tags: ['color-theme:dark', 'color-theme:cool', 'color-theme:brand-blue', 'industry:generic', 'style:tech'] },
  { file: '/backdrops/gym-dark-energy.jpg', desc: 'Dark charcoal with energetic red and orange light streaks from the edges, black center.', tags: ['color-theme:dark', 'color-theme:vibrant', 'industry:gym', 'style:bold-modern'] },
  { file: '/backdrops/spa-soft-sage.jpg', desc: 'Calm sage-green and cream, serene even light — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:cool', 'industry:salon', 'style:minimal'] },
  { file: '/backdrops/bakery-warm-flour.jpg', desc: 'Warm cream with a soft haze of flour dust and golden light — a LIGHT board for dark text.', tags: ['color-theme:light', 'color-theme:warm', 'industry:bakery', 'style:handcrafted'] },
  { file: '/backdrops/luxe-gold-black.jpg', desc: 'Elegant black with refined gold light flares from the top corners over a near-black center.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:hotel', 'style:elegant'] },
  { file: '/backdrops/autumn-amber.jpg', desc: 'Deep amber, rust, and red bokeh glowing at the edges over a dark calm center.', tags: ['color-theme:dark', 'color-theme:warm', 'industry:cafe', 'occasion:fall', 'style:editorial'] },
  { file: '/backdrops/winter-frost.jpg', desc: 'Cool icy white-blue with soft frost texture and gentle edge light — a LIGHT board for winter.', tags: ['color-theme:light', 'color-theme:cool', 'industry:generic', 'occasion:winter', 'style:minimal'] },
];

/** All backdrops (for a gallery/picker UI). */
export function listBackdrops() {
  return BACKDROPS.map((b) => ({ file: b.file, desc: b.desc, tags: b.tags }));
}

/**
 * Pick the best backdrop by tag overlap with `queryTags`. color-theme matches
 * weigh double. Returns null if the library is empty.
 */
export function pickBackdrop(queryTags = [], list = BACKDROPS) {
  if (!list.length) return null;
  const q = new Set(queryTags);
  let best = null, bestScore = -1;
  for (const b of list) {
    const score = b.tags.reduce((s, t) => s + (q.has(t) ? (t.startsWith('color-theme:') ? 2 : 1) : 0), 0);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/**
 * Apply a backdrop to a board doc: drop any full-bleed background rect, then put
 * the backdrop image full-bleed at the bottom with a dark scrim over it, leaving
 * all other elements on top. Pure — returns a new board (still validateBoard-safe).
 */
export function applyBackdrop(board, backdrop, scrimOpacity = 0.5) {
  const { w, h } = board.canvas;
  const isFullBleedRect = (e) => e.type === 'rect' && e.x <= 0 && e.y <= 0 && e.w >= w && e.h >= h;
  const rest = board.elements.filter((e) => !isFullBleedRect(e) && e.id !== 'backdrop' && e.id !== 'scrim');
  const image = { id: 'backdrop', type: 'image', x: 0, y: 0, w, h, value: backdrop.file, style: { objectFit: 'cover' } };
  const scrim = { id: 'scrim', type: 'rect', x: 0, y: 0, w, h, style: { background: '#0a0a0a', opacity: scrimOpacity } };
  return { ...board, elements: [image, scrim, ...rest] };
}

/**
 * Strip a backdrop (image + scrim) from a board. If that leaves no full-bleed
 * background rect, prepend a dark one so the board isn't transparent. Pure.
 */
export function removeBackdrop(board) {
  const { w, h } = board.canvas;
  const isFullBleedRect = (e) => e.type === 'rect' && e.x <= 0 && e.y <= 0 && e.w >= w && e.h >= h;
  const rest = board.elements.filter((e) => e.id !== 'backdrop' && e.id !== 'scrim');
  if (rest.some(isFullBleedRect)) return { ...board, elements: rest };
  const ids = new Set(rest.map((e) => e.id));
  let bgId = 'bg', n = 1;
  while (ids.has(bgId)) bgId = 'bg-' + (++n);
  const bg = { id: bgId, type: 'rect', x: 0, y: 0, w, h, style: { background: '#0a0a0a' } };
  return { ...board, elements: [bg, ...rest] };
}

/** Look up a library backdrop by its file path (whitelist for apply-by-file). */
export function backdropByFile(file, list = BACKDROPS) {
  return list.find((b) => b.file === file) || null;
}

/** Derive query tags from a board's palette + an optional free-text brief. */
export function tagsForBoard(board, brief = '') {
  const tags = [];
  const bg = board.elements.find((e) => e.type === 'rect' && e.x <= 0 && e.y <= 0)?.style?.background || '#0a0a0a';
  // crude luminance from hex
  const hex = bg.replace('#', '');
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    tags.push(lum < 0.4 ? 'color-theme:dark' : 'color-theme:light');
    if (r > g && r > b) tags.push('color-theme:warm');
    if (b > r && b > g) tags.push('color-theme:cool');
  }
  const t = brief.toLowerCase();
  for (const [kw, tag] of [['cafe', 'industry:cafe'], ['coffee', 'industry:cafe'], ['bar', 'industry:bar'],
    ['cocktail', 'industry:bar'], ['steak', 'industry:restaurant'], ['bakery', 'industry:bakery'],
    ['happy hour', 'occasion:happy-hour'], ['sale', 'occasion:sale'], ['holiday', 'occasion:holiday']]) {
    if (t.includes(kw)) tags.push(tag);
  }
  return tags;
}
