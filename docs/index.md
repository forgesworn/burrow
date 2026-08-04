# gopherkind documentation

Gopherholes served from Nostr relays. Documents are signed events, so a hole
belongs to an npub rather than a hostname, and any bridge that can retrieve a
copy can serve it to a gopher client written in 1991.

New here? Read [why gopher on Nostr](why-gopher-on-nostr.md), then spend ten
minutes on [getting started](getting-started.md). The bridge also serves the
same argument at `/about` on gopher, Gemini and HTTP, and `gopherkind why`
prints it in the terminal.

## For readers and writers

| Document | What it covers |
|---|---|
| [Why gopher on Nostr](why-gopher-on-nostr.md) | The case, and the honest limits of it |
| [Getting started](getting-started.md) | Install, read, pair a signer, publish a hole, verify it |
| [FAQ](faq.md) | Retention, deletion, keys, tokens, what this is not |
| [Troubleshooting](troubleshooting.md) | Error messages and what to do about them |
| [Support](support.md) | What funding buys, and why it is worth yours |

## For bridge operators

| Document | What it covers |
|---|---|
| [Operations](operations.md) | Deployment, reverse proxy, container, state, backup, rollback |
| [Bridge profile](bridge-profile.md) | Normative application behaviour: routes, virtual holes, pagination, search, identity |
| [Releasing](releasing.md) | Release procedure and the registry gate |

## For implementers

| Document | What it covers |
|---|---|
| [SPEC.md](../SPEC.md) | Kind 31436: event format, exact paths, replacement, kindmap grammar |
| [Conformance](conformance.md) | The language-neutral fixture and its field definitions |
| [NIP submission](nip-submission.md) | The proposal to `nostr-protocol/nips` and its evidence |
| [llms.txt](../llms.txt) | Condensed implementation guide for tools and language models |

## For contributors

[CONTRIBUTING.md](../CONTRIBUTING.md) covers the development loop (no build
step, `node --test`, biome), the conventions, and what lands where.
[SECURITY.md](../SECURITY.md) covers reporting and the trust boundaries that
matter. [CHANGELOG.md](../CHANGELOG.md) records every release.

## The shape of the thing

```
                 relays (the author's, and yours)
                         |
                signed kind 31436 events
                         |
                    +----------+
                    |  bridge  |   one router, four frontends
                    +----------+
                    /    |    \    \
              gopher  gemini  http  terminal client
              (RFC     (TLS,  (lynx  (gopherkind
               1436)   certs)  first)  browse)
```

Reading needs no identity anywhere. Writing always goes through a remote
NIP-46 signer or a NIP-07 browser extension: the bridge never holds a user key.
