# Burrow: gopherspace over Nostr

`draft` `optional`

Kind `31436` (after RFC 1436, the Gopher protocol specification) defines a
**burrow document**: one node of a gopherhole, published as an addressable
Nostr event. A set of these events under one pubkey is a **hole**. Any
bridge can serve any hole to any RFC 1436 gopher client (and, optionally,
any Gemini client); holes have no home server and survive as long as any
relay the author writes to carries them.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used per
RFC 2119.

## Event format

```json
{
  "kind": 31436,
  "tags": [
    ["d", "/phlog/2026-08-02.txt"],
    ["type", "0"],
    ["title", "First post"],
    ["alt", "gopherhole document at /phlog/2026-08-02.txt"]
  ],
  "content": "..."
}
```

- `d` (required): the document's absolute path within the hole. Grammar and
  normalisation are specified under **Paths** below. The hole's root menu
  MUST use `/`.
- `type` (required): the gopher item type of this document, `0` (text file)
  or `1` (menu). Publishers MUST include it. Bridges MUST treat a missing or
  unrecognised value as `0`. `type` is a full tag name rather than a
  single-letter indexed tag because it is never used in a relay filter.
- `title` (optional): display name, used in menus and search results. Same
  character restrictions as a path segment (no control characters).
- `alt` (optional, NIP-31): SHOULD be present so generic Nostr clients that
  do not understand kind 31436 can render a fallback.
- `expiration` (optional, NIP-40): see **Replacement and expiry** below.

Content of a `type 0` document is plain UTF-8 text. Publishers SHOULD keep a
single event under a relay's size limit (commonly 64-256 KB); a document
larger than a bridge's relays accept will simply not be served.

### Paths

A path is `/`, or one or more segments each preceded by `/`. Each segment:

- is non-empty (no `//`), and is not `.` or `..`;
- contains any UTF-8 **except** `/` and control characters
  (U+0000-U+001F and U+007F).

Paths are case-sensitive and compared byte for byte; authors SHOULD use NFC
and lower case. There is no trailing slash except the root itself. Because a
gopher selector is `/<npub><path>` and RFC 1436 recommends selectors of at
most 255 bytes, a path SHOULD be at most 190 bytes.

`d` stores the raw, unencoded path. A gopher bridge carries it in the
selector as raw bytes; a Gemini bridge percent-encodes it in the URL and
decodes it on receipt. So `/a b` and `/a%20b` denote the **same** document.

Bridges MUST NOT serve, list or link a document whose `d` or `title`
contains a control character; such an event is treated as absent. This
prevents a hostile event from injecting extra records into a gopher menu or
`=>` links into gemtext.

### Replacement and expiry

Kind 31436 is addressable: the newest event for a given `(pubkey, d)` is the
document. On equal `created_at`, the event with the lowest id wins (NIP-01),
so every bridge resolves the same one.

A bridge MUST NOT serve an expired event (NIP-40). If the newest event at a
path has expired, the bridge MUST behave as though it does not exist; an
older, unexpired event at that path then becomes the document again (this
mirrors a NIP-40 relay deleting the expired event). Authors who want a
document to vanish rather than revert MUST publish every revision with the
`expiration`, or NIP-09-delete the older revisions.

## Burrowmap (menu content)

Content of a `type 1` document is a **burrowmap**: a gophermap with the
host and port columns removed, because documents have no host. One item
per line:

```
<itemtype><display>\t<link>
```

Lines without a tab are info text (`i`); a leading `i` is optional there.
Extra tab-separated fields are ignored. Note that a pasted classic gophermap
does not fully degrade: its selectors are reinterpreted as paths in *this*
hole, so lines that pointed at other hosts must be rewritten as full
`gopher://` URLs, and a selector without a leading `/` becomes info text.
`<link>` is one of:

| Link form | Meaning |
|---|---|
| `/path` | document in the same hole |
| `naddr1...` (kind 31436) | document in another hole |
| `naddr1...` (kind 30023) | a long-form article, served at `/articles/<d>` of its author's hole |
| `npub1...` / `nprofile1...` | another hole's root menu |
| `gopher://host[:port]/T/selector` | legacy gopherspace, served as-is |
| `http://...` or `https://...` | web link, served as an `h`/`URL:` item |

All Nostr entity links MAY carry a `nostr:` prefix. Bridges SHOULD use the
relay hints carried in an `nprofile` or `naddr` when fetching the linked
hole or document (see **Relay discovery**). The item type of a link line is
whatever the author wrote; authors SHOULD use the type of the target (`0`
text, `1` menu, `7` search, `h` web), and a bridge MUST emit that type
unchanged.

