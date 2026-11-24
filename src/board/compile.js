// Board compiler — the second producer of the engine artifact (ADR-004).
// compileBoard(board) -> { template, slots, content }, consumed UNCHANGED by the
// engine's render() / guardian() / publish. Pure.
//
// Decision 1: slot ids derive from the element's persistent id, never its position
//   -> moving/restyling an element preserves the slot id, so client content survives.
// Decision 3: frozen text is escaped once here; editable values emit a raw token
//   and render() escapes them per-context at serve time (no double-escape).

import { slotId, token, escapeText, escapeAttr } from '../ids.js';
import { FONT_STACKS, FONT_LINKS } from './schema.js';

// Whitelisted style prop -> CSS declaration. Values are pre-validated by the schema.
const CSS = {
  color: (v) => `color:${v}`,
  background: (v) => `background:${v}`,
  backgroundGradient: (g) => `background:${gradientCss(g)}`,
  fontFamily: (v) => `font-family:${FONT_STACKS[v]}`,
  fontSize: (v) => `font-size:${v}px`,
  fontWeight: (v) => `font-weight:${v}`,
  fontStyle: (v) => `font-style:${v}`,
  textAlign: (v) => `text-align:${v}`,
  lineHeight: (v) => `line-height:${v}`,
  letterSpacing: (v) => `letter-spacing:${v}px`,
  borderRadius: (v) => `border-radius:${v}px`,
  padding: (v) => `padding:${v}px`,
  opacity: (v) => `opacity:${v}`,
  objectFit: (v) => `object-fit:${v}`,
};

// Assemble a CSS gradient() from a schema-validated gradient object (ADR-005).
// Every part is pre-validated, so the result can carry nothing executable.
function gradientCss(g) {
  const stops = g.stops.map((s) => `${s.color} ${s.at}%`).join(', ');
  if (g.type === 'linear') return `linear-gradient(${g.angle}deg, ${stops})`;
  const pos = g.position ? `${g.position.x}% ${g.position.y}%` : '50% 50%';
  const size = g.size ? `${g.size.w}% ${g.size.h}%` : 'farthest-corner';
  return `radial-gradient(${size} at ${pos}, ${stops})`;
}

function styleAttr(el) {
  const parts = [
    'position:absolute',
    `left:${el.x}px`, `top:${el.y}px`, `width:${el.w}px`, `height:${el.h}px`,
    // Text must never be cut off on a sign — let it overflow its box rather than clip.
    // Images/shapes still clip (objectFit/rounded corners need it).
    el.type === 'text' ? 'overflow:visible' : 'overflow:hidden',
  ];
  const style = el.style || {};
  for (const [k, v] of Object.entries(style)) {
    // A gradient wins over a solid background regardless of key order, so an
    // element carrying both is deterministic (ADR-005 open question).
    if (k === 'background' && style.backgroundGradient != null) continue;
    if (CSS[k]) parts.push(CSS[k](v));
  }
  // Rotate around the element's top-left, matching the studio's originX/Y=left/top.
  if (el.rotation) parts.push('transform-origin:0 0', `transform:rotate(${Number(el.rotation)}deg)`);
  return escapeAttr(parts.join(';')); // defense-in-depth; values are already whitelisted
}

const isEditable = (el) => !!(el.slot && el.slot.editable);

/**
 * Compile a (validated) board into the engine artifact.
 * @param {object} board
 * @returns {{ template: string, slots: object[], content: Record<string,string> }}
 */
export function compileBoard(board) {
  const slots = [];
  const content = {};
  const nodes = [];

  for (const el of board.elements) {
    const style = styleAttr(el);
    const elAttr = `data-pb-el="${escapeAttr(el.id)}"`;

    if (el.type === 'text') {
      if (isEditable(el)) {
        const id = slotId(el.id, 'text');
        slots.push({ id, kind: 'text', field: 'text', urlLike: false, original: el.value, required: true, label: el.slot.label || 'Text' });
        content[id] = el.value;
        nodes.push(`<div ${elAttr} style="${style}">${token(id)}</div>`);
      } else {
        nodes.push(`<div ${elAttr} style="${style}">${escapeText(el.value)}</div>`);
      }
    } else if (el.type === 'image') {
      if (isEditable(el)) {
        const id = slotId(el.id, 'src');
        slots.push({ id, kind: 'attr', field: 'src', urlLike: true, original: el.value, required: true, label: el.slot.label || 'Image' });
        content[id] = el.value;
        nodes.push(`<img ${elAttr} style="${style}" src="${token(id)}" alt="">`);
      } else {
        nodes.push(`<img ${elAttr} style="${style}" src="${escapeAttr(el.value)}" alt="">`);
      }
    } else if (el.type === 'rect') {
      nodes.push(`<div ${elAttr} style="${style}"></div>`);
    }
  }

  const canvasStyle = `position:relative;width:${board.canvas.w}px;height:${board.canvas.h}px;margin:0 auto;overflow:hidden`;
  const template =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // Load the curated fonts so a published board renders identically to the studio
    // canvas on any screen (signage hardware won't have these fonts installed).
    FONT_LINKS +
    `<title>${escapeText(board.name)}</title></head>` +
    '<body style="margin:0;background:#0a0a0a">' +
    `<div class="pb-board" style="${canvasStyle}">${nodes.join('')}</div>` +
    '</body></html>';

  return { template, slots, content };
}
