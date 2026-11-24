# Template / Gallery / Library Subsystem — Roadmap + Canonical Tagging Spec

Status: Planning artifact (not yet implemented beyond v1, which is in flight in parallel)
Date: 2026-06-18
Relates to: ADR-004 (board model), ADR-001 (content model)
Audience: Pixelboard contributors **and** any future project that needs a tagged template library — Section 2 is written to be lifted out verbatim.

---

## 1. Vision & scope

### What it is

The template/gallery/library subsystem is the **front door to the design surface**. Today a user lands on `/studio`, picks a canvas size, and gets a near-blank `starterBoard()` (`src/server.js`, two text elements on a black rect). That is the blank-canvas problem in miniature. The library replaces it with a **curated gallery of ready-made boards** the user can browse, filter, preview at the correct aspect ratio, and instantiate in one click.

A **template is not a new artifact type.** Per ADR-004, *a template IS a board doc* — `{ name, canvas:{w,h}, elements:[...] }` that passes `validateBoard()` (`src/board/schema.js`). It compiles through the exact same `compileBoard()` → `{template, slots, content}` path as everything else. The library is therefore a **catalog of board docs plus metadata (tags, description, attribution)** — no engine changes, no second compiler, no third render mode.

### Jobs the subsystem does

1. **Remove the blank-canvas problem** — most signage operators are not designers; they want to start from "Today's Special menu board" and edit values, not place rectangles.
2. **Speed creation** — create-from-template is already 90% free: `POST /api/studio/boards` (`src/server.js` ~L266) already branches on `body.board`. The gallery just POSTs the chosen template's board doc; no new compile path is needed.
3. **Showcase the engine** — a polished gallery is the demo. Aspect-correct thumbnails rendered through the real `compile→render` pipeline prove the product to a prospect in seconds.
4. **Enable resale / marketplace later** — once templates carry attribution + license + tags, they become a sellable/shareable unit (designer publishes a pack; operator imports it). The tagging system below is the substrate that makes a marketplace searchable.

### What it explicitly is NOT (in v1)

- **NOT** a user-generated template store. v1 ships **built-in, curated** templates as JS modules. "Save my board as a template" is v2+.
- **NOT** a DB-backed catalog. v1 is in-repo data; DB migration is a later slice (Section 4).
- **NOT** faceted multi-axis search UI. v1 ships a **category dropdown / chip filter** over a pragmatic flat tag list. The full canonical taxonomy (Section 2) is specced now so v1 can be a strict *subset* of it, but the faceted filter ships in v2.
- **NOT** multi-page template sets, localization variants, or usage analytics. All deferred and sliced below.

---

## 2. Canonical tagging system (portable spec)

> **This section is the reusable centerpiece.** It is split into a **portable core** (lift to any template library — signage, web, social, docs — unchanged) and a **project-specific layer** (the controlled-vocabulary value lists, which you swap per project). The litmus test: *everything except the vocabulary lists drops into another project untouched.* If something signage-specific leaks into the core, it is misplaced.

### 2.1 Portable core — the tag grammar

A tag is a single string in the form:

```
facet:value
```

- **`facet`** — which axis the tag belongs to (e.g. `category`, `orientation`).
- **`value`** — the controlled value on that axis.
- **Separator** — a single colon. A value may itself contain hyphens but never a colon.

**Casing — `lowercase-kebab`.** Both facet and value are lowercase ASCII, words joined by hyphens: `category:menu-board`, `style:bold-modern`. No spaces, no camelCase, no underscores. Rationale: tags appear in URLs (`?tag=category:menu-board`), filenames, and JSON keys; one casing rule means zero normalization bugs and case-insensitive matching is free.

**Controlled vocabulary, not free tags.** Every value must come from the facet's allowed set (Section 2.4). Free-text tags are rejected. Rationale: free tags fragment instantly (`xmas` / `christmas` / `holiday`) and break both filtering and AI recommendation. A new value is a one-line vocabulary edit + a PR, which is the point — the vocabulary is a reviewed asset.

