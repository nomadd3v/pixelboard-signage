# Third-party components

The repository licence (see `LICENSE`) covers Aaron Neece's own code and the
generated imagery described below. The following are third-party and stay under
their own licences.

## Fonts (vendored in `public/fonts/`, from Google Fonts)

| Font | Licence |
|------|---------|
| Caveat | SIL Open Font License 1.1 |
| Gloria Hallelujah | SIL Open Font License 1.1 |
| Gochi Hand | SIL Open Font License 1.1 |
| Give You Glory | SIL Open Font License 1.1 |
| Nanum Pen Script | SIL Open Font License 1.1 |
| Crafty Girls | Apache License 2.0 |
| Rock Salt | Apache License 2.0 |

Each remains the work of its original designer(s); the font files are
unmodified. The other typefaces the app references (Inter, Bebas Neue, Anton,
Oswald, Archivo Black, Space Grotesk, Playfair Display, Fraunces, JetBrains
Mono) are not vendored: they load from Google Fonts at runtime, or come from the
`@fontsource*` npm packages (OFL-1.1) at demo build time.

## npm dependencies (installed, not vendored)

express, cheerio, fabric (Fabric.js), @anthropic-ai/sdk, esbuild: MIT.
playwright: Apache-2.0. @fontsource packages: OFL-1.1. See each package's own
licence file after `npm install`.

## Imagery

- `public/backdrops/*.jpg` and the PNG logomark were generated with an AI image
  model from the author's own prompts. The demo's product "photos" are vector
  illustrations drawn in code (`src/demo/photos.js`).
- All businesses, menu items and prices in `src/demo/seeds.js` and in the
  screenshots are fictional.

## Lineage

Pixelboard's production-edit engine (ingest, Guardian, render, storage) was
seeded from the author's own earlier project, Vellum. The `VELLUM_*`
environment variables and `vellum-*` message names in the code come from there.

Vellum was itself built from a published design, the "AI-Native Client CMS:
Free Build Blueprint" by AI Automations by Jack. The core idea Pixelboard
inherits from it is the frozen template with editable slots, where every edit
passes a deterministic validator (the "Guardian") and the AI may only propose
changes, never write template code. The design editor, signage playback,
snapshots and rollback, and the demo are Pixelboard's own.
