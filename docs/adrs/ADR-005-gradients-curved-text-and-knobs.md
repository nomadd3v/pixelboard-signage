# ADR-005 — Gradients, curved text, and the CSS "knob" inspector

Status: **Proposed** (scope). Seeded by a real menu board that was ingested
on 2026-06-20 and set the quality bar: layered alpha gradients, opacity/blend
depth, and SVG `textPath` curved type.

## Context

The board model (ADR-004) keeps "the AI never writes template" true by making
`style` a **whitelist of property names with validated value SHAPES** — never a
freeform CSS string, never raw HTML/SVG (`src/board/schema.js` `STYLE_PROPS`,
`src/board/compile.js` `CSS`). Today `background` is solid-color only and the
element types are `text | image | rect`. That flatter vocabulary can't express
what makes that board good:

- a full-bleed radial base + a tonal **linear-gradient overlay** with `rgba`
  alpha stops, tuned for legibility over a photo;
- depth via stacked `opacity`/alpha planes;
- **curved text** (`<textPath>`) around the disk logo.

This ADR scopes three additions, each preserving the no-freeform-CSS invariant,
plus an authoring aid the operator asked for.

## Decision 1 — Gradients as a structured style value

Add a new whitelisted style prop `backgroundGradient` (leave `background`
solid-only; if both are present the gradient wins, or we reject — see Open
questions). The value is an **object**, validated shape-first:

```js
backgroundGradient: {
  type: 'linear' | 'radial',
  angle: 0..360,                 // linear only (deg)
  // radial only:
  position: { x: 0..100, y: 0..100 },   // default { x:50, y:50 }
  size: { w: 0..400, h: 0..400 },       // % of box; default cover-ish
  stops: [ { color, at }, ... ]  // 2..8 stops; color = existing isColor
                                 // (rgba()/#rrggbbaa already allowed -> alpha),
                                 // at = 0..100 (%), non-decreasing
}
```

Validator `validateGradient(g)` (in `schema.js`, called from `STYLE_PROPS`):
type in the set; `stops` length 2..8; every `color` passes `isColor`; every `at`
in 0..100; linear requires `angle`, radial uses `position`/`size`. Reject
unknown keys.

Compiler (`compile.js` `CSS.backgroundGradient`), all parts pre-validated so the
emitted string can carry nothing executable:

```
linear  -> background:linear-gradient(<angle>deg, <c1> <a1>%, <c2> <a2>%, ...)
radial  -> background:radial-gradient(<w>% <h>% at <x>% <y>%, <c1> <a1>%, ...)
```

This exactly reproduces both reference layers: the radial base and the
`linear-gradient(180deg, rgba(4,13,28,.60) 0%, … )` legibility overlay (an
overlay is just a `rect` element with `backgroundGradient` + `opacity`).

Risk: low. No new element type, no SVG. Pure value-shape extension of the
existing whitelist. **Recommended first.**

## Decision 2 — Curved text as a parameterized element

Add element `type: 'curvedText'`. It is the only path to SVG, and authors still
never write raw markup:

```js
{
  id, type: 'curvedText', x, y, w, h, rotation?,
  value: string,                       // tokenizable -> editable slot, like text
  curve: { kind: 'arc', radius: 1..5000, sweep: 'up' | 'down', sweepDeg?: 0..360 }
        | { kind: 'path', d: '<constrained path data>' },
  style: { fontFamily, fontSize, fontWeight, fontStyle, color, letterSpacing, textAlign }
}
```

- `kind:'arc'` — the **safe default**: the compiler *derives* the path `d` from
  radius + sweep. The author supplies no geometry string at all.
- `kind:'path'` — for fidelity (reproducing the reference board's exact curve). `d` is
  validated by a strict regex `^[MLHVCSQTAZmlhvcsqtaz0-9eE,.\s+\-]+$` with a
  length cap (~1000). Path data is geometry only — it cannot smuggle a scheme,
  `url()`, or markup — and it is still `escapeAttr`'d on emit (defense in depth).

Compiler emits inline SVG anchored like any element; the text content is a slot
token (editable) or escaped text (frozen), so `render()`/`guardian()` handle it
unchanged:

```html
<svg data-pb-el="<id>" style="position:absolute;left:..;top:..;width:..;height:..;overflow:visible"
     viewBox="0 0 <w> <h>">
  <defs><path id="pbc-<id>" d="<derived-or-constrained-d>"/></defs>
  <text style="<font css>"><textPath href="#pbc-<id>" startOffset="50%"
        text-anchor="middle">⟦TOKEN⟧ or escaped value</textPath></text>
</svg>
```

`pbc-<id>` is unique because `el.id` already is (`ID_RE`). Editable curved text
becomes a normal `kind:'text'` slot (`slotId(el.id,'text')`), so an operator can
change the words but not the curve. Studio/Fabric canvas editing of curved text
is out of scope here (Fabric has no native textPath) — authored via doc/AI first.

Risk: medium (new type, SVG surface). The `arc` preset carries ~zero new
surface; `kind:'path'` adds a constrained-string validator.

## Decision 3 — The CSS "knob" inspector (authoring aid)

A read-only **overlay** that scans a rendered page, finds tunable CSS values
("knobs"), and draws a visual representation anchored to each element — the
operator's idea: *e.g. a gradient surfaces a grayscale ramp overlay at ≤75%
opacity so you can see where the falloff is doing its work.*

Shape: a client-side script (sibling of `src/editor/inject.js`), injected by an
owner-only route — `GET /sites/:id/preview?inspect=1` (or `/inspect`). Because
it reads the live DOM via `getComputedStyle` + `getBoundingClientRect`, it works
on **both** board previews *and* ingested sites (no schema dependency).

Knobs detected and how each is visualized (absolutely-positioned overlay layer,
toggleable; never mutates the page):

| Knob | Detected from | Visual representation (anchored to the element box) |
|------|---------------|-----------------------------------------------------|
| Gradient | `background-image` contains `*-gradient(` | Grayscale **luminance ramp** of the gradient drawn on a `<canvas>` at ≤75% opacity, with stop ticks + a readout of angle/stops |
| Opacity / alpha | `opacity < 1`, `rgba` alpha | Corner gauge badge (e.g. "α .60") |
| Blur / filter | `filter`, `backdrop-filter` | Badge with px radius |
| Shadow | `box-shadow`, `text-shadow` | Offset/blur badge |
| Radius | `border-radius` | Badge |
| Type | `font-family/size/weight` | Small label chip |

Phase A: read-only visualization (above) — pure insight, no risk.
Phase B (later): make a knob **interactive** for board-backed sites only —
dragging a stop/opacity proposes a `board.style` change that runs through
`validateBoard()` (the design-time Guardian), so editing a knob can never escape
the whitelist. Ingested sites stay read-only (their CSS isn't a board doc).

## Rollout

1. **Gradients** (Decision 1) — smallest, highest value; reproduces the reference
   layers. Schema + compiler + tests.
2. **Knob inspector, Phase A** (Decision 3) — read-only viz; immediately useful
   on an already-ingested board and any site.
3. **Curved text** (Decision 2) — `arc` preset first, then `kind:'path'`.
4. **Interactive knobs, Phase B** — wire viz → `validateBoard` edits.

## Open questions

- `background` vs `backgroundGradient`: separate props (proposed) or overload
  one prop to accept color-or-object? Separate keeps validators simple.
- Curved text in the Fabric studio: render as a flat preview + an "edit curve"
  side panel, or defer studio support entirely and author via AI/doc?
- Knob inspector: standalone route vs. a toggle inside the existing editor shell.
