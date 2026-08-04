# Gopherkind bridge profile

This document defines the reference bridge's application behaviour. It is
separate from the proposed kind `31436` specification because none of these
features is required to publish or interpret a gopherkind document.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as defined in
RFC 2119 within this profile.

## Relay discovery

For author-scoped reads, a bridge SHOULD resolve the author's NIP-65 kind
`10002` relay list and query a bounded number of the author's write relays in
addition to its configured relays. It SHOULD also honour safe relay hints from
an `nprofile` or `naddr` followed through a menu.

Hints are untrusted. A bridge MUST accept only `ws:` or `wss:` relay URLs,
reject internal network ranges, impose a small per-author limit, and retain
its own relay set when hints are added. Address checks SHOULD happen during the
socket's DNS lookup so a validated hostname cannot rebind before connection.

A publisher SHOULD use the union of its configured relays and the author's
current NIP-65 write relays. It SHOULD publish the signed relay-list event to
that union and read documents back after relay acceptance, because an `OK`
response alone does not prove that a later reader can retrieve the event.

## Gopher selectors

| Selector | Result |
|---|---|
| empty | Bridge welcome menu |
| `/about` | Bridge-owned explanation of what a gopherkind hole is |
| `/<npub>` | Root document, `d` = `/` |
| `/<npub><path>` | The exact kind `31436` path |
| `/<npub>` followed by tab and query | Whole-hole search |

Selectors carry raw UTF-8 paths. The bridge MUST validate the path without
trimming, case-folding, Unicode-normalising, collapsing slashes or removing a
trailing slash. Gopher+ probes beginning `+` or `$` are ignored.

Type `1` documents are expanded to complete gophermap records. Same-author and
Nostr document links point back through the bridge. Legacy gopher links retain
their target host and port. External URLs become `h` items with `URL:`
selectors. Information records use conventional dummy columns.

Type `0` documents are emitted with CRLF line endings, dot-stuffing and a lone
`.` terminator as required by RFC 1436.

## Virtual documents

When no authored kind `31436` document matches, a bridge MAY generate these
views from ordinary Nostr events:

| Path | Generated from |
|---|---|
| `/` | Kind `0` profile and links to the views below |
| `/profile.txt` | Kind `0` profile as text |
| `/notes` | Recent top-level kind `1` notes |
| `/notes/<event-id>` | One kind `1` note |
| `/replies` | Kind `1` events which tag the owner and carry an `e` tag |
| `/mentions` | Kind `1` events which tag the owner without an `e` tag |
| `/threads/<event-id>` | A note, its marked or legacy ancestors, and available replies |
| `/articles` | NIP-23 kind `30023` articles |
| `/articles/<naddr>` | One NIP-23 article |
| `/feed.xml` | Atom feed of recent notes and articles using `nostr:` identifiers |
| `/follows` | The newest kind `3` contact list |
| `/followers` | Authors whose newest available kind `3` tags this pubkey |

An authored document always wins at the same path. Single-note and
single-article and thread links MAY remain available when generated index pages are
disabled.

Replies, mentions and thread replies are samples of the events carried by the
bridge's relay set; they are not complete global counts. A reply has an `e`
tag and a `p` tag for the hole owner. A mention has the `p` tag without an
`e` tag. Thread ancestry follows NIP-10 `root` and `reply` markers, with the
legacy first/last unmarked `e` convention as a fallback.

The Atom document SHOULD use Nostr URIs for feed, entry and alternate-link
identifiers so the feed does not acquire a dependency on the serving bridge's
hostname. HTTP SHOULD return `application/atom+xml`; other text-oriented
frontends MAY expose the same XML bytes as a text document.

Article permalinks use an `naddr` as one path segment. They MUST NOT interpolate
the article's free-form `d` directly into a path, because it may contain `/`
or collide with a pagination route. The decoded naddr MUST be kind `30023` and
its pubkey MUST match the hole owner.

## Pagination

Time-ordered pages use a composite cursor containing the last event's
`created_at` and id:

```text
/notes/before/<unix>/<event-id>
/replies/before/<unix>/<event-id>
/mentions/before/<unix>/<event-id>
/articles/before/<unix>/<event-id>
```

Events are ordered by descending `created_at`, then ascending id. The next
page begins strictly after the cursor in that ordering. Implementations MUST
NOT discard every other event sharing the cursor's second.

