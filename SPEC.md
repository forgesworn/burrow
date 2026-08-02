# Burrow: gopherspace over Nostr

`draft` `optional`

Kind `31436` (after RFC 1436, the Gopher protocol specification) defines a
**burrow document**: one node of a gopherhole, published as an addressable
Nostr event. A set of these events under one pubkey is a **hole**. Any
bridge can serve any hole to any RFC 1436 gopher client (and, optionally,
any Gemini client); holes have no home server and survive as long as any
relay carries them.

## Event format

```json
{
  "kind": 31436,
  "tags": [
    ["d", "/phlog/2026-08-02.txt"],
    ["type", "0"],
    ["title", "First post"]
  ],
  "content": "..."
}
```

- `d` (required): the document's absolute path within the hole. Always
  begins with `/`. The hole's root menu MUST use `/`. No `.` or `..`
  segments, no trailing slash (except the root itself).
- `type` (required): the gopher item type of this document. `0` (text
  file) or `1` (menu). Missing or unrecognised values are treated as `0`.
- `title` (optional): display name, used in search results.
- `expiration` (optional, NIP-40): bridges MUST NOT serve expired
  documents.

Content of a `type 0` document is plain UTF-8 text.

## Burrowmap (menu content)

Content of a `type 1` document is a **burrowmap**: a gophermap with the
host and port columns removed, because documents have no host. One item
per line:

```
<itemtype><display>\t<link>
```

Lines without a tab are info text (`i`); a leading `i` is optional there.
Extra tab-separated fields are ignored, so pasted classic gophermaps
degrade gracefully. `<link>` is one of:

| Link form | Meaning |
|---|---|
| `/path` | document in the same hole |
| `naddr1...` (kind 31436) | document in another hole |
| `naddr1...` (kind 30023) | a long-form article, served at `/articles/<d>` of its author's hole |
| `npub1...` / `nprofile1...` | another hole's root menu |
| `gopher://host[:port]/T/selector` | legacy gopherspace, served as-is |
| `http://...` or `https://...` | web link, served as an `h`/`URL:` item |

All Nostr entity links MAY carry a `nostr:` prefix. The item type of a
link line is whatever the author wrote; authors SHOULD use the type of
the target (`0` text, `1` menu, `7` search, `h` web).

A `7` line linking to `/` exposes full-text search over the hole.

## Bridge behaviour (gopher)

A bridge is a TCP server speaking RFC 1436 on one side and Nostr on the
other. Selector namespace:

| Selector | Serves |
|---|---|
| *(empty)* | bridge welcome menu |
| `/<npub>` | that hole's root menu (`d` = `/`) |
| `/<npub>/<path>` | document with `d` = `/<path>` |
| `/<npub>` + tab + query | full-text search over the hole (type 7) |

For each request the bridge fetches the newest matching event
(`kinds: [31436], authors: [pubkey], "#d": [path]`) from its relay set,
drops expired events, and renders:

- `type 1`: each burrowmap line becomes a full gophermap line. Same-hole
  and naddr links point at the bridge itself (`/<npub><path>` selectors);
  `gopher://` links keep their original host and port; web links become
  `h` items with `URL:` selectors. Info lines get the conventional dummy
  columns (`-`, `error.host`, `1`).
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

Authored documents always shadow virtual paths, so authors can take over
any of them (including `/`) simply by publishing.

## Search

Type 7 requests search the whole hole: authored documents plus (where
virtual holes are enabled) notes and articles. Bridges SHOULD query
NIP-50 `search` on their relays and merge those results with a
client-side match over fetched events, deduplicated by path.

## Gemini frontend

A bridge MAY additionally serve the same holes over the Gemini protocol.
URL mapping is identical to the selector namespace (`gemini://bridge/`,
`/<npub>`, `/<npub>/<path>`), with menus rendered as `text/gemini` (hole
links relative, `gopher://` links absolute) and text documents as
`text/plain`. `/<npub>/search` is reserved: without a query it answers
status `10` (input); with one it serves the search results menu.

## Unpublishing

Removing a document is a NIP-09 deletion request: kind 5 with an `e` tag
for the event, an `a` tag `31436:<pubkey>:<path>`, and a `k` tag
`31436`. Relays are free to ignore it; ephemeral content SHOULD use
NIP-40 `expiration` instead, which compliant bridges enforce.

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
