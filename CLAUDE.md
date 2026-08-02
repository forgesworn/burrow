# CLAUDE.md -- burrow

## What this is

Gopherholes served from Nostr relays. Kind 31436 addressable events
hold documents; a stateless bridge serves them over gopher (RFC 1436)
and Gemini; virtual holes render any npub's profile/notes/articles
without publishing. SPEC.md is the protocol source of truth.

## Architecture

```
src/selector.ts   gopher selector / path -> Route
src/router.ts     Route -> protocol-neutral Content (authored beats virtual)
src/resolve.ts    burrowmap lines -> MenuItems with abstract link targets
src/render.ts     Content -> RFC 1436 wire (dot-stuffing, CRLF, info tails)
src/gemtext.ts    Content -> text/gemini
src/server.ts     TCP gopher frontend
src/gemini.ts     TLS gemini frontend (/search is the input endpoint)
src/virtual.ts    kind 0/1/30023 -> virtual hole documents
src/fetch.ts      relay access, TTL+LRU caches, NIP-50 search
src/publish.ts    directory -> signed events; NIP-09 unpublish; NIP-40 expire
src/cli.ts        serve | publish | unpublish
```

New frontends plug in at the Content/MenuItem layer; don't put
protocol-specific rendering in the router.

## Key constraints

- **No live relay subscriptions.** One-shot `querySync` only.
  nostr-tools is pinned to exactly 2.23.9 (later versions' idle-close
  behaviour kills long-lived subs; we avoid the class of bug entirely).
- **No build step.** Runs directly on Node >= 24 type stripping, so
  `erasableSyntaxOnly`: no enums, no parameter properties, type-only
  imports. Tests are node:test, run with plain `node --test`.
- **Bridge stays stateless.** Only disk state is the Gemini TLS cert.
  Anything else belongs in events or nowhere.
- Expired events (NIP-40) must never be served; filter on read.

## Conventions

- British English throughout. No em dashes.
- Commits: `type: description`, lowercase, imperative. No Co-Authored-By.
- Tag names per Nostr conventions: `expiration` (NIP-40), never `expiry`.
- Test fixtures sign with throwaway keys generated in-test; never
  commit an nsec, including in dry-run output pasted into docs.

## Non-goals

- Gopher+ and CGI/executable selectors.
- Serving binaries or images (types 9, g, I). Text and menus only.
- Accounts, auth, or write access through the bridge. Publishing is
  the CLI's job, signed locally.
