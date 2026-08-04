# Changelog

## 0.13.0 (2026-08-04)

### The case, served in its own medium

- serve one `/about` document on gopher, Gemini and HTTP, built from the same
  `Content` value, explaining what a gopherkind hole is and why a document
  should outlive its host; it needs no identity on any surface
- link it from every welcome page, and print the same page from the terminal
  with `gopherkind why` or the `why` command inside the interactive browser

### Command line

- add `gopherkind version` (`--version`, `-v`), read from the package manifest
  so the stripped source and the compiled entry always agree
- add `gopherkind help` (`--help`, `-h`) alongside the existing usage output

### Documentation

- add a documentation hub, a getting-started guide, an FAQ, a troubleshooting
  guide, the long-form case for gopher on Nostr, and a support page which says
  what funding buys and what it will never buy
- add a static home page under `site/`, published to GitHub Pages, with no
  JavaScript and no third-party requests
- document the `/about` route in the bridge profile, and ship the whole `docs`
  directory in the npm package

### Repository

- add issue and pull request templates, a code of conduct, and an
  `npm run check` shortcut for the full lint, typecheck and coverage gate

## 0.12.1 (2026-08-04)

### Fixed

- restore rich ANSI menu artwork when both its signing request and signed
  response fit the safe 20 KiB NIP-44 plaintext step, after eliminating the
  hardware signer's large-frame and response-copy memory spikes; encrypted
  envelopes remain below 32 KiB

## 0.12.0 (2026-08-04)

### Page management

- turn the signed-in `/me` page into an owner workspace which lists every
  authored page with direct view, edit and deletion-request actions
- prefill the publisher from the current signed event and lock its exact path
  while editing, so republishing updates the intended page in place
- add confirmed page deletion with both event and address references, hide
  revisions covered by a NIP-09 request, and allow a later republish to restore
  the same path
- send deletion requests to the author's NIP-65 write relays as well as the
  configured bridge relays
- expose edit, deletion and all-pages actions while viewing one of your own
  authored pages

## 0.11.3 (2026-08-04)

### Fixed

- cap remote signing requests at 1.5 KiB so NIP-44 padding and the signed
  response envelope stay below the practical 4 KiB transport boundary on
  constrained hardware signers
- preserve inert ANSI SGR colour in signed kindmap displays across Gopher and
  HTTP rendering, while removing it cleanly from Gemini and page metadata

## 0.11.2 (2026-08-04)

### Fixed

- keep both the encrypted NIP-46 request and its larger signed response within
  portable 32 KiB hardware-signer frames, instead of checking only the relay
  event ceiling

## 0.11.1 (2026-08-04)

### Fixed

- reject oversized relay-backed signing requests before invoking NIP-46 or a
  browser extension, with a clear prompt to reduce the page instead of waiting
  for a remote `signEvent` timeout

## 0.11.0 (2026-08-04)

### Navigation

- add a persistent `my hole` link to the signed-in HTTP navigation and account
  page, backed by a session-aware `/me` redirect to the viewer's npub
- make the signed-in home page say that an identity is connected and offer a
  direct route into its hole

### Appearance

- follow the browser's light or dark preference by default and add an explicit
  theme switch to every HTTP page
- remember the visitor's theme choice locally while retaining a JavaScript-free
  system-theme fallback

## 0.10.1 (2026-08-04)

### Publishing guidance

- explain text pages and menu pages by what they let someone make before
  introducing the kindmap protocol name
- show exact path examples and a copyable kindmap covering text, menu, search
  and website links in the JavaScript-free publishing form
- keep public retention and exact-path replacement explicit, then suggest the
  relevant next step after a text page or menu is published

### Gopher proxy

- render safe ANSI SGR colours and text attributes from traditional Gopher
  menus as inert HTML styling instead of printing terminal escape fragments
- discard cursor movement, terminal hyperlinks and other active control
  sequences while preserving the underlying text, artwork and links

## 0.10.0 (2026-08-03)

### Browser identity

- connect a standard NIP-07 `window.nostr` browser extension with a fresh,
  exact-URL NIP-98 event and an HttpOnly, same-site bridge session
- keep every post, document publication and deletion signature inside the
  extension, then verify its signature, session author, freshness and exact
  event template on the server before publishing
- retain NIP-65 relay selection and post-acceptance read-back for documents
  signed in the browser, without allowing a NIP-07 session to borrow the
  bridge's NIP-46 signer

### Navigation

- add a back link to every HTTP page which uses real browser history when
  available and remains an ordinary Home link in Lynx or on a direct visit
- keep approval and signing status visible while the extension is waiting for
  the user

## 0.9.2 (2026-08-03)

### Fixed

- keep the HTTP frontend within narrow mobile viewports by wrapping the
  signed-in navigation, sizing form controls to their container and wrapping
  long identifiers without changing preformatted document rendering

