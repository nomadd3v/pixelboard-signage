// Board schema + whitelist validator — the design-time Guardian (ADR-004 Decision 2).
// A board doc must NOT be able to express code: `type` is a fixed set and `style`
// is a whitelisted property map with validated value SHAPES (never a freeform CSS
// string, never raw HTML). This is what keeps "the AI never writes template" true
// once an AI can author a board. Pure: never mutates input.

import { hasForbiddenChar } from '../ids.js';

export const ELEMENT_TYPES = new Set(['text', 'image', 'rect']);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

// Fonts are a fixed keyword set -> a fixed stack, so a value can never smuggle an
// @import / url() / external request.
// Curated signage typography. Each key -> a full CSS stack (used in compiled HTML).
// The fontFamily whitelist below is exactly these keys, so adding a font here adds
// it everywhere (schema, compiler, studio picker, AI prompt).
export const FONT_STACKS = {
  inter: "Inter, 'Helvetica Neue', Arial, system-ui, sans-serif",
  bebas: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif",
  anton: "Anton, Impact, sans-serif",
  oswald: "Oswald, 'Arial Narrow', sans-serif",
  'archivo-black': "'Archivo Black', Arial, sans-serif",
  'space-grotesk': "'Space Grotesk', 'Helvetica Neue', sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  fraunces: "Fraunces, Georgia, 'Times New Roman', serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
  serif: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
  // Hand-lettered / signage-marker set, self-hosted under public/fonts
  // (OFL / Apache-2.0 Google Fonts; see THIRD-PARTY.md).
  'gochi-hand': "'Gochi Hand', cursive",
  'rock-salt': "'Rock Salt', cursive",
  'give-you-glory': "'Give You Glory', cursive",
  'gloria-hallelujah': "'Gloria Hallelujah', cursive",
  caveat: "Caveat, cursive",
  'nanum-pen': "'Nanum Pen Script', cursive",
  'crafty-girls': "'Crafty Girls', cursive",
};

// Primary family name per key — for the studio canvas (Fabric writes a single
// family into ctx.font; a full comma-stack collapses glyphs).
export const FONT_PRIMARY = {
  inter: 'Inter', bebas: 'Bebas Neue', anton: 'Anton', oswald: 'Oswald',
  'archivo-black': 'Archivo Black', 'space-grotesk': 'Space Grotesk',
  playfair: 'Playfair Display', fraunces: 'Fraunces',
  system: 'system-ui', mono: 'JetBrains Mono', serif: 'Georgia',
  'gochi-hand': 'Gochi Hand', 'rock-salt': 'Rock Salt',
  'give-you-glory': 'Give You Glory', 'gloria-hallelujah': 'Gloria Hallelujah',
  caveat: 'Caveat', 'nanum-pen': 'Nanum Pen Script', 'crafty-girls': 'Crafty Girls',
};

// <link> tags that load the Google-hosted families (system/mono/serif need none),
// plus @font-face rules for the self-hosted hand-lettered set (served from
// /fonts/*.ttf — see public/fonts/). Used in the compiled board head, the studio,
// and the gallery thumbnails so a board looks identical everywhere and on signage
// hardware without relying on locally-installed fonts.
export const FONT_LINKS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900' +
  '&family=Bebas+Neue&family=Anton&family=Oswald:wght@400;500;600;700' +
  '&family=Archivo+Black&family=Space+Grotesk:wght@400;500;600;700' +
  '&family=Playfair+Display:wght@400;700;800;900&family=Fraunces:wght@400;600;900' +
  '&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">' +
  '<style>' +
  "@font-face{font-family:'Gochi Hand';src:url('/fonts/GochiHand-Regular.ttf')}" +
  "@font-face{font-family:'Rock Salt';src:url('/fonts/RockSalt-Regular.ttf')}" +
  "@font-face{font-family:'Give You Glory';src:url('/fonts/GiveYouGlory-Regular.ttf')}" +
  "@font-face{font-family:'Gloria Hallelujah';src:url('/fonts/GloriaHallelujah-Regular.ttf')}" +
  "@font-face{font-family:'Caveat';src:url('/fonts/Caveat-Regular.ttf')}" +
  "@font-face{font-family:'Nanum Pen Script';src:url('/fonts/NanumPenScript-Regular.ttf')}" +
  "@font-face{font-family:'Crafty Girls';src:url('/fonts/CraftyGirls-Regular.ttf')}" +
  '</style>';

const isColor = (v) => typeof v === 'string' && (HEX_COLOR_RE.test(v) || RGB_RE.test(v));
const num = (min, max) => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const oneOf = (...allowed) => (v) => allowed.includes(v);

// Reject any object that carries keys outside an allowed set (no smuggled props).
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

// A gradient is a STRUCTURED value, never a CSS string (ADR-005 Decision 1): the
// compiler assembles the gradient() from these pre-validated parts, so it can
// carry nothing executable. color reuses isColor (rgba()/#rrggbbaa give alpha).
const inPct = num(-200, 200); // positions may anchor off-box (the reference board uses -8%)
const isStop = (s) =>
  !!s && typeof s === 'object' && !Array.isArray(s) &&
  onlyKeys(s, ['color', 'at']) && isColor(s.color) && num(0, 100)(s.at);

