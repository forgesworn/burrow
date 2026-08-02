# Burrow: gopherspace over Nostr

`draft` `optional`

Kind `31436` (after RFC 1436, the Gopher protocol specification) defines a
**burrow document**: one node of a gopherhole, published as an addressable
Nostr event. A set of these events under one pubkey is a **hole**. Any
bridge can serve any hole to any RFC 1436 gopher client; holes have no home
server and survive as long as any relay carries them.

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
| `naddr1...` or `nostr:naddr1...` | document in another hole (kind MUST be 31436) |
| `gopher://host[:port]/T/selector` | legacy gopherspace, served as-is |
| `http://...` or `https://...` | web link, served as an `h`/`URL:` item |

The item type of a link line is whatever the author wrote; authors SHOULD
use the type of the target (`0` text, `1` menu, `7` search, `h` web).

A `7` line linking to `/` exposes full-text search over the hole.

## Bridge behaviour

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

Search MAY be served from NIP-50 relays where available; bridges MAY fall
back to fetching the hole's documents and matching client-side.

## Rationale

- Hole death is gopherspace's endemic disease: holes die when hobbyist
  boxes die. Events on relays have no box to die.
- Every document is signed; a hole is an identity (npub), not an address.
  Zaps, follows and web-of-trust compose for free.
- The bridge is stateless and interchangeable. Anyone can run one; all
  bridges serve all holes.