A `7` line linking to `/` exposes full-text search over the hole. The path
of a same-hole `7` link is currently ignored: every hole search is
whole-hole. Non-`/` paths on a `7` line are reserved for future scoping.

Only `http:`, `https:`, `gopher:`, `gemini:` and `nostr:` are valid link
schemes; a bridge MUST NOT render any other scheme (e.g. `javascript:` or
`data:`) as a link.

## Relay discovery

A hole's events live on the relays the author writes to, which a bridge may
not carry. A bridge SHOULD implement NIP-65 outbox reads: resolve the hole
owner's kind 10002 relay list, and include a bounded number of the owner's
write relays (e.g. up to 4) when querying that hole's events, falling back
to the bridge's own relay set when no list is found. A bridge that queries
only its own relays will serve an empty or virtual hole for any author it
does not share a relay with.

## Bridge behaviour (gopher)

A bridge is a TCP server speaking RFC 1436 on one side and Nostr on the
other. Selector namespace:

| Selector | Serves |
|---|---|
| *(empty)* | bridge welcome menu |
| `/<npub>` | that hole's root menu (`d` = `/`) |
| `/<npub>/<path>` | document with `d` = `/<path>` |
| `/<npub>` + tab + query | full-text search over the hole (type 7) |

Gopher+ is not supported; a bridge MUST ignore trailing probe fields
(a query beginning `+` or `$`).

For each request the bridge fetches the newest matching non-expired event
and renders:

- `type 1`: each burrowmap line becomes a full gophermap line. Same-hole
  and naddr links point at the bridge itself (`/<npub><path>` selectors);
  `gopher://` links keep their original host and port; web links become
  `h` items with `URL:` selectors. Info lines get the conventional dummy
  columns (`-`, `error.host`, `1`). A bridge MUST neutralise tab and CR/LF
  in every emitted field.
- `type 0`: content is emitted CRLF-terminated, dot-stuffed, ending with
  a lone `.` line, per RFC 1436.

## Virtual holes

Every npub is a hole, whether or not it ever published a kind 31436
event. When no authored document matches a path, bridges SHOULD serve
these reserved paths generated from the events every Nostr user already
has:

| Path | Generated from |
|---|---|
| `/` | kind 0 profile: name, about, links to the paths below |
| `/profile.txt` | kind 0 profile as plain text |
| `/notes` | menu of recent top-level kind 1 notes |
| `/notes/<event-id>` | one note as plain text |
| `/articles` | menu of NIP-23 (kind 30023) long-form articles |
| `/articles/<d>` | one article as plain text |
| `/follows` | kind 3 contacts, each linking to that pubkey's hole |
| `/followers` | authors of kind 3 events tagging this pubkey |

`/followers` is necessarily a sample: relays only know the contact lists
they carry, and a carried list may be stale. Bridges SHOULD cap both lists
and say so when they truncate. NIP-05 identifiers in a profile SHOULD be
labelled unverified unless the bridge has verified them.

The single-item permalinks `/notes/<event-id>` and `/articles/<d>` refer to
events that exist regardless of the generated hole, so a bridge SHOULD serve
them whenever the underlying event exists, even if it has otherwise disabled
virtual holes. Disabling virtual holes turns off only the generated index
pages (root, profile, notes, articles, follows, followers).

Authored documents always shadow virtual paths, so authors can take over
any of them (including `/`) simply by publishing.

## Search

Type 7 requests search the whole hole: authored documents plus (where
virtual holes are enabled) notes and articles. Bridges SHOULD query
NIP-50 `search` on their relays and merge those results with a
client-side match over fetched events, deduplicated by path.

## Gemini frontend (informative)

A bridge MAY additionally serve the same holes over the Gemini protocol.
URL mapping is identical to the selector namespace (`gemini://bridge/`,
`/<npub>`, `/<npub>/<path>`), with menus rendered as `text/gemini` (hole
links relative and percent-encoded, `gopher://` links absolute) and text
documents as `text/plain`. `/<npub>/search` is reserved: without a query it
answers status `10` (input); with one it serves the search results menu.
Authors SHOULD NOT publish a document at `/search`, which the reserved
endpoint shadows over Gemini.

A Gemini request URL MUST NOT exceed 1024 bytes, so a note submitted through
the status 10 flow is limited to a few hundred characters once percent-
encoded, not a full kilobyte of text.

## Identity (Gemini only, informative)

