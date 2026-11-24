# Pixelboard — Brand Assets

Pixelboard is a Canva-style AI design editor for digital signage (restaurant
menu boards, digital signs). The mark fuses **pixels** + a **board/screen**: a
grid of glowing pixels forms a display, and a few pixels lift off the top-right
corner to suggest design + motion.

## Palette

| Role            | Hex       | Notes                                  |
|-----------------|-----------|----------------------------------------|
| Gradient start  | `#2E6BFF` | Electric blue                          |
| Gradient mid    | `#7B2FF7` | Violet                                 |
| Gradient end    | `#FF2EC4` | Magenta                                |
| Neutral / ink   | `#0A0A0A` | Near-black — dark UI bg + light-bg text|
| White           | `#FFFFFF` | Light UI bg + dark-bg text             |

Brand gradient runs diagonally (top-left → bottom-right): blue → violet → magenta.

## Font

Wordmark uses a clean geometric/grotesk sans. Recommended: **Inter** (700 weight,
tight `-1.5` tracking). Stack falls back to `Helvetica Neue, Arial, system-ui,
sans-serif`. The wordmark sets "Pixel" in the neutral ink (or white on dark) and
"board" in the brand gradient.

## Files

| File                          | What it is                                              |
|-------------------------------|--------------------------------------------------------|
| `app-icon-1024.png`           | 1024×1024 app icon — mark on rounded-square gradient tile (AI-generated, opaque). |
| `logomark-512.png`            | 512×512 icon-only mark, **transparent** background (AI-generated, chroma-keyed). |
| `wordmark-light.svg`          | Full lockup (mark + "Pixelboard") for **light** backgrounds. |
| `wordmark-dark.svg`           | Full lockup for **dark** backgrounds (white text).     |
| `brand.md`                    | This file.                                             |
| `../favicon.svg`              | Crisp vector favicon (hand-authored).                 |
| `../favicon-32.png`           | 32×32 favicon (rendered from `favicon.svg`).          |
| `../favicon-16.png`           | 16×16 favicon (rendered from `favicon.svg`).          |

## Usage

Prefer the SVGs (favicon, wordmark) — they scale crisply at any size. Use the
gradient app icon on launchers/stores; use the transparent `logomark-512.png`
when placing the mark on photos or colored surfaces.

## Layers

Decomposed / individual brand assets live in `layers/`. The three **stacked
layers** share one 512×512 canvas and registration, so they overlay perfectly
and each can be animated independently (e.g. fade the tile, scale the grid,
fling the scatter on load). Stacking tile → grid → scatter reproduces the
composed app-icon mark; the grid + scatter alone recombine byte-for-byte into
the source `logomark-512.png` (verified, max diff = 0).

### Stacked logo layers (512×512)

| File                        | What it is                                                                 |
|-----------------------------|---------------------------------------------------------------------------|
| `layers/layer-tile-gradient.png` | Background only — the rounded-square diagonal gradient tile (blue `#2E6BFF` → violet `#7B2FF7` → magenta `#FF2EC4`, TL→BR). Opaque interior, transparent outside the rounded corners. |
| `layers/layer-board-grid.png`    | The pixel-grid display board only — **white** glowing pixels, transparent bg, inset to match the app-icon framing. |
| `layers/layer-scatter-pixels.png`| The lifting/scattering pixels off the top-right corner only — **white**, transparent bg, same canvas/inset as the grid. |

### Individual pixel elements (128×128, transparent)

Single glowing rounded-square "pixels" for loaders, accents, and decoration —
one per brand color plus a full-gradient pixel.

| File                       | Color                          |
|----------------------------|--------------------------------|
| `layers/pixel-blue.png`    | Electric blue `#2E6BFF` + glow |
| `layers/pixel-violet.png`  | Violet `#7B2FF7` + glow        |
| `layers/pixel-magenta.png` | Magenta `#FF2EC4` + glow       |
| `layers/pixel-gradient.png`| Full diagonal brand gradient + glow |

### Studio UI icon set (24×24 SVG, `currentColor`)

Hand-authored monochrome line icons for the studio editor toolbar. Geometric
line style consistent with `favicon.svg`; inherit color via CSS `color`.

| File                          | Use                                  |
|-------------------------------|--------------------------------------|
| `layers/icon-text.svg`        | Add / edit text element              |
| `layers/icon-image.svg`       | Add / replace image                  |
| `layers/icon-rect.svg`        | Add rectangle / shape                |
| `layers/icon-move.svg`        | Move / reposition tool               |
| `layers/icon-layers.svg`      | Layer panel / z-order                |
| `layers/icon-ai-sparkle.svg`  | AI assist / generate                 |
| `layers/icon-publish.svg`     | Publish / push live                  |
| `layers/icon-screen.svg`      | Preview on display / signage screen  |

## Social & Marketing

All built from the locked brand spec above — exact palette, Inter 700/800 with
tight tracking, the real `logomark-512.png` composited (never re-generated). The
social cards are CSS-rendered (guaranteed-readable text, exact hex); the
hero/spots are AI-illustrated in brand style; the pattern is a procedurally
generated seamless tile.

### Social (`social/`)

| File                          | Size      | Intended use                                            |
|-------------------------------|-----------|---------------------------------------------------------|
| `og-1200x630.png`             | 1200×630  | Open Graph / link-preview card (Facebook, LinkedIn, Slack, iMessage, generic `og:image`). Mark + wordmark + tagline on `#0A0A0A` with gradient accent glow. |
| `social-square-1200.png`      | 1200×1200 | Square variant for Instagram / LinkedIn feed posts and profile-style placements. |
| `twitter-card-1200x675.png`   | 1200×675  | X/Twitter `summary_large_image` card (16:9). |

### Marketing / continuity (`marketing/`)

| File                          | Size      | Intended use                                            |
|-------------------------------|-----------|---------------------------------------------------------|
| `pattern-pixel-grid.png`      | 200×200   | Seamless tileable pixel-grid texture (brand-tinted, dark) for hero/section backgrounds. `background: #0A0A0A url(...) repeat;` — verified seamless via 2×2 montage. |
| `hero-1600x900.png`           | 1600×900  | Marketing hero graphic — a digital menu/sign board displaying editable content, gradient accents, pixels scattering off the top-right. Left side has dark negative space sized for a headline overlay. |
| `spot-design.png`             | 800×800   | Spot illustration for "design" — a pen editing a grid of glowing pixels. **Transparent** background (green-screen chroma-keyed). |
| `spot-publish.png`            | 800×800   | Spot illustration for "publish to a screen" — a display board with an upload/broadcast and content flowing in as pixels. **Transparent** background. |

### Recommended `<meta>` tags

Replace `https://pixelboard.app` with the live origin.

```html
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pixelboard">
<meta property="og:title" content="Pixelboard">
<meta property="og:description" content="Design once. Edit safely. Publish to any screen.">
<meta property="og:image" content="https://pixelboard.app/branding/social/og-1200x630.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Pixelboard — design once, edit safely, publish to any screen.">

<!-- X / Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Pixelboard">
<meta name="twitter:description" content="Design once. Edit safely. Publish to any screen.">
<meta name="twitter:image" content="https://pixelboard.app/branding/social/twitter-card-1200x675.png">
<meta name="twitter:image:alt" content="Pixelboard — design once, edit safely, publish to any screen.">

<!-- theme color (matches brand ink) -->
<meta name="theme-color" content="#0A0A0A">
```
