# ADR-004 — Board model: a design surface that produces the engine artifact

Status: Accepted — implemented (Fabric.js studio, path A)
Date: 2026-06-17 (updated 2026-06-18)
Supersedes: nothing. Extends ADR-001 (content model).

## Implementation update (2026-06-18)

The scaffold's thin authoring path was replaced by a **Fabric.js** studio (MIT,
v7) — "path A": Fabric drives the canvas, and on save we serialize objects back
into the board schema, which compiles to HTML exactly as before. The production
engine, Guardian, compiler, and the two load-bearing invariants are unchanged.

Done since the scaffold:
- Fabric.js editor (drag/resize/multi-select/rotate, styling inspector, z-order,
  keyboard) — the single studio editor; the hand-rolled one was removed.
- Canvas **dimensions / aspect-ratio** control (presets 9:16, 16:9, 1:1, 21:9 +
  custom) at creation and live in-editor.
- **Element rotation** (the path-A fidelity gap): schema `rotation`, compiler
  emits `transform:rotate` pivoting at the top-left to match Fabric's origin.
- **Asset pipeline**: images uploaded in the studio are hosted by Pixelboard
  (`/sites/:id/assets/:file`, content-addressed) so boards + published snapshots
  don't hotlink external URLs.
- **AI board generation**: English → a structured board doc gated by the SAME
  whitelist validator (the AI never writes code/template, one level up).

Two Fabric gotchas worth recording (both found via in-browser verification):
- `fontFamily` must be a SINGLE family name, not a CSS stack — Fabric writes it
  into `ctx.font` verbatim (a comma-stack collapses glyphs to ~0 width).
- Fabric v6+ defaults object origin to CENTER; pin `originX/originY` to left/top
  so the schema's top-left x/y render correctly.

Still deferred: `/live/:board` stable signage alias, multi-screen/multi-page,
snapping/alignment guides, font/asset bundling for offline deploy.

## Context

Pixelboard adds a **design/creation surface** (a Canva-style editor for digital
signage) on top of the inherited Vellum engine. The engine already consumes a
single artifact — `{ template (frozen HTML + sentinel tokens), slots (manifest),
content (values) }` — produced today by `ingest()` from existing HTML, and then
served by the one `render()` and gated by the one `guardian()`.

We do **not** want a second engine. We want a second *producer* of the same
artifact, so render / Guardian / publish / versions / rollback stay untouched and
production click-to-edit works on a designed board with zero new engine code.

## Decision

A **board** is a fixed-canvas JSON scene graph:

```
{ id, name, canvas: { w, h },
  elements: [ { id, type, x, y, w, h, style, value, slot } ] }
```

A pure **compiler** (`src/board/compile.js`) turns a board into the engine
artifact: `compileBoard(board) -> { template, slots, content }`. The studio edits
boards; compiling a board creates/updates an engine "site". The board is the
*design doc*; the template is the *frozen artifact*. (This mirrors ADR-001's
generator×artifact split: the studio generates, the engine consumes.)

### Decision 1 (load-bearing) — slot identity is anchored to a persistent element id, not canvas position

`slotId(element.id, field)`, where `element.id` is assigned once at element
creation and never reused. In `ingest()`, slot ids derive from a DOM path because
re-ingesting the same source is structurally stable. In a studio the entire point
is *moving and restyling things*, so any position- or path-derived id would orphan
a client's saved content the instant a designer nudges an element. Anchoring to a
stable element id is the studio analog of ADR-001's "structural slot ids."

**Acceptance test for the whole scaffold:** author a board → edit a value in the
production editor → move/restyle that element → recompile → the client's content
and version history survive. If this fails, the architecture is not real.

### Decision 2 (load-bearing) — the board schema is a whitelist (the design-time Guardian)

Once AI can write a board doc, "the AI never writes code/template" is only true if
the doc **cannot express code**:

- `type` ∈ a fixed set (`text | image | rect`, extensible by allow-list only).
- `style` is a **whitelisted property map** (e.g. `color`, `background`,
  `fontSize`, `fontWeight`, `textAlign`, `borderRadius`, `padding`) with validated
  value shapes — **never** a freeform CSS string and never raw HTML.
- url-bearing values (`image.value`, link hrefs) remain subject to the existing
  runtime Guardian on every edit.

This is the design-time analog of the Guardian. Retrofitting a whitelist onto a
freeform schema later is brutal, so it is mandatory from the first commit.

### Decision 3 — compiler escaping reuses the engine, no double-escaping

Frozen (non-editable) text is escaped **once** at compile time into the template
literal. Editable values emit a **raw sentinel token** (`token(slotId)`); the
existing `render()` escapes the value at serve time per context (text vs attr).
The compiler reuses `ids.js` (`slotId`, `token`, `escapeText`, `escapeAttr`) and
adds no new escaping logic.

### Decision 4 — fullscreen/kiosk is a serving wrapper, not a render mode

A display/kiosk view scales the already-published HTML to the viewport at the
serving layer. `render()` stays `edit | publish` only; we do not add a third mode.

## Consequences

- The studio scaffold's deliverable is the **schema + compiler (pure, tested)**
  plus one thin authoring path that closes the loop (board → compile → edit →
  publish → fullscreen). The real drag/resize/layers editor is a later sprint on a
  locked contract.
- Vanilla-vs-framework is **not** a scaffold decision (the thin path needs almost
  no client JS); revisit when building the real editor.

## Deferred (recorded so the model leaves room)

- **Asset pipeline** — a designed board places images/fonts. Fonts = a web-font
  link (easy). Images = upload + host by Pixelboard (the engine currently hotlinks
  origin assets, which a from-scratch board has none of). Scaffold starts with text
  + AI/URL images; storage must leave room for uploaded assets.
- AI board generation (plain English → board doc, validated against the schema).
- `/live/:board` — a stable per-board URL a screen points at that flips on publish
  (signage needs a fixed URL, not snapshot-id URLs).
- Multi-screen / multi-page boards under one account; scheduling.
- The real Canva-style editor (drag/resize/layers/snapping) + framework choice.
