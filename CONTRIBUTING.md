# Contributing to gopherkind

Thanks for looking. gopherkind is a small, deliberately boring codebase: a gopher
and Gemini bridge for Nostr, plus a terminal client. SPEC.md is the protocol
source of truth; CLAUDE.md sketches the architecture in one screen.

## Development

There is **no build step in development**. gopherkind runs directly on Node 24's
type stripping, so:

```sh
npm install
node src/cli.ts serve        # or: node src/cli.ts browse
npm test                     # node:test, no framework
npm run typecheck            # tsc --noEmit, strict
npm run lint                 # biome: format check + lint, also runs in CI
npm run format               # biome: apply the fixes
npm run coverage             # source-only coverage with enforced thresholds
npm run check                # all three gates, the same ones CI runs
```

[docs/index.md](docs/index.md) maps the rest of the documentation;
[docs/bridge-profile.md](docs/bridge-profile.md) is normative for application
behaviour and SPEC.md is normative for the event format.

Formatting is not a matter of taste here, it is whatever `npm run format`
produces: two spaces, single quotes, no semicolons, 100 columns. CI fails on
anything else. Import order is deliberately *not* enforced, so grouping stays
the author's call.

Because the source runs under type stripping (`erasableSyntaxOnly`), a few
TypeScript features are off limits: no enums, no parameter properties, and
imports of types must be `import type`. The build (`npm run build`) exists for
packaging, where Node refuses to strip types under `node_modules`. Git-based
package installs run it automatically through `prepare`; day-to-day source
development does not use the output.

nostr-tools is pinned to exactly `2.23.9` on purpose (a later idle-close
change breaks live subscriptions). Do not bump it without reading the pin.

## Conventions

- [The code of conduct](CODE_OF_CONDUCT.md) is short and applies here.
- British English throughout. No em dashes.
- Commits: `type: description`, lowercase, imperative. No `Co-Authored-By`.
- Nostr tag names follow the NIPs: `expiration` (NIP-40), never `expiry`.
- Never commit an nsec, including in dry-run output pasted into docs. Test
  fixtures sign with throwaway keys generated in the test.

## What lands where

Any new client feature lands in the CLI first and reuses the shared
`Content`/`MenuItem` layer, so no surface is second-class. New frontends plug
in at that layer; keep protocol-specific rendering out of the router. The HTTP
frontend must stay JavaScript-free and work in lynx.

## The project's own hole

`hole/` is gopherkind's hole. It is ordinary content: text files, kindmaps and
a `.gopherkind.json` manifest which fixes each document's exact path, type and
title. `test/hole.test.ts` guards it, so a dead same-hole link, a document too
large for a hardware signer, or a file the manifest forgot fails CI rather than
getting signed. Adding a file there means adding its manifest entry.

It belongs to the project's own identity, not to the maintainer's:

```text
npub18y4d9g6gjc8n6vkqdq0wphh5zzt6zna9tleyvhwzw063pvr5p4fsv05p0s
392ad2a348960f3d32c0681ee0def41097a14fa55ff2465dc273f510b0740d53
```

A hole belongs to a key, so publishing an authored `/` from a person's key
replaces that person's hole root with a product page on every bridge. The
project key is a deterministic leaf of the maintainer's key tree
([nsec-tree](https://github.com/forgesworn/nsec-tree)), so it is a separate
identity rather than a separate secret to look after.

Publishing it uses a separate state directory, because gopherkind stores one
signer pairing per state directory and the project key must not displace the
maintainer's:

```sh
# once: put the derived leaf behind a NIP-46 signer, then pair it.
# the flag goes after the subcommand, not before it.
gopherkind pair 'bunker://...' --state-dir ~/.gopherkind-project
gopherkind whoami --state-dir ~/.gopherkind-project   # expect npub18y4d9g6...

gopherkind publish hole --state-dir ~/.gopherkind-project
```

That is one signature per document, and `--dry-run` costs the same again
because it signs everything and only withholds the relay traffic. The hole is
nine documents, so on a signer with a physical confirmation button that is nine
presses, or eighteen if you dry-run first. `test/hole.test.ts` already checks
what a dry run would show you, so the dry run is for when you have changed the
shape of the hole rather than routine.

Note what is *not* in those steps: exporting an nsec. gopherkind refuses raw
secret keys, including its own project key. The leaf goes into a signer, and
the signer signs.

## Non-goals

Gopher+, CGI/executable selectors, serving binaries or images, custodial key
handling of any kind, and DMs/zap wallets. See CLAUDE.md for the full list.

## Tests

Add a test with any behaviour change. The suite runs real gopher over TCP and
Gemini over TLS, with a structural `HoleStore` stub (`test/helpers.ts`) and no
network, so it stays fast and deterministic. Security-relevant behaviour
(credential guard, loopback trust, CSRF, injection) should have an explicit
assertion.
