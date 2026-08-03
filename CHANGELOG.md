# Changelog

## 1.0.0 (2026-08-03)

### Changed

- **renamed from burrow to gopherkind.** The npm package is now the
  unscoped `gopherkind`, the binary is `gopherkind`, the state directory is
  `~/.gopherkind` and the signer env vars are `GOPHERKIND_NSEC` and
  `GOPHERKIND_BUNKER`. No published version ever carried the old name, so
  there is nothing to migrate and no compatibility alias
- protocol vocabulary follows: a kind 31436 event is a **gopherkind
  document** and `type 1` content is a **kindmap** (was `burrowmap`). The
  wire format is unchanged; only the names in SPEC.md moved

## 0.5.1 (2026-08-03)

### Bug Fixes

- sha-pin the ci actions so releases can publish



## 0.5.0 (2026-08-03)

A security and protocol pass. Anyone running a public bridge should take
this one: it closes an SSRF and a CRLF injection in the gopher proxy, and
CSRF and DNS-rebinding holes in the HTTP frontend.

### Fixed

- the loopback `/me` gopher menu: its links were npub-prefixed and 404d, and
  the post prompt silently ran a search instead of signing
- gopher menu and gemtext injection via unsanitised selectors, titles and
  profile names
- SSRF and CRLF injection through the `/gopher` HTTP proxy; it now refuses
  loopback/private/link-local targets and rejects CR/LF in the request
- HTTP frontend hardening: CSRF tokens and an Origin check on state-changing
  forms, `Host` validation so a DNS-rebound page cannot act as the operator,
  operator trust disabled on a non-loopback bind (reverse-proxy footgun),
  `Secure` cookie over TLS, security headers, fail-closed deletion
- NIP-40 expired events are now filtered on every read path
- `javascript:`/`data:` links from a hostile gopher server no longer reach
  the HTML frontend
- TLS key and `pairings.json` written mode 600 (atomically); gemini pending
  connections bounded; rate limiter keyed on the IPv6 /64
- gopher proxy preserves a selector's leading slash; replaceable events
  resolve by lowest id on a `created_at` tie

### Added

- NIP-65 outbox reads: a hole is found on the author's own write relays
- NIP-19 relay hints: an `nprofile`/`naddr` link's relays widen the read set
  for that author, validated and bounded (ws/wss only, no internal
  addresses, at most 4)
- single-item permalinks (`/notes/<id>`, `/articles/<d>`) served under
  `--no-virtual`
- NIP-31 `alt` tag on published documents
- `gopherkind announce`: a NIP-89 handler announcement (kind 31990) so Nostr
  clients know this bridge opens kind 31436
- pagination for the generated streams: `/notes/before/<unix>`,
  `/articles/before/<unix>`, `/follows/from/<n>`, `/followers/from/<n>`. A
  long follow list is paged rather than silently cut off at 200
- `/robots.txt` on the HTTP and Gemini frontends: the gopherspace proxy and
  the account paths are closed to crawlers, holes stay indexable
- biome for linting and formatting, enforced in CI (`npm run lint`)
- CI (typecheck + tests with coverage), SECURITY.md, CONTRIBUTING.md,
  dependabot, packaging metadata and `prepack`
- tests for `fetch.ts`, `nip46client.ts`, `netguard.ts`, the CLI, and the
  SPEC test vectors

## 0.4.0 (2026-08-03)

### Features

- open nip-05 names as holes (someone@example.org)

## 0.3.0 (2026-08-03)

### Features

- interactive browser, universal targets, nostr-aware gophermaps
- personal gopher menu, follows and followers, gopherspace proxy
- http frontend for lynx plus nip-09 delete
- full cli client (read, search, post, feed, pair)
- gemini client identity via client certs and nip-46 signing
- virtual holes, gemini frontend, richer links, hardening, unpublish
- gopher-over-nostr bridge and publisher, kind 31436

### Bug Fixes

- preserve ascii art alignment in menus
- refuse to sign or publish credential-shaped content



## [0.2.0] - 2026-08-03

First published release.

### Features

* interactive terminal browser (`gopherkind` or `gopherkind browse`): numbered
  links, back/up/reload, bookmarks, history, `$PAGER` for long text
* one client for both worlds: npubs, nostr: entities, `gopher://` urls
  and bare hostnames all navigate; type 7 searches prompt for a query
* nostr-aware gophermap parsing: links into a gopherkind bridge (npub
  selectors, `nostr:` urls) are followed natively through your own
  relays, on every surface
* `gopherkind read` and `gopherkind search` accept traditional gopherspace
  targets, including Veronica-2 one-shots
* `feed` as a navigable menu and `post` through a NIP-46 signer inside
  the interactive browser
* intended for npm as a scoped package; in the event no release under the
  old name ever reached the registry, and the package was later renamed to
  the unscoped `gopherkind`

## [0.1.0] - 2026-08-03

Unpublished development version: gopher-over-Nostr bridge and
publisher (kind 31436), virtual holes, Gemini and HTTP frontends,
NIP-46 identity, CLI client, personal `/me` gopher menu, gopherspace
proxy.
