# Changelog

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

* interactive terminal browser (`burrow` or `burrow browse`): numbered
  links, back/up/reload, bookmarks, history, `$PAGER` for long text
* one client for both worlds: npubs, nostr: entities, `gopher://` urls
  and bare hostnames all navigate; type 7 searches prompt for a query
* nostr-aware gophermap parsing: links into a burrow bridge (npub
  selectors, `nostr:` urls) are followed natively through your own
  relays, on every surface
* `burrow read` and `burrow search` accept traditional gopherspace
  targets, including Veronica-2 one-shots
* `feed` as a navigable menu and `post` through a NIP-46 signer inside
  the interactive browser
* published to npm as `@forgesworn/burrow`; `npx @forgesworn/burrow`
  needs nothing but Node 24

## [0.1.0] - 2026-08-03

Unpublished development version: gopher-over-Nostr bridge and
publisher (kind 31436), virtual holes, Gemini and HTTP frontends,
NIP-46 identity, CLI client, personal `/me` gopher menu, gopherspace
proxy.