**Cardinality (multi-value rules).** Each facet declares whether it is **single-value** (at most one tag with that facet) or **multi-value** (several allowed). E.g. a template has exactly one `orientation:` but may carry several `industry:` tags.

**Required vs optional facets.** A facet is **required** (every template must carry exactly one) or **optional**. Validation fails if a required facet is missing or a single-value facet appears twice.

**The facet-inclusion test.** A facet earns its place only if it answers **yes** to: *"will a user filter on this, OR will the AI match on it?"* If neither, drop it. This is how the set below stays tight.

### 2.2 Portable core — the validator contract

The validator **deliberately mirrors `validateBoard()` in `src/board/schema.js`** — same signature, same return shape — so it reads as native in this codebase and lifts cleanly into any other:

```
validateTags(tags: string[], vocab: Vocabulary)
  -> { ok: true }
   | { ok: false, errors: { path, code, message }[] }
```

Error codes (stable, machine-readable, same spirit as schema.js's `bad_id`/`unknown_style`):

| code | meaning |
|---|---|
| `bad_tag_format` | not `facet:value`, or not lowercase-kebab |
| `unknown_facet` | facet not in the vocabulary |
| `unknown_value` | value not in that facet's allowed set |
| `missing_required_facet` | a required facet has no tag |
| `cardinality` | a single-value facet appears more than once |

`Vocabulary` is the **only project-specific input** — a plain map `facet -> { required, multi, values:Set<string> }`. The validator logic is 100% portable; you ship a different `Vocabulary` per project.

### 2.3 The canonical facet set (specialized for signage)

Tight canonical set. Each facet is justified by the inclusion test, with cardinality and required/optional called out.

| Facet | Req? | Card. | Justification (filter? / AI-match?) |
|---|---|---|---|
| `category` | **required** | single | The primary "what is this" axis. The #1 user filter ("show me menu boards"). |
| `orientation` | **required** | single | Coarse shape filter. **Computed**, not hand-assigned (see below). A portrait screen wants portrait templates. |
| `aspect` | **required** | single | Exact-ratio match. **Computed.** Distinct job from orientation: a 16:9 and 21:9 are both landscape but a user picking for an ultrawide needs the exact ratio. |
| `industry` | optional | multi | Vertical relevance ("restaurant", "gym"). AI strongly matches on this; users in a vertical filter to it. Multi: a template can fit cafe + bakery. |
| `style` | optional | multi | Aesthetic ("bold-modern", "minimal"). Primary AI-recommendation signal and a browse filter. |
| `color-theme` | optional | multi | Palette feel ("dark", "vibrant", "brand-blue"). Users filter to match their brand; AI matches "make it dark". |
| `density` | optional | single | How much content fits ("single-focus" vs "multi-item-menu"). Decides whether a template suits one promo or a 12-item menu. AI + filter. |
| `occasion` | optional | multi | Time/event context ("holiday", "summer", "happy-hour", "grand-opening"). **Season is folded in here** (a season is just a recurring occasion) — one fewer near-duplicate facet. |
| `language` | optional | multi | Localization. Filter + future localization slice. Default-omittable (untagged = the library default locale). |

**Dropped / folded by the inclusion test:** a standalone `season` facet (folded into `occasion`); a `tone`/`mood` facet (collapsed into `style`); a `complexity` facet (covered by `density`). Each failed "is it a distinct filter/AI signal?".

#### Computed facets — `orientation` and `aspect` are derived from `board.canvas.{w,h}`, never hand-typed

This is a deliberate anti-drift rule. Because a template IS a board doc with a real `canvas:{w,h}` (validated 1..10000 in `schema.js`), orientation and aspect are **functions of the geometry**, so they can never disagree with the actual board:

- `orientation` = `w > h` → `landscape`; `w < h` → `portrait`; `w === h` → `square`. (Ultrawide is still `landscape`; the *ratio* distinction lives in `aspect`.)
- `aspect` = the canvas ratio snapped to the nearest known bucket (`16x9`, `9x16`, `1x1`, `21x9`, …) within a tolerance, else `custom`. (The bucket uses `x`, not `:`, so the value obeys the grammar's "no colon in a value" rule — `aspect:16x9` parses cleanly.)

The library computes and stamps these at registration time; authors never set them. This mirrors ADR-004's "slot identity anchored to a stable id, not position" instinct — derive from the source of truth, don't duplicate it.

### 2.4 Controlled vocabulary — seed lists (project-specific layer)

These are the **swappable** part. A web/social/docs library replaces these lists and keeps everything in 2.1–2.3.

```
category   : menu-board | promo | event | announcement | wayfinding |
             hours | specials | welcome | pricing | gallery
orientation: landscape | portrait | square          (COMPUTED)
aspect     : 16x9 | 9x16 | 1x1 | 21x9 | 4x3 | custom (COMPUTED)
industry   : restaurant | cafe | bar | bakery | retail | gym |
             salon | clinic | hotel | events | nonprofit | generic
style      : bold-modern | minimal | elegant | playful | retro |
             editorial | tech | handcrafted
color-theme: dark | light | vibrant | mono | pastel |
             brand-blue | brand-violet | brand-magenta
density    : single-focus | balanced | multi-item-menu
occasion   : holiday | summer | winter | spring | fall |
             happy-hour | grand-opening | sale | seasonal
language   : en | es | fr | de | pt | zh   (omit = library default)
```

`color-theme` deliberately anchors on the Pixelboard **brand palette** (blue `#2E6BFF`, violet `#7B2FF7`, magenta `#FF2EC4`, ink `#0A0A0A`, white `#FFFFFF`) for the `brand-*` values, plus generic feels (`dark`/`light`/`vibrant`/`mono`/`pastel`). In another project you'd swap `brand-*` for that project's palette names.

### 2.5 How tags drive gallery + recommendation

**Filtering / search.** The gallery filter is a set of facet chips. Selecting chips builds an AND-across-facets, OR-within-facet query:

```
(category:menu-board) AND (industry:restaurant OR industry:cafe) AND (orientation:portrait)
```

Because `orientation`/`aspect` are computed, the gallery can **auto-prefilter** to the canvas the user already chose at `/studio` — pick a portrait canvas, see portrait templates first. Free-text search is a thin layer: tokenize the query, map known words to vocabulary values, fall back to matching `name`/`description`.

**Recommendation (AI picks a template).** The AI never invents tags — it **scores candidates by tag overlap**. Given a plain-English brief ("a dark happy-hour promo for a cocktail bar, vertical screen"), the AI maps phrases to vocabulary values (`color-theme:dark`, `occasion:happy-hour`, `industry:bar`, `category:promo`, `orientation:portrait`) and ranks templates by weighted facet match (required facets weighted highest). This stays inside the ADR-004 guardrail: the AI proposes *a choice among validated board docs*, never new template/code. It composes naturally with existing `generateBoard()` — pick the closest template, then let AI fill its slots (v2 slice below).

### 2.6 Portability — what to copy, what's project-specific

**Copy verbatim into another project (the portable core):**
- The `facet:value` grammar + `lowercase-kebab` casing rule (2.1).
- The required/optional + single/multi cardinality model (2.1).
- The computed-facet idea (derive shape facets from the artifact's geometry) (2.3).
- The `validateTags()` contract + error codes (2.2) — and its implementation, which depends only on the `Vocabulary` map.
- The template-entry shape (Section 4) minus the `board` field's schema.

**Swap per project (the project-specific layer):**
- The `Vocabulary` map — i.e. all the value lists in 2.4.
- The `board` field's own validator (`validateBoard` here; some other schema elsewhere).
- The thumbnail strategy (here: `compile→render`; elsewhere maybe a stored PNG).

### 2.7 Fully-tagged template entry (JSON example)

```json
{
  "id": "menu-board-dark-specials-portrait",
  "name": "Dark Specials — Portrait Menu Board",
  "description": "High-contrast vertical board for daily specials with a bold price callout.",
  "tags": [
    "category:menu-board",
    "orientation:portrait",
    "aspect:9x16",
    "industry:restaurant",
    "industry:cafe",
    "style:bold-modern",
    "color-theme:dark",
    "color-theme:brand-magenta",
    "density:multi-item-menu",
    "occasion:seasonal"
  ],
  "board": {
    "name": "Dark Specials",
    "canvas": { "w": 1080, "h": 1920 },
    "elements": [
      { "id": "bg", "type": "rect", "x": 0, "y": 0, "w": 1080, "h": 1920, "style": { "background": "#0a0a0a" } },
      { "id": "title", "type": "text", "x": 80, "y": 120, "w": 920, "h": 160,
        "value": "Today’s Specials",
        "style": { "color": "#ffffff", "fontFamily": "inter", "fontSize": 96, "fontWeight": 800 },
        "slot": { "editable": true, "label": "Title" } }
    ]
  },
  "thumbnail": { "strategy": "compile-render", "cache": null },
  "attribution": { "author": "pixelboard", "source": "built-in" },
  "license": "proprietary-builtin",
  "createdAt": "2026-06-18T00:00:00.000Z"
}
```

Note `orientation:portrait` and `aspect:9x16` agree with `canvas:{w:1080,h:1920}` because they were **computed from it**, not typed.

---

## 3. Sliced roadmap

Each slice: **goal · scope · exit criteria · dependencies.** Ordering is value-first and dependency-respecting.

### v1 — Curated gallery + create-from-template (in flight)

- **Goal:** kill the blank-canvas problem; ship a browsable gallery of built-in templates with aspect-correct thumbnails.
- **Scope:**
  - Built-in templates as JS modules (board docs), each a registry entry (Section 4 shape, but with a **pragmatic flat tag shape** — see note below).
  - Gallery picker on `/studio` (replaces/augments the bare preset dropdown in `studioListPage`, `src/pages.js`).
  - Create-from-template: gallery POSTs the chosen template's `board` to existing `POST /api/studio/boards` (already branches on `body.board`, `src/server.js` ~L266) → returns `/studio/:id`.
  - Aspect-correct thumbnails: render each template via `compileBoard()` → `render()` and scale with the `displayWrapper` technique (`src/pages.js`). **Generated, not stored** in v1.
- **v1 pragmatic tag shape (proposed — NOT yet in code; the grep confirms no tag system exists).** Ship the smallest thing that the canonical system supersets: a flat `tags: string[]` plus a single `category` string, OR bare keyword tags (`"menu-board"`, `"dark"`). **Migration to canonical:** namespace-prefix each bare tag to `facet:value` (`"dark"` → `color-theme:dark`), stamp computed `orientation`/`aspect` from `canvas`, then run `validateTags()`. One pass, mechanical.
- **Exit criteria:**
  1. `/studio` shows ≥6 built-in templates across ≥3 categories with correct-ratio thumbnails.
  2. Clicking a template creates a board-backed site and opens `/studio/:id` with the design loaded.
  3. The created board compiles and is editable in the production editor unchanged (proves no new artifact type).
  4. At least a category filter narrows the gallery.
- **Dependencies:** none beyond the existing engine.

### v2 — Faceted gallery filter/search + tag spec adoption

- **Goal:** make the gallery scale past a handful of templates; adopt the canonical tag schema.
- **Scope:** implement `validateTags()` + the `Vocabulary` map; migrate v1 tags (mechanical pass above); facet-chip filter UI (AND-across / OR-within); auto-prefilter by the user's chosen canvas (computed `orientation`/`aspect`); thin keyword search.
- **Exit criteria:** every built-in template passes `validateTags()`; selecting facet chips filters live; choosing a portrait canvas surfaces portrait templates first.
- **Dependencies:** v1 registry; canonical spec (Section 2).

### v3 — AI fill + AI template recommendation

- **Goal:** close the loop from intent → finished board.
- **Scope:** (a) **AI-fill a template** — after create-from-template, a plain-English brief drives `generateBoard()` to populate slot values within the chosen template (reuses the existing whitelist gate; AI never rewrites the design). (b) **AI recommend** — the tag-overlap scorer (2.5) picks the closest template from a brief, then hands off to fill.
- **Exit criteria:** "dark happy-hour promo, vertical" returns a ranked template list; selecting one + a brief yields a filled, Guardian-valid board.
- **Dependencies:** v2 tags (recommendation needs the vocabulary); provider key (`ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`).

### v4 — User-saved templates ("save board as template")

- **Goal:** let users grow the library from their own work — the first UGC step and the prerequisite for sharing.
- **Scope:** "Save as template" in the studio → captures current board doc + author-entered name/description/tags (validated) into a **user** template store (per-owner), surfaced in the gallery under a "My templates" collection. This is where the registry must move off pure built-in JS modules toward a writable store (Section 4 migration).
- **Exit criteria:** save a designed board as a template; it appears in the gallery; create-from-it produces an independent board.
- **Dependencies:** v2 (tag validation on user input); Section 4 writable store.

### v5 — Collections / categories + thumbnail caching

- **Goal:** organize a growing library and make the gallery fast.
- **Scope:** named **collections** (curated groups: "Summer 2026", "Restaurant starter pack") as tag-query saved views or explicit membership; **thumbnail caching/generation** — render once on registration/save, cache the scaled PNG/HTML, invalidate on board change (the v1 on-the-fly render won't scale to dozens of templates).
- **Exit criteria:** collections render as gallery sections; thumbnails serve from cache with correct invalidation.
- **Dependencies:** v4 (more templates make caching worth it).

### v6 — Template versioning + export/import

- **Goal:** make templates durable, shareable units; groundwork for a marketplace.
- **Scope:** **versioning** — a template edit creates a new version (mirrors the engine's content version model in `storage.js`), so consumers can pin/upgrade; **export/import** — a template (entry + board + tags + attribution/license) serializes to a portable JSON pack and imports into another Pixelboard instance, re-validated by `validateBoard()` + `validateTags()` on import (never trust an imported doc).
- **Exit criteria:** export a template to JSON, import into a clean instance, create-from-it; an edit bumps version without breaking existing boards created from the old version.
- **Dependencies:** v4/v5; Section 4 store.

### v7 — Template marketplace / sharing

- **Goal:** designers publish packs; operators discover and import (with the resale model from Section 1).
- **Scope:** publish flow, browse-others'-templates, license enforcement on import, attribution display. Entirely additive on top of export/import (v6) + tags (v2) + versioning (v6).
- **Exit criteria:** publish a pack; another account discovers via tag search and imports it; license + attribution carried through.
- **Dependencies:** v6; auth/account model beyond owner/client.

### Later / parallel slices

- **Multi-page template sets** — a template that is several boards (a 3-screen rotation). Depends on the engine's multi-page support (currently deferred in ADR-004), so it can't precede that. Tag at the *set* level; members inherit.
- **Localization** — `language:` facet drives locale variants of a template; a localized template references sibling boards per locale. Slots already separate values from design, so this is mostly a registry/linking concern. Depends on v2 tags.
- **Usage analytics** — count create-from-template per template/tag to drive "popular" sorting and prune dead templates. Cheap to add once a store exists (v4); informs collection curation (v5).

**Why this ordering:** v1–v3 deliver end-user value with zero/low infra (gallery → search → AI). v4 is the inflection where storage must change. v5–v7 build the marketplace stack in dependency order (organize → portable units → versioned → published). Analytics/localization/multi-page are pulled in opportunistically once their prerequisites land.

---

## 4. Data model

### v1 — built-in JS modules

Templates ship as code in the repo (e.g. `src/templates/*.js` exporting registry entries, aggregated by an index). Rationale: zero infra, type-checkable, reviewed via PR, and the controlled vocabulary lives next to the data. The gallery imports the index; thumbnails render on demand. This matches the codebase's current "data as JS, no DB" posture (`starterBoard()` is literally a board doc in `server.js`).

### Template entry shape (canonical, supersets the v1 pragmatic shape)

```
{
  id:          string,        // stable, lowercase-kebab, never reused
  name:        string,        // display name
  description: string,        // one-line gallery blurb
  tags:        string[],      // facet:value, validated by validateTags()
  board:       BoardDoc,      // a board doc; MUST pass validateBoard()
  thumbnail:   { strategy: 'compile-render' | 'stored', cache: string|null },
  attribution: { author: string, source: 'built-in' | 'user' | 'imported' },
  license:     string,        // 'proprietary-builtin' | 'cc-by' | ...
  createdAt:   string         // ISO timestamp
}
```

Two integrity rules, both reusing existing engine guarantees:
- **`board` is gated by `validateBoard()`** — no new artifact type, no new validator (ADR-004).
- **`tags` is gated by `validateTags()`** — required facets present, values in vocabulary (Section 2).

### Storage — where templates live across slices

| Slice | Built-in templates | User/imported templates |
|---|---|---|
| v1 | JS modules in repo | — |
| v4 | JS modules (still) | per-owner store on disk (mirrors `saveBoard`/`getBoard` in `storage.js`: a `templates/` dir of JSON entries) |
| v6+ | JS modules or seeded into store | DB-backed (when scale/marketplace demands), entries + versions |

### Migration path: built-in → user/DB-backed

The registry is read through **one interface** (`listTemplates()`, `getTemplate(id)`) from v1. v1 implements it over the JS index; v4 adds a disk store and the interface returns the union; v6+ swaps the disk store for a DB behind the same interface. Because consumers (gallery, create-from-template, AI recommend) only touch the interface, swapping the backend is invisible to them. Built-in templates can be **seeded** into the store at first run, after which both kinds are uniform — exactly how `listBoards()` already unifies sites that happen to have a `board.json` (`storage.js`).

**Thumbnail strategy migration:** v1 `compile-render` on the fly → v5 render-once-and-cache (the `thumbnail.cache` field flips from `null` to a cached path/URL). The entry shape already carries the field, so no schema change.

---

## 5. Open questions / decisions deferred

1. **Vocabulary governance.** Who can add a controlled value, and how? (PR-reviewed for built-in; but user-saved templates in v4 may demand a value that doesn't exist yet — do we allow a "pending" free tag quarantine, or force-fit to the nearest value?) **Lean:** force-fit + a curator review queue; never silently accept free tags.
2. **`aspect` snapping tolerance.** What ratio delta maps to a bucket vs `custom`? (e.g. is 1920×1200 close enough to `16:9`?) Needs a chosen tolerance; affects auto-prefilter.
3. **Template ↔ board ↔ site identity.** A created board-backed site currently shares its id space with templates conceptually but not literally. Do user-saved templates dedupe against the board they came from, or fork a clean copy? **Lean:** fork a clean copy (templates are immutable seeds; editing the site never mutates the template).
4. **License model granularity.** A single `license` string vs structured terms (commercial use, attribution required, resale). Defer until v7 marketplace forces it.
5. **AI recommendation scoring weights.** Exact weight per facet (required > style > occasion?) is empirical — defer to v3 tuning with real briefs.
6. **Localization data model.** One template with per-locale value sets vs sibling templates linked by a shared key. Defer to the localization slice; depends on multi-page engine support landing first.
7. **Gallery for the production (client) surface?** v1 gallery is owner-only (`/studio` is `requireOwner`). Do clients ever pick templates, or only edit what the owner built? **Lean:** owner-only through v6; revisit if the marketplace (v7) opens self-serve template selection to clients.