## 0.9.1 (2026-08-03)

### Fixed

- rate-limit visitors by one validated `X-Forwarded-For` address in explicit
  TLS proxy mode instead of treating the reverse proxy as one global visitor
- ignore missing, malformed and multi-hop forwarded addresses rather than
  accepting an ambiguous rate-limit identity

## 0.9.0 (2026-08-03)

### Public launch surface

- accept NIP-05 names in the HTTP opener and direct routes, then redirect to
  the bridge-portable canonical npub path
- add canonical, description and social-preview metadata to public HTTP pages
- add a JavaScript-free document publisher for signed-in HTTP sessions, with
  explicit exact-path replacement consent, credential scanning, NIP-65 relay
  discovery and post-publication read-back
- add an explicit TLS reverse-proxy mode which enables remote HTTP identity
  only with a canonical HTTPS origin and local operator trust disabled
- add `gopherkind inspect --json` for stable machine-readable relay and
  recovery checks

### Protocol status

- link the submitted kind `31436` proposal to nostr-protocol/nips PR 2429 and
  keep its unmerged status explicit

## 0.8.0 (2026-08-03)

### Recovery and relay truth

- add `gopherkind export` for lossless, editable snapshots whose manifest
  round-trips exact document paths, types and titles back through `publish`
- add `gopherkind inspect` to report current, stale, missing and unreachable
  document copies per configured, hinted and NIP-65 author relay
- replace absolute mirroring and durability claims with the actual boundary:
  holes are hostname-independent while a relay still retains a readable copy
- generate a correct IP subjectAltName for Gemini certificates when a public
  bridge is advertised by IP rather than DNS

### Reading

- add generated `/replies` and `/mentions` views plus `/threads/<event-id>`
  context pages using NIP-10 markers with the legacy unmarked fallback
- fetch note permalinks from the author's discovered relay set instead of only
  the bridge defaults
- add `/feed.xml`, a bridge-independent Atom feed of recent notes and articles
  using `nostr:` entry identifiers and the correct HTTP and Gemini media type

### Protocol

- publish the fixture-compatible independent Python implementation and record
  its exact commit, checksum, command and passing result in the NIP submission
  evidence

## 0.7.0 (2026-08-03)

### Security

- remove all local secret-key and `GOPHERKIND_NSEC` signing paths; publishing,
  posting and deletion now use NIP-46 exclusively
- validate that a remote signer returns the exact event template and author
  requested
- guard relay hints and public bunker relays at socket DNS lookup time,
  rejecting loopback, private, link-local and rebinding answers while retaining
  an explicit operator path for local relays
- bind every frontend to `127.0.0.1` by default and disable HTTP identity on a
  direct public bind

### Publishing

- publish and unpublish across the union of configured relays and the author's
  current NIP-65 write relays
- spread the author's existing signed relay list to those destinations and report
  per-relay document read-back after publication
- fail truthfully when every relay rejects a document or deletion request, or
  when an accepted document is not readable anywhere

### Operations and quality

- add `/healthz`, graceful SIGTERM/SIGINT shutdown, a non-root multi-stage
  Docker image and a deployment, backup and rollback guide
- enforce source-only line, branch and function coverage floors in CI, audit
  high-severity dependencies and dry-run the npm package on both supported Node
  versions
- support installation directly from GitHub by compiling the package bin in
  the `prepare` lifecycle while the first npm publication remains pending
- attach a checksummed package tarball to every GitHub release and keep npm
  publication explicitly disabled until an owner completes its one-time setup

## 0.6.0 (2026-08-03)

### Changed

- **renamed from burrow to gopherkind.** The npm package is now the
  unscoped `gopherkind`, the binary is `gopherkind`, the state directory is
  `~/.gopherkind` and the signer env vars are `GOPHERKIND_NSEC` and
  `GOPHERKIND_BUNKER`. No published version ever carried the old name, so
  there is nothing to migrate and no compatibility alias
- protocol vocabulary follows: a kind 31436 event is a **gopherkind
  document** and `type 1` content is a **kindmap** (was `burrowmap`). The
  wire format is unchanged; only the names in SPEC.md moved
- the proposed kind is now deliberately narrow: strict event metadata, exact
  path identity, deterministic kindmap parsing, and NIP-01 replacement before
  validation and NIP-40 expiry. A malformed or expired winner does not reveal
  an older revision
- bridge-only behaviour now lives in a separate profile. Article permalinks
  use naddr, time pagination uses timestamp-and-id cursors, and Gemini/HTTP
  search no longer shadows an authored `/search` document

### Added

- a language-neutral conformance fixture covering document validity, paths,
  kindmaps, replacement/expiry and RFC 1436 text rendering
- regression coverage for exact URL decoding, same-second pagination,
  addressable article replacement and line-oriented frontend injection

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
