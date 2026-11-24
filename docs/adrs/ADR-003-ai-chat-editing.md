# ADR-003 — AI chat editing: plain-English requests → Guardian-validated changes

- **Status:** Accepted
- **Date:** 2026-06-05
- **Context bucket:** production-app (external clients; calls a paid LLM provider)

## Context

The blueprint's EDITOR is "click inline **plus a chat box**." v0.1/v0.2 shipped
the click half; this ADR adds the plain-English half. The blueprint's single
load-bearing rule is **"the AI never writes code — it only proposes content
changes against the frozen template, and the Guardian validates every one."**
This ADR makes that rule structural, not aspirational.

## Decision

### The AI is a proposer, never a writer

`POST /api/sites/:id/chat` (gated by `requireSiteAccess`, same as human edits)
takes a plain-English `message`, asks the model to produce a structured set of
content-slot changes, and runs that set through **the exact same
`guardian(slots, changes)`** a human edit goes through (ADR-001). The model:

- can only return `{slot_id, value}` pairs against **existing** slot ids;
- never emits HTML/markup (the system prompt forbids it, and the Guardian
  rejects it regardless — `html_not_allowed`);
- cannot add/remove/reorder slots, change layout, or write code/template.

A hallucinated slot id → `unknown_slot` rejection. Markup → `html_not_allowed`.
An emptied required slot → `empty_required`. The Guardian is the security
boundary; the prompt is only a first-line nudge. **No model output is trusted
to be safe — it is validated.** Verified live: an AI proposal of `<b>Sale</b>`
is rejected and nothing is injected.

### Structured output, array-shaped

The model returns `{ reply: string, changes: [{slot_id, value}] }` via the
provider's JSON-schema structured-output mode. Changes are an **array**, not a
map, because slot ids are dynamic keys that a strict
`additionalProperties:false` schema can't enumerate. `toChangesMap()` folds the
array into the `{slotId: value}` map the Guardian expects.

### Providers — Anthropic default, OpenRouter fallback, mock for tests

Per the blueprint ("Support Anthropic and OpenRouter keys"):

- **Anthropic** (default) via the official `@anthropic-ai/sdk`, model
  `claude-opus-4-8` (override with `VELLUM_AI_MODEL`), `output_config.format`
  structured outputs. The SDK is the required path for a JS project.
- **OpenRouter** (OpenAI-compatible) via `fetch`, `response_format` json_schema.
- **mock** — the user message *is* the JSON proposal; deterministic, no network,
  no key. Powers the route tests (driving exact Guardian outcomes) and keyless
  local dev.

Provider resolves from `VELLUM_AI_PROVIDER`, else inferred from which API key is
present, else AI chat is **disabled** (the chat box is hidden and the endpoint
returns 503). Atelier's batch-governor is **not** in this path — these are
single interactive completions, not `messages.batches.create` calls.

### All-or-nothing application

If the Guardian rejects any proposed change, **none** are applied; the response
carries the model's `reply` plus the per-slot errors so the client sees why.
Accepted change sets are saved as a normal version (`AI: <message>`), so AI
edits are versioned and roll back exactly like human edits.

## Consequences / non-goals (v0.x)

- No conversation memory — each message is independent (stateless against the
  current content). Multi-turn chat is a later addition.
- No streaming — the editor shows "Thinking..." then the reply. Fine for a
  short structured response.
- No per-site or per-request API keys yet — one server-side provider key.
- No rate-limiting / spend cap on the endpoint. Single-operator host; revisit if
  exposed to many clients.
- Rich-HTML slots remain out of scope (ADR-001) — so does AI authoring of them.
