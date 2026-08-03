# NIP submission pack (not yet submitted)

This is the pre-flight pack for proposing kind `31436`. Nothing here has been
submitted or announced. The proposal is deliberately not ready to open until
the independent-client gate below is met.

`SPEC.md` is the submission text: it already opens with the `draft` `optional`
line the nips repo expects, uses RFC 2119 throughout and carries test vectors.
A portable superset of the vectors lives in
`test/fixtures/kind31436-v1.json`.
That fixture is also included in the package contents for a second client to
consume without copying this implementation. Its portable field definitions
and the evidence expected from that client are in `docs/conformance.md`.
Bridge behaviour is intentionally excluded and documented in
`docs/bridge-profile.md` instead.

## Before submitting

- [x] Confirmed on 2026-08-03 that `31436` is absent from the nips repo kind
      table and from open or closed PRs returned by GitHub search. Re-check
      immediately before submission because kinds are first-come.
- [x] Keep the protocol name **Gopherkind documents**. It describes the kind,
      while the reference implementation is named `gopherkind`.
- [ ] Have a second client implement the event and kindmap grammar independently
      and run the published fixtures. Multiple frontends sharing this repository's
      parser and router still count as one implementation for this gate.

Record the independent-client evidence here before opening the PR:

- implementation repository and exact commit;
- language/runtime and confirmation that the parser was not copied or
  mechanically translated from this implementation;
- fixture version, test command and complete passing output;
- any disagreement found, with the resulting specification or fixture change.

## The kind table row

The nips repo `README.md` has a kind table. The row to add, in numeric order
among the addressable (`30000`-`39999`) kinds:

```
| `31436`   | Gopherkind document (gopherhole node) | [XX](XX.md) |
```

## The PR

Title: `NIP-XX: Gopherkind documents (kind 31436)`

Body:

> Adds an addressable kind for one node of a gopherhole, so a hole is a set of
> signed events under a pubkey rather than a directory on a box that will
> eventually be turned off. Any bridge serves any hole to any RFC 1436 client;
> the hole survives as long as a relay the author writes to carries it.
>
> The kind carries its text inline rather than referencing blobs, which is the
> whole survivability claim, and adds gopher item-type semantics with menus as
> first-class documents. Rationale for not reusing nsite or kind 30023 is in
> the spec.
>
> Reference implementation, executable test vectors, and its gopher, Gemini,
> HTTP and CLI frontends: https://github.com/forgesworn/gopherkind

Files: one new `XX.md` containing `SPEC.md`, plus the README row. The bridge
profile is application documentation and is not part of the NIP PR.

## Announcing the draft

Once the PR is open, announce it as a kind 30817 draft NIP with
`bray nip-publish` (not the legacy nip-drafts script). That is a separate
decision from opening the PR: it puts the draft in front of people who will
comment on it, so open the PR first and let the text settle for a few days.

## Related, already shipped

`gopherkind announce` publishes the NIP-89 handler announcement (kind 31990) that
tells Nostr clients this bridge opens kind 31436. It is independent of the NIP
submission and can go out whenever a public bridge is running. It also has a
`--dry-run` that signs nothing:

```sh
gopherkind announce --hostname bridge.example --http-url https://bridge.example --dry-run
```