For an addressable event stream such as kind `30023`, NIP-01 replacement
selection happens before the cursor is applied. A cursor-bounded relay query
can expose an older revision after excluding its winner; a bridge MUST verify
candidate coordinates without that cursor and MUST NOT resurrect the older
revision.

People lists use `/follows/from/<n>` and `/followers/from/<n>`. A bridge MUST
resolve display names, sort the complete list by display name with pubkey as a
tie-breaker, and only then apply the offset. This keeps membership stable
between pages for a fixed relay snapshot.

## Search

A type `7` gopher request searches authored documents and, when enabled,
virtual notes and articles. A bridge SHOULD merge NIP-50 results with local
matching over events it has fetched and deduplicate the output by target.

Gemini and HTTP expose search outside the authored hole namespace:

```text
/_gopherkind/search/<npub>
```

The endpoint asks for or accepts a query and returns the same search result
menu. `/<npub>/search` remains an ordinary authored document path and MUST NOT
be intercepted by a search frontend.

## Gemini and HTTP

A Gemini or HTTP frontend maps `/<npub><path>` to the same document as the
gopher selector. Each UTF-8 path segment is percent-encoded once in generated
links and decoded once on input. A literal percent sign is therefore encoded
as `%25` and is not confused with an existing escape.

A bridge SHOULD explain itself in its own medium. The reference bridge serves
one `/about` document, built from the same `Content` value on every frontend,
and links it from each welcome page. It belongs to the bridge namespace, not to
a hole, and MUST NOT require identity: a reader who has never heard of Nostr is
exactly the reader it is for.

An HTTP frontend MAY accept a NIP-05 identifier as an entry point. After
resolution it SHOULD redirect to `/<npub><path>` rather than treating the
mutable name as document identity. When a bridge has a public HTTPS origin,
authored and virtual pages SHOULD expose that npub path as their canonical URL
and MAY emit equivalent social-preview metadata.

Menus become gemtext or plain HTML, and type `0` documents remain plain text.
An HTTP renderer MAY translate ANSI Select Graphic Rendition sequences in
traditional Gopher content into inert inline styling. It MUST discard other
terminal controls rather than exposing cursor movement, terminal hyperlinks
or clipboard commands as active browser behaviour.
Frontends SHOULD serve a robots policy which prevents a bridge's proxy and
account routes from turning into a crawler gateway while allowing authored
documents to be indexed.

## Identity features

A Gemini frontend MAY bind a client certificate fingerprint to a NIP-46
remote signer. An HTTP frontend MAY provide an equivalent NIP-46 session or
establish a NIP-07 session by verifying a fresh, exact-URL NIP-98 event. It
MUST refuse replay and MUST verify the signature, session author and exact
event template again for every browser-signed write. A NIP-07 session MUST NOT
fall back to a bridge-side signer. The bridge holds only its own NIP-46 client
key and MUST never request or store the user's secret key.

Server-mediated signer requests MUST have hard timeouts and short-lived
subscriptions. A browser SHOULD show a pending message while its extension
awaits approval. Pair, NIP-07 connect, post, publish, feed and unpair routes
belong to the bridge's reserved application namespace, not to a hole. A
document publishing form MUST make exact-path replacement explicit before
asking the signer to sign. It SHOULD use the same NIP-65 relay destinations
and post-acceptance read-back as a directory publisher, and MUST NOT claim
success when the document cannot be retrieved from any destination.
The form SHOULD describe text and menu pages by what someone can make before
introducing the kindmap protocol name. It SHOULD provide the kindmap line
format and a working example, explain that menu links do not publish their
same-hole destinations, and keep public relay retention explicit.

NIP-07 MAY be a progressive enhancement, but the underlying HTTP pages SHOULD
remain readable and the NIP-46 path usable without JavaScript.

A loopback-only gopher menu MAY offer personal actions where identity derives
from the connection origin. It MUST NOT be advertised or served to a remote
client, and destructive actions SHOULD require explicit confirmation.

## Proxy security

The bridge MUST NOT accept credentials over gopher. A proxy for arbitrary
`gopher://` links SHOULD reject loopback, private and link-local destinations
and MUST NOT pass CR or LF from a client into an upstream request line.
