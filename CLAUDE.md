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
src/server.ts     TCP gopher frontend (read-only, always)
src/gemini.ts     TLS gemini frontend (/search is the input endpoint)
src/http.ts       HTTP frontend for lynx; loopback = operator, no login
src/html.ts       Content -> lynx-friendly HTML (no JS, real forms)
src/personal.ts   /me menu: loopback-only read+write over gopher
src/gopherclient.ts  gopher client for traditional gopherspace; nostr-aware
                  gophermap parsing (npub selectors and nostr: h-links
                  become native hole targets on every surface)
src/target.ts     universal client addressing: npub / nostr: entity /
                  gopher:// / bare host -> ClientTarget; proxy paths;
                  bridge urls with npub selectors resolve native
src/browse.ts     interactive terminal client: session, command parsing,
                  feed and home menus, readline loop (kept thin)
src/bookmarks.ts  bookmark store (JSON in the state dir)
src/virtual.ts    kind 0/1/30023 -> virtual hole documents
src/fetch.ts      relay access, TTL+LRU caches, NIP-50 search, feed queries;
                  NIP-65 outbox reads (author write relays) plus remembered
                  NIP-19 relay hints; PoolLike is injectable for tests
src/netguard.ts   SSRF guard for the gopher proxy: blocks loopback/private/
                  link-local ranges, resolves hostnames before connecting;
                  safeRelayUrls bounds untrusted relay hints
src/identity.ts   cert fingerprint -> bunker pairing store (JSON, mode 600)
src/nip46client.ts NIP-46 wrapper: per-op signer, hard timeouts everywhere
src/publish.ts    directory -> signed events; NIP-09 unpublish; NIP-40 expire
src/signing.ts    CLI signer resolution: BURROW_NSEC > BURROW_BUNKER > stored
src/commands.ts   CLI client: read, search, post, feed, pair, whoami
src/cliview.ts    Content -> terminal text (plain and numbered-link forms)
src/secretguard.ts blocks credential-shaped content before signing
src/cli.ts        argument parsing only; logic lives in commands.ts
```

Four surfaces, one router. The operator uses the CLI or lynx over HTTP
(loopback is trusted as them); visitors use HTTP with a session cookie
or Gemini with a client certificate; gopher is read-only for everyone.
Any new client feature lands in the CLI first and reuses the shared
Content/MenuItem layer, so no surface is second-class.

The HTTP frontend must stay JavaScript-free and work in lynx. If a
feature needs scripting, it does not belong here.

New frontends plug in at the Content/MenuItem layer; don't put
protocol-specific rendering in the router.

## Key constraints

- **No long-lived relay subscriptions.** Reads are one-shot `querySync`;
  NIP-46 signing opens a subscription per operation and closes it
  straight after, always wrapped in a hard timeout (nostr-tools has
  none of its own and a signer awaiting a human hangs forever
  otherwise). nostr-tools is pinned to exactly 2.23.9.
- **No build step in development.** Runs directly on Node >= 24 type
  stripping, so `erasableSyntaxOnly`: no enums, no parameter
  properties, type-only imports. Tests are node:test, run with plain
  `node --test`. Publishing is the one exception: Node refuses type
  stripping under node_modules, so `npm run build` compiles `dist/`
  via tsconfig.build.json (rewriteRelativeImportExtensions) and the
  npm bin points there. Releases go through forgesworn/anvil (OIDC
  trusted publishing; never npm publish from a workstation).
- **The bridge never holds a user key.** Signing is always remote via
  NIP-46. Disk state is exactly: the Gemini TLS cert and
  `pairings.json` (cert fingerprint -> bunker binding, mode 600).
- **Never accept a credential over gopher.** Plaintext, no auth. The
  `/me` menu is the one exception and only because it sends nothing:
  identity is the connection's origin (loopback). It must never be
  advertised or served to a non-loopback client.
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
