# FAQ

## Is this just a website with extra steps?

No. A website is served by a host you must keep paying for, and nothing about
the page proves who wrote it. A gopherkind document is a signed event: it can
be served by any bridge that can retrieve a copy, and the signature travels
with it. The reading experience is deliberately 1991, which is the point.

## Do I have to publish anything to have a hole?

No. Every npub is already a hole. A bridge generates `/profile.txt`, `/notes`,
`/replies`, `/mentions`, `/threads/<id>`, `/articles`, `/follows`, `/followers`
and `/feed.xml` from ordinary Nostr events. Point a client at any npub and
there is something to read. Authored kind 31436 documents shadow those paths,
so taking over your own hole is just publishing.

## Will my writing be there forever?

No one can promise that, and this project will not pretend otherwise. Relays
choose what to keep. What changes is that your documents are no longer tied to
one machine: any relay that holds a copy can supply it to any bridge. Publish
to relays you trust, keep a `gopherkind export` snapshot, and re-check
retrievability with `gopherkind inspect`.

## What happens if gopherkind.com disappears?

Your hole does not. The reference bridge is one route to relay-held events, not
the source of them. Run `gopherkind serve` yourself, or use anyone else's
bridge, and the same signed documents render at the same paths.

## Can I delete something?

`gopherkind unpublish` and `gopherkind delete` send NIP-09 deletion requests.
Relays are free to ignore them, and clients keep local caches, so treat
deletion as a request rather than a recall. If what you published contained a
secret, rotate the secret too. For material that should stop being served on
schedule, use `--expire` from its first publication: bridges must not serve an
expired event.

## Does the bridge ever hold my key?

Never. There is no nsec input, no key generation, no custody of any kind.
Signing happens in a NIP-46 remote signer you control or inside a NIP-07
browser extension. The bridge stores its own NIP-46 client key, a Gemini TLS
certificate, and a mode-600 `pairings.json` mapping certificate fingerprints to
bunker connections. A browser session can never borrow the bridge's signer.

## Is there a token, a coin, or a fee?

No. There is nothing to buy, nothing to stake, no premium tier and no
custody. The project is MIT-licensed and funded by
[donations](support.md), if at all.

## Why gopher rather than just Gemini?

Both, actually: the same documents are served over gopher and Gemini from one
router. Gopher is there because it is where the phlogs are, because clients
from three decades still work, and because its constraints are the reason it
never rotted. Gemini is there because Geminispace has readers and native client
certificates.

## Does any of it need JavaScript?

No. The HTTP frontend is plain HTML with real forms, aimed at lynx first.
Reading, search, NIP-46 pairing, posting and publishing all work with
JavaScript switched off. One same-origin script adds browser history to the
back link and enables NIP-07 browser extensions, and the page degrades cleanly
without it.

## Can I use my own relays?

Yes. Every command takes `--relay wss://...`, repeatable, which replaces the
defaults. Publishing also discovers your NIP-65 write relays and uses the union
of both, and reads follow an author's NIP-65 list so a hole published to
someone's own relays is found even when your bridge does not carry them.

## Can I put images or binaries in a hole?

No, deliberately. Item types 9, `g` and `I` are non-goals, along with Gopher+
and CGI selectors. Text and menus only. Link out to the web with an `h` item if
you need a picture.

## What about DMs and zap wallets?

Non-goals for now. They would need NIP-44 decrypt loops and LNURL handling, and
both deserve a deliberate decision rather than feature creep.

## Is kind 31436 a real NIP?

It is a proposal. The submission to `nostr-protocol/nips` is
[PR #2429](https://github.com/nostr-protocol/nips/pull/2429), unmerged at the
time of writing. [SPEC.md](../SPEC.md) is the source of truth for the format
and [the conformance guide](conformance.md) has a language-neutral fixture, so
another implementation can be checked against the same bytes.

## Is it production ready?

It is pre-1.0 software that runs a public bridge on three protocols, with a
test suite of nearly three hundred tests, enforced coverage thresholds, lint
and type gates in CI, SHA-pinned actions, a pinned base image, dependency
review and a documented security policy. Formats are backward-compatible within
the pre-1.0 series unless a release note says otherwise. Judge it on
[the changelog](../CHANGELOG.md) and the [operations guide](operations.md),
and run your own bridge if uptime matters to you.

## How do I run one for other people?

[The operations guide](operations.md) covers the reverse-proxy contract, the
container, state and backup, and the flags that decide who is trusted. The
short version: bind HTTP to loopback, put TLS in front, pass
`--no-local-trust`, and never expose port 8070 directly.

## How can I help?

Use it and say what broke. Publish a hole so there is something to read.
[CONTRIBUTING.md](../CONTRIBUTING.md) has the development loop, and
[support](support.md) has the funding side.
