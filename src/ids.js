// Slot identity, sentinel tokens, and context-aware escaping.
// See docs/adrs/ADR-001-content-model.md (Decisions 1 & 2).
//
// Sentinels are two Unicode private-use-area chars (U+E000 / U+E001). They are
// valid in HTML, passed through verbatim by cheerio's serializer, and never
// produced by escaped client content. Defined via fromCodePoint so this source
// file stays pure ASCII — no invisible characters to corrupt edits.

import { createHash } from 'node:crypto';

export const SENTINEL_OPEN = String.fromCodePoint(0xe000);
export const SENTINEL_CLOSE = String.fromCodePoint(0xe001);

// All control chars except tab / newline / CR.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/**
 * True if a client value contains anything forbidden: a control char or either
 * sentinel char — so a value can never forge a slot token.
 */
export function hasForbiddenChar(value) {
  return (
    CONTROL_CHAR.test(value) ||
    value.indexOf(SENTINEL_OPEN) !== -1 ||
    value.indexOf(SENTINEL_CLOSE) !== -1
  );
}

const TOKEN_SOURCE = `${SENTINEL_OPEN}([0-9a-f]{12})${SENTINEL_CLOSE}`;

/** Build the sentinel token for a slot id. */
export function token(id) {
  return `${SENTINEL_OPEN}${id}${SENTINEL_CLOSE}`;
}

/** Fresh global regex matching every slot token in a template. */
export function tokenRegex() {
  return new RegExp(TOKEN_SOURCE, 'g');
}

/**
 * Structural slot id: sha256(domPath + "|" + field), 12 hex chars.
 * Deliberately excludes content so editing a value never changes its id.
 */
export function slotId(domPath, field) {
  return createHash('sha256').update(`${domPath}|${field}`).digest('hex').slice(0, 12);
}

/** HTML text-node escape. */
export function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Double-quoted attribute-value escape. */
export function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
