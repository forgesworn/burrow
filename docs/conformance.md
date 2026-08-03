# Gopherkind conformance fixture

`test/fixtures/kind31436-v1.json` is the language-neutral fixture for the
proposed kind `31436` grammar. It is included in the package contents as well
as kept in the source repository.

The fixture does not contain signed Nostr events. An implementation should do
its ordinary NIP-01 JSON, id and signature validation first, then use the
partial `event` objects here to test the gopherkind-specific layer. Test event
ids in replacement cases are ordering values rather than hashes of those
partial objects.

The top-level fields mean:

- `documents`: strict tag-cardinality and metadata cases. `meta` is the
  expected parsed metadata for a valid document.
- `paths`: path grammar and the URL path produced by encoding each segment
  exactly once.
- `distinctPaths`: pairs which MUST remain different coordinates.
- `kindmap`: complete input bodies and their ordered parsed records. Missing
  `link` means information text rather than a link with an empty target.
- `replacement`: all events are revisions of one coordinate. `winner` is the
  NIP-01 replacement winner before gopherkind validation and NIP-40 are
  applied; `visible` is the event left afterwards, or `null` when the
  coordinate is absent.
- `type0Wire`: the complete RFC 1436 response body after newline conversion,
  dot-stuffing and the final terminator.

An independent implementation passes the gate when it consumes this JSON
directly, agrees with every expected value, and records its implementation and
test command in the NIP submission evidence. Copying this repository's parser
or translating it line for line does not count as independent implementation.

The first independent implementation is
[`forgesworn/gopherkind-protocol-py`](https://github.com/forgesworn/gopherkind-protocol-py),
pinned in the submission evidence to the commit that passes fixture version 1.
