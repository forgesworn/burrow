# Contributing to burrow

Thanks for looking. burrow is a small, deliberately boring codebase: a gopher
and Gemini bridge for Nostr, plus a terminal client. SPEC.md is the protocol
source of truth; CLAUDE.md sketches the architecture in one screen.

## Development

There is **no build step in development**. burrow runs directly on Node 24's
type stripping, so:

```sh
npm install
node src/cli.ts serve        # or: node src/cli.ts browse
npm test                     # node:test, no framework
npm run typecheck            # tsc --noEmit, strict
```

Because the source runs under type stripping (`erasableSyntaxOnly`), a few
TypeScript features are off limits: no enums, no parameter properties, and
imports of types must be `import type`. The one build (`npm run build`) exists
only for publishing, where Node refuses to strip types under `node_modules`.

nostr-tools is pinned to exactly `2.23.9` on purpose (a later idle-close
change breaks live subscriptions). Do not bump it without reading the pin.

## Conventions

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

## Non-goals

Gopher+, CGI/executable selectors, serving binaries or images, custodial key
handling of any kind, and DMs/zap wallets. See CLAUDE.md for the full list.

## Tests

Add a test with any behaviour change. The suite runs real gopher over TCP and
Gemini over TLS, with a structural `HoleStore` stub (`test/helpers.ts`) and no
network, so it stays fast and deterministic. Security-relevant behaviour
(credential guard, loopback trust, CSRF, injection) should have an explicit
assertion.
