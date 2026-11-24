// Canonical tagging system (docs/template-system-roadmap.md §2) — made executable.
// PORTABLE CORE: the facet:value grammar, cardinality/required model, and
// validateTags() — all depend only on a Vocabulary map, so they lift into any
// project unchanged. PROJECT-SPECIFIC: the VOCAB value lists below (swap per app).
// validateTags() deliberately mirrors validateBoard()'s {ok}|{ok,errors} contract.

// facet:value, lowercase-kebab, a value may contain hyphens but never a colon.
const TAG_RE = /^([a-z][a-z-]*):([a-z0-9][a-z0-9-]*)$/;

// --- project-specific layer: the controlled vocabulary ----------------------
// orientation/aspect are REQUIRED but COMPUTED from canvas (never hand-typed).
export const VOCAB = {
  category: { required: true, multi: false, values: new Set(['menu-board', 'promo', 'event', 'announcement', 'wayfinding', 'hours', 'specials', 'welcome', 'pricing', 'gallery']) },
  orientation: { required: true, multi: false, values: new Set(['landscape', 'portrait', 'square']) },
  aspect: { required: true, multi: false, values: new Set(['16x9', '9x16', '1x1', '21x9', '4x3', 'custom']) },
  industry: { required: false, multi: true, values: new Set(['restaurant', 'cafe', 'bar', 'bakery', 'retail', 'gym', 'salon', 'clinic', 'hotel', 'events', 'nonprofit', 'generic']) },
  style: { required: false, multi: true, values: new Set(['bold-modern', 'minimal', 'elegant', 'playful', 'retro', 'editorial', 'tech', 'handcrafted']) },
  'color-theme': { required: false, multi: true, values: new Set(['dark', 'light', 'warm', 'cool', 'vibrant', 'mono', 'pastel', 'brand-blue', 'brand-violet', 'brand-magenta']) },
  density: { required: false, multi: false, values: new Set(['single-focus', 'balanced', 'multi-item-menu']) },
  occasion: { required: false, multi: true, values: new Set(['holiday', 'summer', 'winter', 'spring', 'fall', 'happy-hour', 'grand-opening', 'sale', 'seasonal']) },
  language: { required: false, multi: true, values: new Set(['en', 'es', 'fr', 'de', 'pt', 'zh']) },
};

// --- portable core: the validator -------------------------------------------
/**
 * @param {string[]} tags
 * @param {object}   vocab  facet -> { required, multi, values:Set }
 * @returns {{ ok: true } | { ok: false, errors: {path, code, message}[] }}
 */
export function validateTags(tags, vocab = VOCAB) {
  if (!Array.isArray(tags)) return { ok: false, errors: [{ path: 'tags', code: 'bad_tags', message: 'tags must be an array.' }] };
  const errors = [];
  const bad = (path, code, message) => errors.push({ path, code, message });
  const seen = {};

  tags.forEach((tag, i) => {
    const m = TAG_RE.exec(tag);
    if (!m) { bad(`[${i}]`, 'bad_tag_format', `"${tag}" is not facet:value lowercase-kebab.`); return; }
    const facet = m[1], value = m[2];
    const def = vocab[facet];
    if (!def) { bad(`[${i}]`, 'unknown_facet', `unknown facet "${facet}".`); return; }
    if (!def.values.has(value)) { bad(`[${i}]`, 'unknown_value', `"${value}" is not an allowed value for ${facet}.`); return; }
    seen[facet] = (seen[facet] || 0) + 1;
    if (!def.multi && seen[facet] > 1) bad(`[${i}]`, 'cardinality', `${facet} is single-value but appears ${seen[facet]} times.`);
  });

  for (const [facet, def] of Object.entries(vocab)) {
    if (def.required && !seen[facet]) bad(facet, 'missing_required_facet', `required facet "${facet}" is missing.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Allowed values for a facet (for building filter UIs). */
export function facetValues(facet, vocab = VOCAB) {
  return vocab[facet] ? [...vocab[facet].values] : [];
}
