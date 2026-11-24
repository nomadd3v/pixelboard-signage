# ADR-002 — Auth model: owner key + per-site client passwords + sessions

- **Status:** Accepted
- **Date:** 2026-06-05
- **Context bucket:** production-app (this is an authz boundary; clients edit live sites)
- **Supersedes:** the "owner master key only" gate noted as deferred in ADR-001.

## Context

The blueprint's AUTH spec is **one owner master key + per-site client passwords**,
where "a client login only opens its own site." v0.1 shipped owner-key-only, so
Vellum was an operator tool, not client-handoff-ready. This ADR adds the client
authz layer and the session machinery both roles use in the browser.

## Decision

### Two roles, two trust levels

- **Owner** — holds `VELLUM_MASTER_KEY`. Can do everything: dashboard, ingest,
  set/clear any site's client password, edit/publish/rollback any site.
- **Client** — holds one site's password. Can do exactly one site: open its
  editor, preview (edit mode), edit, publish, view history, rollback. Nothing
  else — not the dashboard, not ingest, not another site, not password changes.

### Password storage — scrypt, per-site, separate file

Each protected site has `data/sites/<id>/auth.json` = `{ salt, hash, updatedAt }`
where `hash = scrypt(password, salt)` (Node built-in `crypto.scryptSync`,
N=16384). Plaintext is never stored. Verification is constant-time
(`timingSafeEqual`). `auth.json` is **separate from `site.json`** so password
material can never leak into `getSite`/`listSites` API responses — those expose
only a derived `protected: boolean`.

### Sessions — signed cookies, isolation enforced by token content

Login exchanges a credential for an **HMAC-signed token** cookie. The token
payload is `{ sid, role, exp }`; the cookie is HttpOnly, SameSite=Lax, Path=/.

- **Isolation is enforced by the token payload, not the cookie path.** A request
  to site B's routes is authorized only if a presented token has `role === "owner"`
  **or** (`role === "client"` **and** `sid === B`). A client's cookie for site A
  carries `sid: A`, so it is rejected on site B regardless of path. This is why
  the API (`/api/sites/:id/...`) and the page (`/sites/:id/...`) — two different
  path prefixes — share one isolation rule without fragile per-path cookies.
- Per-site cookie name `vsess_<siteId>` avoids clobbering if one browser holds
  several sessions; the owner cookie is `vsess_owner`.
- Signing secret is `VELLUM_SESSION_SECRET`; if unset, an ephemeral per-process
  secret is generated (sessions die on restart — logged loudly; fine for dev).
- The master key continues to work as an `x-vellum-key` header / `?key=` for
  curl + programmatic owner use; the owner cookie exists so the browser
  dashboard + editor work when a master key is set.

### Route authorization matrix

| Route | Owner | Client (own site) | Anonymous |
|---|---|---|---|
| `GET /`, `POST /api/sites` (ingest) | ✓ | ✗ | ✗ |
| `POST /api/sites/:id/client-password` | ✓ | ✗ | ✗ |
| `GET /sites/:id/edit`, `preview?mode=edit` | ✓ | ✓ | ✗ |
| `POST /api/sites/:id/edit`,`/publish`,`/rollback` | ✓ | ✓ | ✗ |
| `GET .../versions`, `.../snapshots` | ✓ | ✓ | ✗ |
| `GET /sites/:id/preview?mode=publish` | ✓ | ✓ | ✓ (shareable draft) |
| `GET /sites/:id/published/:snap` | ✓ | ✓ | ✓ (the live artifact) |
| `GET/POST /sites/:id/login`, `/logout` | — | — | ✓ (to obtain a session) |

Published snapshots and publish-mode preview stay public — they are the
client-facing artifact and a shareable draft. Everything that mutates or exposes
the *editing surface* requires a session.

## Consequences / non-goals (v0.2)

- No rate-limiting / lockout on the login endpoint yet (single-operator host;
  scrypt cost is the only brute-force speed bump). Noted, not built.
- No password-reset email flow — the owner re-sets a client password out of band.
- No CSRF tokens: SameSite=Lax + JSON-only mutating endpoints (which browsers
  won't cross-site-POST with a JSON content-type without a preflight) is the
  v0.2 stance. Revisit if a form-encoded mutating route is added.
