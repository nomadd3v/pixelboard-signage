// The one render function: (template, slots, content) -> html.
// Shared by the editor's live preview (mode: "edit") and the publish pipeline
// (mode: "publish"). Pure. See ADR-001 Decision 2.

import { tokenRegex, escapeText, escapeAttr } from './ids.js';

const DATA_V_ATTR = / data-v-attr="[^"]*"/g;

/**
 * @param {object}   args
 * @param {string}   args.template  frozen template with sentinel tokens
 * @param {object[]} args.slots     slot manifest
 * @param {Record<string,string>} args.content  {slotId: value}
 * @param {"edit"|"publish"} [args.mode="publish"]
 * @returns {string} rendered HTML
 */
export function render({ template, slots, content, mode = 'publish' }) {
  const byId = new Map(slots.map((s) => [s.id, s]));

  let out = template.replace(tokenRegex(), (_m, id) => {
    const slot = byId.get(id);
    const value = content?.[id] ?? slot?.original ?? '';

    if (!slot) return ''; // orphan token: drop

    if (slot.kind === 'attr') {
      // Tokens in attribute position — escape for attribute context in both modes.
      return escapeAttr(value);
    }

    // Text slot.
    if (mode === 'edit') {
      return `<span class="v-slot" data-v-slot="${id}" data-v-required="${slot.required ? 1 : 0}">${escapeText(value)}</span>`;
    }
    return escapeText(value);
  });

  if (mode === 'publish') {
    out = out.replace(DATA_V_ATTR, '');
  }

  return out;
}
