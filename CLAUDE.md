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
src/fetch.ts      relay access, TTL+LRU caches, NIP-50 search, feed queries
src/identity.ts   cert fingerprint -> bunker pairing store (JSON, mode 600)
src/nip46client.ts NIP-46 wrapper: per-op signer, hard timeouts everywhere
src/publish.ts    directory -> signed events; NIP-09 unpublish; NIP-40 expire
src/cli.ts        serve | publish | unpublish
```

New frontends plug in at the Content/MenuItem layer; don't put
protocol-specific rendering in the router.

## Key constraints

- **No long-lived relay subscriptions.** Reads are one-shot `querySync`;
  NIP-46 signing opens a subscription per operation and closes it
  straight after, always wrapped in a hard timeout (nostr-tools has
  none of its own and a signer awaiting a human hangs forever
  otherwise). nostr-tools is pinned to exactly 2.23.9.
- **No build step.** Runs directly on Node >= 24 type stripping, so
  `erasableSyntaxOnly`: no enums, no parameter properties, type-only
  imports. Tests are node:test, run with plain `node --test`.
- **The bridge never holds a user key.** Signing is always remote via
  NIP-46. Disk state is exactly: the Gemini TLS cert and
  `pairings.json` (cert fingerprint -> bunker binding, mode 600).
- **Gopher stays read-only.** Plaintext protocol, no auth; never accept
  a credential over it. All identity features are Gemini-only.
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
- Custodial anything. No nsec input, no key generation for users, no
  signing except by the user's own remote signer.
- DMs and zap wallets (would need NIP-44 decrypt loops and LNURL;
  revisit deliberately if ever).
