# Why gopher on Nostr

The short version is served by every bridge at `/about`, and by
`gopherkind why` in your terminal. This is the long version.

## Holes die

Gopherspace has one endemic disease. The hobby box behind your favourite phlog
loses power. A domain lapses. A university closes an alumni account. A friend
who ran a hole for fifteen years stops paying for a VPS, and fifteen years of
writing stop existing, all at once, with no forwarding address.

This is not carelessness. It is structural. In RFC 1436 a hole is a host. The
protocol has no notion of an author, so there is nothing to survive the
hostname, and nothing in the wire format that could prove who wrote a document
even while the host is up. Copy a phlog to another server and it is just
somebody's file: identical bytes, no provenance.

The web solved neither problem. It made the first one worse by adding a
certificate authority and a registrar to the list of things that can end your
writing, and it never solved the second at all.

## What gopher got right

Cameron Kaiser's essay on why gopher is still relevant, which you can read
right now with

```sh
gopherkind read gopher://gopher.floodgap.com/0/gopher/relevance.txt
```

lands on one idea: gopher divorces interface from information. Every hole is
menus and text, navigated identically, rendered by anything with a TCP stack.
There is no layout to fight, no fonts to load, no cookie banner, no consent
dialog, no infinite scroll, no engagement surface, no analytics. A site stands
on the strength of what it says.

That is a rare property and it is worth conserving. It is also why a protocol
from 1991 still has readers: the format never rotted, because there was almost
nothing in it to rot.

## What Nostr got right, and wrong

Nostr's identity is a keypair. Documents are signed events. An author can place
copies on any number of relays, and no relay is privileged. That is precisely
the shape of the two things gopher lacks: authorship that travels with the
document, and content that is not pinned to one host.

What Nostr does badly is reading. Its clients are timelines, built for the
scroll. Long-form writing is buried an hour after it is posted, structure is
someone else's problem, and the interface competes with the content for
attention exactly as hard as the web does.

## The trade

Kind 31436 (named for the RFC) is a gopher document as a signed, addressable
Nostr event. The `d` tag is the path. The `type` tag is the gopher item type.
Menu content is a kindmap: a gophermap with the host and port columns removed,
because the document no longer has a host.

Gopher gets:

- **Documents that outlive one machine.** Lose the box and another bridge
  serves the same signed events from relays that still hold them.
- **Provable authorship.** The signature travels with the text. A copy served
  by a stranger is still verifiably yours.
- **Editing without dead links.** Addressable replacement means revising a page
  keeps its address. Nothing to redirect, nothing to invalidate.
- **A whole new population.** Every npub is already a hole: profile, notes,
  articles, follows and followers render as menus and text with nothing
  published at all. Gopherspace grows by the entire Nostr userbase overnight,
  and taking over your own hole is just publishing.

Nostr gets:

- **A reading room.** Structure is mandatory, nothing on the page is bidding
  for your attention, and a document stays where you left it.
- **Clients it never had.** lynx, VF-1, Lagrange, an Amiga, a terminal on a
  machine that will never run a modern browser.
- **Long-form that does not scroll away.** A menu is not a feed. It does not
  reorder itself while you read.

Kaiser argued that gopher and the web should coexist. Add Nostr and all three
read the same documents, while the writing outlives the box it was typed on.

## What it feels like

```sh
gopherkind read npub1...            # someone's hole, authored or generated
gopherkind read npub1.../follows    # walk the social graph as menus
lynx gopher://your-bridge/1/npub1...
```

A menu from Floodgap and a menu from an npub are the same object to the client.
A traditional gophermap that links to a bridge with an npub selector, or a
`nostr:` URI, is followed natively through your own relays. Old gopherspace and
Nostr end up in one namespace, browsed with one set of keys.

## The honest limits

A project that oversells this would deserve to be ignored, so:

- **Relays are not archives.** Moving off one host removes a single point of
  failure. It does not promise that any relay keeps an event forever. Publish
  to relays you trust, keep an export, and re-check with `gopherkind inspect`.
- **Deletion is a request.** NIP-09 asks relays to forget. Some will not.
  NIP-40 expiration is enforced by well-behaved bridges but is not a tombstone
  for a path with older revisions.
- **A bridge is still a host.** It is just no longer *the* host. If one
  disappears, the documents do not.
- **Kind 31436 is proposed, not accepted.** The submission to
  `nostr-protocol/nips` is [PR #2429](https://github.com/nostr-protocol/nips/pull/2429),
  unmerged at the time of writing. The format is small, specified and
  implemented, but it is not yet a ratified NIP.
- **Gopher is plaintext and unauthenticated over the network,** so it is
  read-only here, deliberately and permanently. Writing happens over the
  terminal, HTTP or Gemini, always through a signer you control.

## Who this is for

People who write things they expect to still be readable in ten years. People
who liked the web before it started asking permission to read a paragraph.
Nostr users with long-form work that deserves better than a timeline. Gopher
operators tired of being the single point of failure for their own archive.
Anyone who has ever gone looking for a phlog they loved and found a connection
refused.

If that is you: [getting started](getting-started.md) takes ten minutes, and
reading costs nothing at all.
