# Support gopherkind

gopherkind is MIT-licensed, unfunded work under ForgeSworn. No company, no
token, no ads, no telemetry, no custody of anybody's key, and nothing to sell
you. It is paid for in evenings and in a small monthly hosting bill.

If you want the short version: **funding buys evenings, and evenings are the
only thing this project is made of.**

## Where to send it

- **Zap:** `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`
- **Lightning:** `profusemeat89@walletofsatoshi.com`
- **Ko-fi:** <https://ko-fi.com/brays>
- **Geyser:** <https://geyser.fund/project/forgesworn>
- **GitHub Sponsors:** [TheCryptoDonkey](https://github.com/sponsors/TheCryptoDonkey)

Any amount is genuinely useful. A few thousand sats says "this is worth
keeping". A recurring five a month says "keep the lights on", which is the
thing that actually changes what gets built.

## What it pays for

**The public bridge.** `gopherkind.com` serves gopher on 70, Gemini on 1965 and
HTTPS on 443, from a VPS with a domain and a certificate. It is the thing that
lets someone try this without installing anything, and it costs real money
every month whether or not anyone visits.

**Evenings.** Everything in [the changelog](../CHANGELOG.md) was written after
work. The features that take a run of consecutive evenings are the ones that
never happen without funding: the ones below.

## What funding unlocks next

Roughly in the order they matter, not promises with dates:

1. **Getting kind 31436 accepted.** The NIP proposal is
   [PR #2429](https://github.com/nostr-protocol/nips/pull/2429). Review costs
   patience and rewrites, and a ratified kind is what makes other clients
   implement it.
2. **More bridges, run by other people.** Packaging that makes a bridge a
   fifteen-minute job: published container images, a Homebrew formula, a
   systemd unit, one-command deployment.
3. **A second implementation.** [The conformance fixture](conformance.md)
   exists so that a Go or Rust bridge can be checked against the same bytes.
   Funding a reference test suite makes that a weekend for someone else.
4. **Archival tooling.** Retention is the honest weak point. Scheduled
   `inspect` runs, alerting when copy counts fall, and easy re-publication to
   fresh relays would turn "relays might keep it" into something you can
   actually monitor.
5. **Reader polish.** Better paging, better search, better ANSI handling for
   traditional gopherspace, and accessibility work on the HTML frontend.

## What it will never pay for

No token. No premium tier. No custodial key handling, ever. No analytics or
tracking on any frontend. No advertising in a menu. If any of that ever appears,
you have been given a fork of something else.

## Ways to help that cost nothing

- **Publish a hole.** Gopherspace grows by having something to read. Your npub
  already renders as one; `gopherkind publish` makes it yours.
- **Run a bridge.** [The operations guide](operations.md) is the whole job.
  More bridges is the entire point of moving holes off single hosts.
- **Review the NIP.** Informed criticism on
  [PR #2429](https://github.com/nostr-protocol/nips/pull/2429) is worth more
  than a donation.
- **Report what broke.** Especially in odd clients: VF-1, Lagrange, an actual
  1990s terminal, anything with a strange idea of a tab.
- **Tell one person.** The failure mode of a project like this is not
  criticism, it is silence.

## For grant makers

gopherkind is freedom-tech infrastructure: signed, host-independent documents
for a protocol that never had authorship, with no custody and no rent-seeking
anywhere in the design. It has a published specification, a language-neutral
conformance fixture, a live public deployment, an enforced test and coverage
gate, a documented security policy and a real threat model around key handling.
Contact details are in [SECURITY.md](../SECURITY.md); the maintainer is
reachable on Nostr at the npub above.
