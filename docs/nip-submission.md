# NIP submission pack (not yet submitted)

Everything needed to propose kind `31436` as a NIP, staged and ready. Nothing
here has been published. Do not run any of it without a decision to submit.

`SPEC.md` is the submission text: it already opens with the `draft` `optional`
line the nips repo expects, uses RFC 2119 throughout and carries test vectors.
It is deliberately **not** duplicated into this directory. A second copy of 340
lines of normative text would drift from the implementation within a release,
and the implementation is what the vectors test.

## Before submitting

- [ ] Run the `nostr-nip-review` skill over `SPEC.md` as a pre-flight.
- [ ] Confirm `31436` is still unclaimed in the nips repo kind table and in
      recent open PRs (kinds are first-come and collisions are silent).
- [ ] Decide the naming. `SPEC.md` heads "Gopherkind: gopherspace over Nostr"
      and calls a 31436 event a **gopherkind document**, which shares a name
      with the reference implementation. NIPs normally name the mechanism, not
      the software. Two coherent options, and this needs deciding *before*
      submission because it is the one thing that is expensive to change after:
      - **Keep it.** "gopherkind" reads as a compound of gopher + Nostr kind,
        not obviously as a product. Precedent exists (nsite).
      - **Neutralise it.** Title **"Gopherholes over Nostr"**, call the event a
        **gopherhole document**, keep `kindmap` for the grammar, and name
        gopherkind once as the reference implementation.
- [ ] Have a second implementation, or at least a second reader. The test
      vectors in the appendix exist so someone else can validate against this
      one; that is the strongest thing a kind proposal can show up with.

## The kind table row

The nips repo `README.md` has a kind table. The row to add, in numeric order
among the addressable (`30000`-`39999`) kinds:

```
| `31436`   | Gopherkind document (gopherhole node) | [XX](XX.md) |
```

## The PR

Title: `NIP-XX: Gopherholes over Nostr (kind 31436)`

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
> Reference implementation, test vectors and four interoperating frontends
> (gopher, Gemini, HTTP, CLI): https://github.com/forgesworn/gopherkind

Files: one new `XX.md` (the contents of `SPEC.md`) plus the README row.

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
