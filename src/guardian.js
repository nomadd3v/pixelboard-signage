// The Guardian — a deterministic, AI-free validator. The content security
// boundary. Pure: never mutates input, never calls a model.
// See docs/adrs/ADR-001-content-model.md (The Guardian contract).

import { hasForbiddenChar } from './ids.js';

// Schemes allowed for url-bearing attr slots. A relative reference (no scheme)
// is always safe — it can't carry an executable scheme — so we resolve against a
// dummy base and inspect the resulting protocol with the WHATWG URL parser (the
// same logic a browser applies), rather than hand-rolling scheme regex where
// bypasses live.
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_SRC_DATA = /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);/i;

/** True if `value` is a safe url for an attr slot. `isSrc` permits inline image data URIs. */
function isSafeUrlValue(value, isSrc) {
  const v = value.trim();
  if (v === '') return true; // emptiness is governed by the required-check, not here
  let protocol;
  try {
    // Relative refs (e.g. "assets/logo.svg", "#top", "//cdn/x") inherit the base
    // protocol (http:) and pass; absolute urls keep their own scheme.
    protocol = new URL(v, 'http://vellum.invalid/').protocol;
  } catch {
    return false;
  }
  if (ALLOWED_URL_PROTOCOLS.has(protocol)) return true;
  if (isSrc && SAFE_SRC_DATA.test(v)) return true; // safe inline image only
  return false;
}
// Markup detection for plain-text slots: an opening tag or a stray close tag.
const HTML_MARKUP = /<\s*\/?\s*[a-z!]/i;

/**
 * @param {object[]} slots  slot manifest from ingest
 * @param {Record<string,string>} changes  proposed {slotId: value}
 * @returns {{ ok: true } | { ok: false, errors: {slotId, code, message}[] }}
 */
export function guardian(slots, changes) {
  const byId = new Map(slots.map((s) => [s.id, s]));
  const errors = [];
  const reject = (slotId, code, message) => errors.push({ slotId, code, message });

  for (const [slotId, value] of Object.entries(changes || {})) {
    const slot = byId.get(slotId);
    if (!slot) {
      reject(slotId, 'unknown_slot', 'No such slot in this site.');
      continue;
    }
    if (typeof value !== 'string') {
      reject(slotId, 'bad_type', 'Value must be a string.');
      continue;
    }
    if (hasForbiddenChar(value)) {
      reject(slotId, 'forbidden_char', 'Value contains a forbidden control/sentinel character.');
      continue;
    }

    const isUrl = slot.kind === 'attr' && slot.urlLike;

    if (!isUrl && HTML_MARKUP.test(value)) {
      reject(slotId, 'html_not_allowed', 'Plain-text slot cannot contain markup.');
      continue;
    }

    if (slot.required && value.trim() === '') {
      reject(slotId, 'empty_required', 'This slot is structural and cannot be emptied.');
      continue;
    }

    if (isUrl) {
      if (!isSafeUrlValue(value, slot.field === 'src')) {
        reject(slotId, 'unsafe_url', 'URL scheme is not allowed.');
        continue;
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