export function isGradient(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.type !== 'linear' && v.type !== 'radial') return false;
  if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 8) return false;
  let prev = -Infinity;
  for (const s of v.stops) {
    if (!isStop(s) || s.at < prev) return false; // stops non-decreasing
    prev = s.at;
  }
  if (v.type === 'linear') {
    return onlyKeys(v, ['type', 'angle', 'stops']) && num(0, 360)(v.angle);
  }
  // radial: optional position (center default) + optional ellipse size (% of box)
  if (!onlyKeys(v, ['type', 'position', 'size', 'stops'])) return false;
  if (v.position != null &&
      !(typeof v.position === 'object' && onlyKeys(v.position, ['x', 'y']) && inPct(v.position.x) && inPct(v.position.y))) {
    return false;
  }
  if (v.size != null &&
      !(typeof v.size === 'object' && onlyKeys(v.size, ['w', 'h']) && num(0, 400)(v.size.w) && num(0, 400)(v.size.h))) {
    return false;
  }
  return true;
}

// propName -> validator. A style prop not listed here is rejected.
export const STYLE_PROPS = {
  color: isColor,
  background: isColor,
  backgroundGradient: isGradient,
  fontFamily: (v) => Object.prototype.hasOwnProperty.call(FONT_STACKS, v),
  fontSize: num(1, 2000),
  fontWeight: oneOf(100, 200, 300, 400, 500, 600, 700, 800, 900, 'normal', 'bold'),
  fontStyle: oneOf('normal', 'italic'),
  textAlign: oneOf('left', 'center', 'right', 'justify'),
  lineHeight: num(0, 10),
  letterSpacing: num(-20, 100),
  borderRadius: num(0, 5000),
  padding: num(0, 2000),
  opacity: num(0, 1),
  objectFit: oneOf('cover', 'contain', 'fill', 'none', 'scale-down'),
};

const MAX_CANVAS = 10000;

/**
 * Validate a board document against the whitelist.
 * @returns {{ ok: true } | { ok: false, errors: {path, code, message}[] }}
 */
export function validateBoard(board) {
  const errors = [];
  const bad = (path, code, message) => errors.push({ path, code, message });

  if (!board || typeof board !== 'object') {
    return { ok: false, errors: [{ path: '', code: 'bad_board', message: 'Board must be an object.' }] };
  }
  if (typeof board.name !== 'string' || board.name.trim() === '') {
    bad('name', 'bad_name', 'Board needs a non-empty name.');
  }
  const c = board.canvas;
  if (!c || !num(1, MAX_CANVAS)(c.w) || !num(1, MAX_CANVAS)(c.h)) {
    bad('canvas', 'bad_canvas', `canvas.w/h must be numbers in 1..${MAX_CANVAS}.`);
  }
  if (!Array.isArray(board.elements)) {
    bad('elements', 'bad_elements', 'elements must be an array.');
    return { ok: errors.length === 0, errors };
  }

  const seenIds = new Set();
  board.elements.forEach((el, i) => {
    const at = `elements[${i}]`;
    if (!el || typeof el !== 'object') { bad(at, 'bad_element', 'Element must be an object.'); return; }

    if (typeof el.id !== 'string' || !ID_RE.test(el.id)) {
      bad(`${at}.id`, 'bad_id', 'Element id must match [a-z0-9-], <=64 chars.');
    } else if (seenIds.has(el.id)) {
      bad(`${at}.id`, 'dup_id', `Duplicate element id "${el.id}".`);
    } else {
      seenIds.add(el.id);
    }

    if (!ELEMENT_TYPES.has(el.type)) {
      bad(`${at}.type`, 'bad_type', `type must be one of: ${[...ELEMENT_TYPES].join(', ')}.`);
    }

    for (const k of ['x', 'y', 'w', 'h']) {
      if (!num(k === 'w' || k === 'h' ? 1 : -MAX_CANVAS, MAX_CANVAS)(el[k])) {
        bad(`${at}.${k}`, 'bad_geom', `${k} must be a finite number in range.`);
      }
    }
    if (el.rotation != null && !num(-360, 360)(el.rotation)) {
      bad(`${at}.rotation`, 'bad_rotation', 'rotation must be a number in -360..360.');
    }

    // value: text body (text), src url (image). rect needs none.
    if (el.type === 'text' || el.type === 'image') {
      if (typeof el.value !== 'string') {
        bad(`${at}.value`, 'bad_value', `${el.type} element needs a string value.`);
      } else if (hasForbiddenChar(el.value)) {
        bad(`${at}.value`, 'forbidden_char', 'value contains a forbidden control/sentinel char.');
      }
    }

    // style: whitelist only.
    if (el.style != null) {
      if (typeof el.style !== 'object' || Array.isArray(el.style)) {
        bad(`${at}.style`, 'bad_style', 'style must be an object.');
      } else {
        for (const [prop, val] of Object.entries(el.style)) {
          const check = STYLE_PROPS[prop];
          if (!check) bad(`${at}.style.${prop}`, 'unknown_style', `style property "${prop}" is not allowed.`);
          else if (!check(val)) bad(`${at}.style.${prop}`, 'bad_style_value', `invalid value for style "${prop}".`);
        }
      }
    }

    // slot: optional editability marker.
    if (el.slot != null) {
      if (typeof el.slot !== 'object' || typeof el.slot.editable !== 'boolean') {
        bad(`${at}.slot`, 'bad_slot', 'slot must be { editable: boolean, label?: string }.');
      } else if (el.slot.label != null && typeof el.slot.label !== 'string') {
        bad(`${at}.slot.label`, 'bad_slot_label', 'slot.label must be a string.');
      } else if (el.slot.editable && el.type === 'rect') {
        bad(`${at}.slot`, 'rect_not_editable', 'rect elements have no editable value.');
      }
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true };
}
