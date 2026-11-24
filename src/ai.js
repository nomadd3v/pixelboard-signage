// AI chat: turn a plain-English request into a structured set of content-slot
// changes. The AI NEVER writes code or template — it only proposes a
// {slotId: value} map, which is then run through the same Guardian as a human
// edit (see ADR-003). Anthropic is the default provider (official SDK,
// claude-opus-4-8); OpenRouter (OpenAI-compatible) is the fallback.

const MODEL = process.env.VELLUM_AI_MODEL || 'claude-opus-4-8';
const OPENROUTER_MODEL = process.env.VELLUM_OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.5';

/** Which provider is active, or null if AI chat is unconfigured. */
export function aiProvider() {
  const explicit = process.env.VELLUM_AI_PROVIDER;
  if (explicit) return explicit; // 'anthropic' | 'openrouter' | 'mock'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  return null;
}

export const aiConfigured = () => aiProvider() != null;

// JSON shape the model must return. Changes are an ARRAY of {slot_id, value}
// (schema-friendly — slot ids are dynamic keys, so a map can't be strictly
// schematized). Converted to a map and Guardian-validated afterward.
const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { slot_id: { type: 'string' }, value: { type: 'string' } },
        required: ['slot_id', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'changes'],
  additionalProperties: false,
};

const SYSTEM = `You are the content editor for a frozen website template in a CMS called Vellum.

The site's design and structure are LOCKED. You may ONLY propose new plain-text
values for existing content slots, each identified by a stable slot id. You can
NEVER add, remove, or reorder slots, change layout, write code or HTML, or touch
anything but a slot's text value.

You are given the list of editable slots (id, label, current value) and a user
request. Return a JSON object with:
- "reply": a short, friendly message to the user describing what you changed (or
  why you couldn't).
- "changes": an array of { "slot_id", "value" } for each slot to update. Use the
  EXACT slot id from the list. Values are plain text only — never include HTML
  tags or markup. Only include slots you are actually changing. If the request
  can't be satisfied by editing slot text, return an empty "changes" array and
  explain in "reply".

A deterministic validator will reject any malformed, structure-breaking, or
markup-containing change, so stay strictly within plain-text content edits.`;

/** Build the user-turn prompt from the slot manifest + current content. */
export function buildUserPrompt(slots, content, message) {
  const lines = slots.map((s) => {
    const value = content?.[s.id] ?? s.original ?? '';
    const kind = s.kind === 'attr' ? `${s.field}` : 'text';
    return `- id=${s.id} [${s.label} / ${kind}]: ${JSON.stringify(value)}`;
  });
  return `Editable slots:\n${lines.join('\n')}\n\nUser request: ${message}`;
}

/** Convert the model's changes array into a {slotId: value} map (last wins). */
export function toChangesMap(proposal) {
  const map = {};
  for (const c of proposal?.changes || []) {
    if (c && typeof c.slot_id === 'string' && typeof c.value === 'string') {
      map[c.slot_id] = c.value;
    }
  }
  return map;
}

// --- providers --------------------------------------------------------------

async function callAnthropic(system, user, schema = SCHEMA) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  const text = res.content.find((b) => b.type === 'text')?.text || '{}';
  return JSON.parse(text);
}

async function callOpenRouter(system, user, schema = SCHEMA) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'proposal', strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

// Deterministic provider for tests + keyless local dev: the user message is
// treated as the literal JSON proposal (so tests drive Guardian outcomes).
function callMock(_system, user) {
  try {
    const p = JSON.parse(user.split('User request: ').pop());
    return { reply: p.reply ?? '(mock) applied', changes: p.changes ?? [] };
  } catch {
    return { reply: '(mock) no change proposed', changes: [] };
  }
}

/**
 * Propose content changes for a site from a plain-English message.
 * @returns {{ reply: string, changes: Record<string,string> }}
 */
