# ADR-006 — Flat-image rasterization for dumb screens

Status: **Accepted** (built). Implements the "rasterize the site to a flat image
to serve to screens that can't load HTML" capability.

## Context

A published board is HTML + CSS + SVG (gradients per ADR-005, web fonts,
per-site hosted assets). Many signage endpoints can't render that: cheap
photo-frame displays, e-paper panels, ad-network slots, "set image URL" smart-TV
apps, anything that polls a single image. They need **one stable image URL** that
always shows the current board.

We already have the HTML analog: `/sites/:id/live` is the stable signage URL that
always serves the latest published snapshot and flips on publish. This ADR adds
its **image** counterpart.

## Decision

**`GET /sites/:id/live.png`** — a public, stable URL that returns a PNG of the
**latest published snapshot**, at the board's canvas resolution (default
1920×1080 for ingested sites with no board). Its bytes flip on each publish, so a
dumb screen polls one URL forever.

### How the image is produced — screenshot the real render

A headless Chromium (Playwright) navigates to the server's **own**
`/sites/:id/published/:snap` route and screenshots it at the canvas viewport.
This is faithful **by construction**: it captures the exact route a browser would
show, so gradients, SVG `textPath`, fonts, and hosted assets reproduce with zero
drift. The alternative — re-rendering the board doc onto a server-side canvas —
was rejected: it duplicates the renderer (a second thing to keep in sync), can't
reproduce CSS/SVG fidelity, and wouldn't work for **ingested** (non-board) sites
at all. Capturing the rendered route handles board and ingested sites uniformly.

### When it's produced

- **At publish:** the publish route fires rasterization in the background
  (best-effort, non-blocking) and stores the PNG beside the snapshot
  (`snapshots/:sid/display.png`).
- **Lazily:** if a request to `/live.png` finds no stored image (capture is still
  running, failed, or the snapshot predates this feature), it rasterizes on the
  spot and caches the result.
- **On demand:** `POST /api/sites/:id/rasterize` (owner/client) re-captures the
  latest snapshot now — the editor's **"Rasterize now"** button. 409 if nothing
  is published yet.

### Best-effort, never load-bearing

Playwright + its browser are an **optional** capability, imported lazily. The
rasterizer launches one shared browser on first use and reuses it. If Playwright
or the browser is missing:

- **publish still succeeds** (the background capture just logs a warning);
- `/live.png` returns **503** with an install hint instead of 500ing;
- `POST …/rasterize` returns **503** with the same hint.

Install the browser with `npx playwright install chromium`. Nothing else in the
engine depends on it.

## Invariants preserved

- **One render function.** We screenshot the output of `render()` (via the
  published-snapshot route) — we do **not** add a second renderer.
- **Templates are frozen / immutable snapshots.** The PNG is derived from an
  already-immutable snapshot and stored beside it; it never mutates a board.
- No new authoring surface, no AI, no template/HTML authored by the rasterizer.

## Surface

- `src/rasterize.js` — `rasterizeUrl({url,width,height})` → PNG Buffer; lazy
  singleton browser; `RasterizeUnavailable` for graceful degradation;
  `closeRasterizer()` for shutdown/tests.
- `storage.js` — `latestSnapshot(id)`, `savePublishImage(id,snap,buf)`,
  `readPublishImage(id,snap)` (PNG lives at `snapshots/:sid/display.png`).
- `server.js` — `GET /sites/:id/live.png`, `POST /api/sites/:id/rasterize`,
  publish-route background capture.
- `pages.js` — "Flat image" card in the editor: stable URL, "Rasterize now",
  live thumbnail.

## Open questions / later

- **Polling vs push:** screens poll `/live.png`; we send `Cache-Control:
  no-cache`. A future `?since=` / ETag could let a screen cheaply detect "did it
  change" without re-downloading.
- **JPEG/quality knob** for bandwidth-constrained panels (PNG is lossless but
  large at 1920×1080). Add `?fmt=jpeg&q=` if a real screen needs it.
- **Scheduled pre-warm:** rasterize ahead of a scheduled publish so the very
  first poll is never the slow lazy path.
