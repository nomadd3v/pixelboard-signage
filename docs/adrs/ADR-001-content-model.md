# ADR-001 — Content model: slot identity, template/content split, Guardian contract

- **Status:** Accepted
- **Date:** 2026-06-05
- **Context bucket:** production-app (external users = clients editing live sites)

## Context

Vellum is an AI-native client CMS built from the "Free Build Blueprint" (AI
Automations by Jack). A site is ingested once into a **frozen template** plus a
set of **editable content slots**; non-technical clients then self-serve edits
that publish to their live domain. The blueprint names a deterministic
validator — the **Guardian** — as the reason clients can't break the design.

Every one of the six subsystems (ingest, content model, Guardian, editor,
storage, publish) reads or writes the content model. A wrong decision here
reworks all of them, so this ADR pins the data-layer contracts **before** any
HTTP route is written. Three decisions matter most.

## Decision 1 — Slot identity is structural, not sequential

A slot's `id` is `sha256(domPath + "|" + field)`, truncated to 12 hex chars,
where `domPath` is the tag/`nth-of-type` chain from the document root to the
node and `field` is `text` | `src` | `href` | `alt`.

- **Stable across re-ingest.** Re-fetching the *same upstream source* yields the
  same paths → the same ids. This is the constraint that makes version history
  and rollback meaningful: a version is a map keyed by slot id, and the
  Guardian's "did this delete a section" check compares against ids, not
  positions.
- **Not content-derived.** Editing a slot's value must not change its id, so the
  original text is deliberately excluded from the hash.
- **Known limitation:** if the upstream page is *structurally* edited and
  re-ingested (a section added above shifts `nth-of-type`), downstream ids move.
  Re-ingest is therefore treated as "new template, migrate content by best
  effort," not "patch in place." Acceptable for v0.1; revisit if re-ingest of
  evolving sources becomes a workflow.

## Decision 2 — Template is frozen string + sentinel tokens; content is `{id: value}`

Ingest replaces each editable value in the parsed DOM with a **sentinel token**
`<id>` (Unicode private-use brackets — valid in HTML, never emitted
by cheerio's serializer, and forbidden in client content by the Guardian, so a
value can never forge a token). The serialized result is `template.html`
(frozen). Content is a flat `{ [slotId]: string }` map; the default is each
slot's captured original value.

- **One pure render function** `render({ template, slots, content, mode })`
  substitutes tokens → values and is shared by *both* the editor's live preview
  (`mode: "edit"`, slots wrapped/marked for click-to-edit) and the publish
  pipeline (`mode: "publish"`, clean output). Never written twice.
- **Attribute-level slots are first-class**, not just text nodes: `img@src`,
  `img@alt`, `a@href`. Attr slots get a `data-v-attr="<id>:<field>"` marker on
  their element so the editor can find them; the marker is stripped on publish.
- **Escaping is context-aware and on by default.** Text slots →
  HTML-text-escaped; attr slots → attribute-escaped. This closes the
  stored-XSS hole the blueprint ignores (the Guardian guards *design*, not
  *injection* — escaping does).

## Decision 3 — Slot values are plain text, escaped on render

The default and only slot type in v0.1 is **plain text**. The Guardian rejects
any value containing markup (`<tag`). Rich-HTML slots are a deliberately
deferred, explicitly-gated future slot type — not retrofittable cheaply, hence
called out now. URL-bearing attr slots (`src`/`href`) are validated against a
scheme allowlist (`http`, `https`, `mailto`, `tel`, relative, `data:image/*`
for `src`); `javascript:` and friends are rejected.

## The Guardian contract

`guardian(slots, changes) -> { ok: true } | { ok: false, errors: [...] }` — a
**pure, AI-free, unit-tested function**, built and tested in isolation before
the editor exists. It is the content security boundary. Reject codes:

| code | rule |
|---|---|
| `unknown_slot` | change targets an id absent from the manifest |
| `bad_type` | value is not a string |
| `forbidden_char` | value contains a sentinel/control char |
| `html_not_allowed` | plain-text slot value contains markup |
| `empty_required` | a slot whose original was non-empty is set to empty/whitespace |
| `unsafe_url` | url-bearing attr slot value uses a disallowed scheme |

The Guardian never mutates input and never calls a model. AI chat (a later,
optional subsystem) only ever proposes a `changes` map — which is then run
through this same Guardian. **The AI never writes code or template.**

## Out of scope for v0.1 (additive later)

Per-site client passwords / owner-master-key authz, AI chat, MongoDB storage
(filesystem first), multi-page sites (single page per site first; `site.json`
leaves room), Vercel deploy (publish writes immutable on-disk snapshots first).
