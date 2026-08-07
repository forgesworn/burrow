# NIP submission pack

The proposal was submitted to `nostr-protocol/nips` as
[PR #2429](https://github.com/nostr-protocol/nips/pull/2429) on 2026-08-03.
It has not been announced as a kind 30817 draft; review now happens on the PR.

`SPEC.md` is the submission text: it already opens with the `draft` `optional`
line the nips repo expects, uses RFC 2119 throughout and carries test vectors.
A portable superset of the vectors lives in
`test/fixtures/kind31436-v2.json`.
That fixture is also included in the package contents for a second client to
consume without copying this implementation. Its portable field definitions
and the evidence expected from that client are in `docs/conformance.md`.
Bridge behaviour is intentionally excluded and documented in
`docs/bridge-profile.md` instead.

## Before submitting

- [x] Re-confirmed immediately before submission on 2026-08-03 that `31436`
      was absent from the nips repo kind table and from GitHub's open/closed PR
      search.
- [x] Keep the protocol name **Gopherkind documents**. It describes the kind,
      while the reference implementation is named `gopherkind`.
- [x] Have a second client implement the event and kindmap grammar independently
      and run the published fixtures. Multiple frontends sharing this repository's
      parser and router still count as one implementation for this gate.

Independent-client evidence:

- implementation: `forgesworn/gopherkind-protocol-py` at
  `35e7d3440f01cb750ecfb11c312f97806cb72e02`;
- Python 3.14.2 locally, with CI on Python 3.11 and 3.14. It was implemented
  from `SPEC.md` and the fixture without importing, copying or mechanically
  translating this repository's TypeScript parser;
- fixture version 2, vendored unchanged with SHA-256
  `2a1dd98ee5cf1885c54d05568540487d366a014fbd64d6530a11a8fd18beb635`;
- command: `python3 -m unittest discover -s tests -v`;
- complete result: all five fixture sections passed, `Ran 5 tests in 0.001s`,
  `OK`;
- no disagreement with the fixture or specification was found.

Version 2 exists because version 1 could not see the one place the two
implementations actually disagreed. On 2026-08-04, a day after this PR was
opened, the reference implementation carved SGR colour out of its
control-character rule, so a menu record carrying an escape stayed valid and
kept its link while the specification said it became information text with the
controls replaced by spaces and no link. The Python client, written from the
text, had been doing the latter the whole time. Nothing caught it for three
days: the fixture had no escape case, so the gate designed to find exactly this
class of divergence was blind to it. Version 2 adds four such vectors, both
implementations agree on them, and the reference implementation was corrected
rather than the specification.

## The kind table row

The nips repo `README.md` has a kind table. The row to add, in numeric order
among the addressable (`30000`-`39999`) kinds:

```
| `31436`   | Gopherkind document | [XX](gopherkind.md) |
```

## The submitted PR

Title: `NIP-XX: Gopherkind documents (kind 31436)`

Body:

> Adds an addressable kind for one node of a gopherhole, so a hole is a set of
> signed events under a pubkey rather than a directory on a box that will
> eventually be turned off. Any bridge that can retrieve a copy can serve the
> hole to any RFC 1436 client; it survives as long as a relay the author writes
> to carries it.
>
> The kind carries its text inline rather than referencing blobs, which is the
> whole survivability claim, and adds gopher item-type semantics with menus as
> first-class documents. NIP-5A is the closest existing work; the spec's
> rationale sets out the three differences (inline text rather than Blossom
> blob hashes, one event per document rather than a path manifest, and gopher
> item types for clients with no HTML parser), along with why kind 30023 does
> not fit.
>
> Reference implementation, executable test vectors, and its gopher, Gemini,
> HTTP and CLI frontends: https://github.com/forgesworn/gopherkind

Files: one new descriptive `gopherkind.md` containing `SPEC.md`, plus the
README row. The bridge profile is application documentation and is not part
of the NIP PR.

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