Bridges MAY offer a signed-in client over Gemini using client
certificates as sessions. The certificate's SHA-256 fingerprint is
bound to a NIP-46 bunker; the user's key never exists on the bridge,
which holds only its own per-pairing client key for talking to the
bunker.

| Endpoint | Behaviour |
|---|---|
| `/account` | status 60 without a cert; pairing status and actions with one |
| `/pair` | status 10 input; accepts a `bunker://` URI or NIP-05 bunker address |
| `/pair/connect` | shows a bridge-generated `nostrconnect://` URI for cross-device approval |
| `/pair/status` | polls the pending cross-device connection |
| `/post` | status 10 input; builds a kind 1 event, has the bunker sign it, publishes |
| `/feed` | recent top-level notes from the user's kind 3 follows, as a menu |
| `/unpair` | removes the certificate binding |

A bridge MAY likewise offer a personal menu to loopback gopher clients under
a reserved prefix (`/me` here), where identity is the connection's origin
rather than anything transmitted. Such a menu MUST NOT be advertised or
served to a non-loopback client, and destructive actions SHOULD require a
typed confirmation word.

## Unpublishing

Removing a document is a NIP-09 deletion request: kind 5 with an `e` tag
for the event, an `a` tag `31436:<pubkey>:<path>`, and a `k` tag
`31436`. Relays are free to ignore it; ephemeral content SHOULD use
NIP-40 `expiration` instead, which compliant bridges enforce.

## Security considerations

- Gopher is plaintext with no authentication, so a bridge MUST NOT accept
  any credential over it; anything sent would be public. The loopback
  personal menu is the sole exception, and only because it transmits no
  credential.
- Every NIP-46 signer conversation MUST be bounded by a timeout, and SHOULD
  use a short-lived subscription per operation rather than a persistent one,
  so a powered-off signer cannot wedge a request.
- `d` and `title` are attacker-controlled; bridges MUST reject control
  characters in them (see **Paths**) so they cannot forge wire records.
- A bridge that proxies arbitrary `gopher://` targets on behalf of a remote
  client SHOULD refuse loopback, private and link-local destinations, and
  MUST NOT pass a CR or LF from a client into a gopher request line.

## Rationale

- Hole death is gopherspace's endemic disease: holes die when hobbyist
  boxes die. Events on relays have no box to die.
- Every document is signed; a hole is an identity (npub), not an address.
  Zaps, follows and web-of-trust compose for free.
- The bridge is stateless and interchangeable. Anyone can run one; all
  bridges serve all holes.
- Virtual holes bootstrap content: the day a bridge comes up, every
  Nostr profile, phlog-shaped note stream and long-form article is
  already in gopherspace.

### Why a new kind, not an existing one

- **Why not nsite?** The nsite family (static websites over Nostr) has the
  same shape - a pubkey-owned tree of addressable events keyed by an
  absolute path - but its events carry Blossom blob hashes and deliver
  arbitrary binary assets over HTTP. A burrow document carries its UTF-8
  text inline, so a whole hole is relay-resident with no Blossom dependency,
  which is the entire survivability claim; it adds gopher item-type
  semantics and treats menus as first-class documents. The two compose: a
  burrowmap `h` line can point at an nsite.
- **Why not kind 30023 with a tag?** Markdown articles and gophermaps are
  different content grammars, and text or menus at arbitrary paths are not
  articles. burrow reuses 30023 for what it is (long-form articles under
  `/articles`) rather than overloading it.

Binary content (images, downloads) is deliberately out of scope: it is
delegated to nsite/Blossom or to legacy `gopher://` links, keeping a hole
fully relay-resident.

## Appendix: test vectors

Selector to route:

| Selector | Route |
|---|---|
| *(empty)* | welcome |
| `/npub1.../about.txt` | doc, path `/about.txt` |
| `/npub1..` + tab + `hay` | search, query `hay` |
| `/npub1../..` | error (rejected: `..` segment) |

Burrowmap line to gopher wire (owner npub `N`, bridge `b.test:70`):

| Burrowmap line | Wire line |
|---|---|
| `0About\t/about.txt` | `0About\t/N/about.txt\tb.test\t70` |
| `1Home\t/` | `1Home\t/N\tb.test\t70` |
| plain `hello` | `ihello\t-\terror.host\t1` |
| `hSite\thttps://example.com` | `hSite\tURL:https://example.com\tb.test\t70` |

A `type 0` body `"hello\n.hidden\n"` renders on the wire as
`hello\r\n..hidden\r\n.\r\n` (dot-stuffed, dot-terminated).