export async function proposeChanges({ slots, content, message }) {
  const provider = aiProvider();
  if (!provider) throw new Error('AI chat is not configured.');
  const user = buildUserPrompt(slots, content, message);

  let proposal;
  if (provider === 'mock') proposal = callMock(SYSTEM, user);
  else if (provider === 'openrouter') proposal = await callOpenRouter(SYSTEM, user);
  else proposal = await callAnthropic(SYSTEM, user);

  return { reply: String(proposal?.reply || ''), changes: toChangesMap(proposal) };
}

// === Board generation (the studio's AI "design" feature) ====================
// The AI proposes a structured BOARD DOC (a scene graph), never code. The result
// is gated by the same whitelist validator + compiler as a hand-drawn board, so
// "the AI never writes template" holds one level up. Canvas dims are fixed by the
// caller — the AI only fills elements.

export const BOARD_GEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'board'],
  properties: {
    reply: { type: 'string' },
    board: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'elements'],
      properties: {
        name: { type: 'string' },
        elements: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'x', 'y', 'w', 'h'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['text', 'image', 'rect'] },
              x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
              rotation: { type: 'number' },
              value: { type: 'string' },
              style: {
                type: 'object', additionalProperties: false,
                properties: {
                  // NOTE: backgroundGradient is deliberately ABSENT here. Anthropic's
                  // structured-output grammar compiler rejects the board schema ("Schema is
                  // too complex" / grammar timeout) the moment any extra style prop is added —
                  // it's at the ceiling. Gradients are applied AFTER generation by
                  // enhanceBoardBackgrounds(), seeded by the flat `background` color the model
                  // picks. The board MODEL + compiler still support backgroundGradient (ADR-005).
                  color: { type: 'string' }, background: { type: 'string' },
                  fontFamily: { type: 'string', enum: ['inter', 'bebas', 'anton', 'oswald', 'archivo-black', 'space-grotesk', 'playfair', 'fraunces', 'system', 'mono', 'serif'] },
                  fontSize: { type: 'number' }, fontWeight: { type: 'number' },
                  textAlign: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
                  borderRadius: { type: 'number' }, padding: { type: 'number' }, opacity: { type: 'number' },
                  objectFit: { type: 'string', enum: ['cover', 'contain', 'fill', 'none', 'scale-down'] },
                },
              },
              slot: {
                type: 'object', additionalProperties: false,
                required: ['editable'],
                properties: { editable: { type: 'boolean' }, label: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

const BOARD_SYSTEM = `You are a senior graphic designer producing a single fixed-canvas DIGITAL SIGNAGE
board for Pixelboard. Output a structured board document — never code/HTML. It must look
PROFESSIONALLY designed, and — this is critical — each board must look DISTINCT. You are judged on
QUALITY and DIVERSITY: never make two boards that share the same skeleton, palette, and type.

## Always (craft fundamentals)
- SAFE MARGINS: content stays >= 6% of canvas height from every edge (full-bleed backgrounds/bands excepted).
- RESTRAINT: 3-7 elements; negative space is a feature.
- ONE FOCAL POINT: a single dominant element (hero), strong size contrast to supporting text.
- ALIGNMENT: commit to ONE system per board (all left to a shared margin, OR all centered). Matching x + widths.
- VERTICAL RHYTHM: consistent gaps; group related items.
- LEGIBILITY: high contrast; hero readable across a room. If text sits on a colored area, ensure contrast.
- TEXT BOX HEIGHT: size each text element's height to fit its text INCLUDING wrapping. A big hero line
  often wraps to two lines — give it enough height (and keep the next element below clear of it). Never
  let a box be shorter than the text it holds. Prefer a short hero that fits one line when you can.

## DIVERSITY IS MANDATORY — choose fresh each time to fit THIS brief
- COMPOSITION: pick an archetype below that suits the brief; do NOT reuse the same one every time.
- PALETTE: choose colors for the mood — DO NOT default to black (#0a0a0a). The background can be dark,
  light, or a saturated color. Ideas: upscale/warm -> cream #f5efe6 / espresso #2a1d12 / gold #b8860b;
  playful -> bright primary on white; nightlife -> deep indigo #11121f / violet + neon; fresh cafe ->
  cream/sage #6f8f6a/charcoal; bold sale -> a saturated brand fill with white text. Pick what fits.
- TYPE: pair a hero font to the vibe — bebas/anton/archivo-black/oswald (bold, condensed, loud),
  playfair/fraunces (elegant/upscale), space-grotesk (modern/tech) — with inter for kickers/body.

## Layout archetypes — pick & adapt ONE (coords for 1920x1080; scale to the given canvas)
1) LEFT HERO: kicker + huge title + price/CTA, all left-aligned to one margin.
2) CENTERED: everything centered on the axis; big symmetric focal — great for one-message promos.
3) COLOR FIELD: bold full-bleed background COLOR (not black), large contrasting text, poster-like.
4) TOP BAND: full-width colored header band (~18-28% tall) with the title; details on a contrasting body below.
5) TWO-COLUMN MENU: heading on top; items left + prices right in two columns; even rhythm.

## BACKGROUND COLOR — pick a strong, mood-appropriate base (depth is added automatically)
Give the full-bleed background "rect" a deliberate "background" hex chosen for the mood (NOT a default
black). The system automatically deepens it into a tuned gradient with a legibility scrim after you design,
so pick a base color that wants depth: a rich dark for premium/nightlife, a warm cream for upscale/cafe, a
saturated brand hue for a color-field promo. Keep the focal text area's contrast high against this base.

## Hard rules (a deterministic validator rejects violations)
- Canvas GIVEN+fixed. x,y = element TOP-LEFT; keep on-canvas. Types: text|image|rect only. Short unique ids.
- Every image sets value:"/branding/logomark-512.png"; every text includes its value.
- Colors hex. Fonts one of: inter, bebas, anton, oswald, archivo-black, space-grotesk, playfair, fraunces,
  system, mono, serif. Mark operator-editable elements slot:{editable,label}; decorative shapes aren't editable.

## Two reference boards — DIFFERENT archetypes & palettes. Match this quality, then do something different again.
A) LEFT HERO, dark + magenta:
{ "name":"Daily Special","elements":[
 {"id":"bg","type":"rect","x":0,"y":0,"w":1920,"h":1080,"style":{"background":"#0a0a0a"}},
 {"id":"accent","type":"rect","x":0,"y":0,"w":1920,"h":12,"style":{"background":"#ff2ec4"}},
 {"id":"kicker","type":"text","x":140,"y":150,"w":1640,"h":70,"value":"TODAY'S SPECIAL","style":{"color":"#ff2ec4","fontFamily":"inter","fontSize":56,"fontWeight":700,"letterSpacing":8},"slot":{"editable":true,"label":"Kicker"}},
 {"id":"title","type":"text","x":140,"y":300,"w":1640,"h":300,"value":"SURF & TURF SPUD","style":{"color":"#ffffff","fontFamily":"archivo-black","fontSize":200,"fontWeight":400},"slot":{"editable":true,"label":"Title"}},
 {"id":"price","type":"text","x":140,"y":760,"w":1640,"h":180,"value":"$14.99","style":{"color":"#2e6bff","fontFamily":"bebas","fontSize":190,"fontWeight":400},"slot":{"editable":true,"label":"Price"}}
] }
B) TOP BAND, warm cream + espresso (note the light palette and centered band):
{ "name":"Cafe Hours","elements":[
 {"id":"bg","type":"rect","x":0,"y":0,"w":1920,"h":1080,"style":{"background":"#f5efe6"}},
 {"id":"band","type":"rect","x":0,"y":0,"w":1920,"h":280,"style":{"background":"#2a1d12"}},
 {"id":"title","type":"text","x":0,"y":90,"w":1920,"h":120,"value":"The Daily Grind","style":{"color":"#f5efe6","fontFamily":"playfair","fontSize":96,"fontWeight":800,"textAlign":"center"},"slot":{"editable":true,"label":"Title"}},
 {"id":"hours","type":"text","x":0,"y":470,"w":1920,"h":220,"value":"OPEN 7 – 3 DAILY","style":{"color":"#2a1d12","fontFamily":"bebas","fontSize":200,"fontWeight":400,"textAlign":"center"},"slot":{"editable":true,"label":"Hours"}},
 {"id":"sub","type":"text","x":0,"y":760,"w":1920,"h":80,"value":"Fresh pastries until sold out","style":{"color":"#b8860b","fontFamily":"inter","fontSize":48,"fontWeight":500,"textAlign":"center"},"slot":{"editable":true,"label":"Subtitle"}}
] }

Return JSON: { "reply":"<one short sentence>", "board": { "name":"<short name>", "elements":[ ... ] } }.`;

// Diversity is forced server-side, not left to the model (which otherwise anchors
// on one safe skeleton). Each fresh generation gets a randomly-chosen archetype +
// palette directive; the brief can override if it clearly demands otherwise.
const ARCHETYPES = ['LEFT HERO', 'CENTERED', 'COLOR FIELD', 'TOP BAND', 'TWO-COLUMN MENU'];
const PALETTES = [
  { n: 'ink + neon accent', bg: '#0a0a0a', text: '#ffffff', accent: '#ff2ec4 / #7b2ff7 / #2e6bff' },
  { n: 'warm cream + espresso', bg: '#f5efe6', text: '#2a1d12', accent: '#b8860b' },
  { n: 'midnight indigo + electric', bg: '#11121f', text: '#ffffff', accent: '#6c8cff' },
  { n: 'sage + charcoal', bg: '#e8ece4', text: '#1f2a1c', accent: '#6f8f6a' },
  { n: 'bold saturated color field', bg: '#2e6bff', text: '#ffffff', accent: '#ffffff' },
  { n: 'warm paper + tomato', bg: '#fbf3e4', text: '#1a1208', accent: '#c0392b' },
  { n: 'charcoal + amber', bg: '#1a1a1a', text: '#f5f0e6', accent: '#f0a500' },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const DARK_PALETTES = new Set(['ink + neon accent', 'midnight indigo + electric', 'charcoal + amber']);

function designDirective(forceDark, style) {
  const a = pick(ARCHETYPES);
  const backdropNote = forceDark
    ? `\n- This board WILL have a photographic backdrop behind it: use a DARK background and LIGHT (white/near-white) text, so the image + a dark overlay keep every line legible. Do NOT use a light background.`
    : '';
  const paletteLine = style && style.trim()
    ? `- Palette & type: interpret the style "${style.trim()}" into a fitting background, text, and accent (ALL hex) plus a font pairing. Ensure text contrasts its background. Stay within the allowed fonts.`
    : (() => { const p = pick(forceDark ? PALETTES.filter((x) => DARK_PALETTES.has(x.n)) : PALETTES); return `- Palette "${p.n}": background ${p.bg}, primary text ${p.text}, accent ${p.accent}. (Do NOT just use black.)`; })();
  return `\n\nDESIGN DIRECTIVE for THIS board:\n`
    + `- Composition: use the ${a} archetype (adapt if the content clearly fits another better).\n`
    + `${paletteLine}\n`
    + `- Choose a hero font that fits the vibe; make it look distinct and professionally composed.${backdropNote}`;
}

function buildBoardPrompt(canvas, { message, content, style } = {}, currentBoard, forceDark) {
  if (currentBoard && currentBoard.elements?.length) {
    return `Canvas: ${canvas.w}x${canvas.h} px.\n\nRequest: ${message || ''}\n\nCurrent board (revise it):\n${JSON.stringify({ elements: currentBoard.elements }).slice(0, 4000)}`;
  }
  if (content && content.trim()) {
    // Content mode: lay out the user's EXACT text (verbatim) as editable slots.
    return `Canvas: ${canvas.w}x${canvas.h} px.\n\n`
      + `Lay out THIS EXACT display text. Use every word VERBATIM — do NOT add, remove, rephrase, translate, abbreviate, "fix", or invent ANY text or prices. Each meaningful line becomes its own editable text element (slot.editable:true) with a short label. Decide which line is the title / kicker / items / prices and build a clear hierarchy. Fit everything on the canvas without overlap; if there are many lines, use smaller, evenly-spaced type (a two-column menu if it's a long item+price list).\n\n`
      + `DISPLAY TEXT (one logical line per line):\n${content.trim()}`
      + designDirective(forceDark, style);
  }
  return `Canvas: ${canvas.w}x${canvas.h} px.\n\nRequest: ${message}${designDirective(forceDark)}`;
}

function mockBoard(canvas, message) {
  const pad = Math.round(canvas.w * 0.07);
  return {
    reply: '(mock) generated a starter board',
    board: {
      name: message.slice(0, 40) || 'Board',
      elements: [
        { id: 'bg', type: 'rect', x: 0, y: 0, w: canvas.w, h: canvas.h, style: { background: '#0a0a0a' } },
        { id: 'title', type: 'text', x: pad, y: Math.round(canvas.h * 0.08), w: canvas.w - pad * 2, h: Math.round(canvas.h * 0.12), value: message.slice(0, 40) || 'Title', style: { color: '#ffffff', fontFamily: 'inter', fontSize: Math.round(Math.min(canvas.w, canvas.h) * 0.08), fontWeight: 800 }, slot: { editable: true, label: 'Title' } },
      ],
    },
  };
}

/**
 * Generate a board document from a plain-English description. Canvas dims are
 * fixed by the caller; the returned board still must pass validateBoard().
 * @returns {{ reply: string, board: object }}
 */
export async function generateBoard({ canvas, message, content, style, currentBoard, forceDark }) {
  const provider = aiProvider();
  if (!provider) throw new Error('AI is not configured.');
  if (provider === 'mock') { const m = mockBoard(canvas, content || message || 'Board'); m.board.canvas = canvas; enhanceBoardBackgrounds(m.board, canvas); return m; }

  const user = buildBoardPrompt(canvas, { message, content, style }, currentBoard, forceDark);
  const out = provider === 'openrouter'
    ? await callOpenRouter(BOARD_SYSTEM, user, BOARD_GEN_SCHEMA)
    : await callAnthropic(BOARD_SYSTEM, user, BOARD_GEN_SCHEMA);
  const board = out.board || { name: 'Board', elements: [] };
  board.canvas = canvas; // caller-fixed; never AI-chosen
  // Normalize: the model can't know real image URLs, so back-fill a placeholder
  // src for any value-less image (the operator swaps it). Keeps the validator strict.
  for (const el of board.elements || []) {
    if (el && el.type === 'image' && (typeof el.value !== 'string' || !el.value.trim())) {
      el.value = '/branding/logomark-512.png';
      el.slot = el.slot || { editable: true, label: 'Image' };
    }
    if (el && el.type === 'text' && typeof el.value !== 'string') el.value = '';
  }
  enhanceBoardBackgrounds(board, canvas); // flat bg color -> layered gradient + scrim
  return { reply: String(out.reply || ''), board };
}

/** Coerce a gradient object into the exact shape validateBoard() accepts (sorted/clamped stops, per-type keys), or null. */
export function sanitizeGradient(g) {
  if (!g || typeof g !== 'object' || (g.type !== 'linear' && g.type !== 'radial')) return null;
  let stops = Array.isArray(g.stops) ? g.stops : [];
  stops = stops
    .filter((s) => s && typeof s.color === 'string' && typeof s.at === 'number')
    .map((s) => ({ color: s.color, at: Math.max(0, Math.min(100, s.at)) }))
    .sort((a, b) => a.at - b.at); // enforce non-decreasing
  if (stops.length < 2) return null;
  if (stops.length > 8) stops = stops.slice(0, 8);
  if (g.type === 'linear') {
    const angle = Math.max(0, Math.min(360, typeof g.angle === 'number' ? g.angle : 180));
    return { type: 'linear', angle, stops }; // drop any stray position/size
  }
  const out = { type: 'radial', stops }; // drop any stray angle
  const inPct = (v) => typeof v === 'number' && v >= -200 && v <= 200;
  const inSize = (v) => typeof v === 'number' && v >= 0 && v <= 400;
  if (g.position && inPct(g.position.x) && inPct(g.position.y)) out.position = { x: g.position.x, y: g.position.y };
  if (g.size && inSize(g.size.w) && inSize(g.size.h)) out.size = { w: g.size.w, h: g.size.h };
  return out;
}

// --- deterministic background enhancement -----------------------------------
// The structured-output schema can't carry a gradient field (the board schema is
// at Anthropic's grammar ceiling — see BOARD_GEN_SCHEMA note). So the model picks
// a flat `background` COLOR for the mood, and we deterministically deepen it into a
// layered gradient seeded by that color, plus a legibility scrim on dark boards.
// This gives every generated board real depth with zero schema/grammar risk.

const _hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
function _parseHex(h) {
  if (typeof h !== 'string') return null;
  let m = /^#([0-9a-f]{3})$/i.exec(h);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16) };
  m = /^#([0-9a-f]{6})$/i.exec(h);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
  return null;
}
const _rgbHex = (c) => `#${_hex2(c.r)}${_hex2(c.g)}${_hex2(c.b)}`;
const _mix = (c, target, t) => ({ r: c.r + (target - c.r) * t, g: c.g + (target - c.g) * t, b: c.b + (target - c.b) * t });
const _lighten = (c, t) => _rgbHex(_mix(c, 255, t));
const _darken = (c, t) => _rgbHex(_mix(c, 0, t));
const _alphaHex = (c, a) => _rgbHex(c) + _hex2(a * 255);
const _luminance = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
const _uniqueId = (els, base) => { let id = base, n = 1; const used = new Set(els.map((e) => e?.id)); while (used.has(id)) id = `${base}${++n}`; return id; };

/**
 * Upgrade a board's full-bleed flat-color background into a tuned radial gradient
 * (lifted core -> darker edges) and, for dark boards, insert a bottom legibility
 * scrim. Idempotent: skips a bg that already has a gradient. Mutates + returns board.
 */
export function enhanceBoardBackgrounds(board, canvas) {
  const W = canvas?.w, H = canvas?.h;
  const els = board?.elements;
  if (!Array.isArray(els) || !W || !H) return board;
  const isFullBleed = (e) => e?.type === 'rect' && e.style && e.x <= W * 0.02 && e.y <= H * 0.02 && e.w >= W * 0.96 && e.h >= H * 0.96;
  const bg = els.find((e) => isFullBleed(e) && e.style.backgroundGradient == null && _parseHex(e.style.background));
  if (!bg) return board;
  const base = _parseHex(bg.style.background);
  const lum = _luminance(base);
  const dark = lum < 0.5;
  const grad = sanitizeGradient({
    type: 'radial', position: { x: 35, y: 30 },
    stops: [
      { color: _lighten(base, dark ? 0.14 : 0.06), at: 0 },
      { color: bg.style.background, at: 55 },
      { color: _darken(base, dark ? 0.45 : 0.18), at: 100 },
    ],
  });
  if (grad) bg.style.backgroundGradient = grad; // keep flat `background` as fallback
  if (dark) {
    const darkest = _parseHex(_darken(base, 0.7));
    const scrim = {
      id: _uniqueId(els, 'bgscrim'), type: 'rect', x: 0, y: 0, w: W, h: H,
      style: {
        opacity: 0.85,
        backgroundGradient: sanitizeGradient({ type: 'linear', angle: 180, stops: [
          { color: _alphaHex(darkest, 0), at: 0 }, { color: _alphaHex(darkest, 0.55), at: 100 },
        ] }),
      },
    };
    if (scrim.style.backgroundGradient) els.splice(els.indexOf(bg) + 1, 0, scrim); // above bg, below content
  }
  return board;
}
