# burrow

Gopherholes served from Nostr relays.

Gopherspace has one endemic disease: holes die. The hobby box behind
your favourite phlog loses power, the domain lapses, and fifteen years
of writing are gone. burrow moves the hole off the box. Documents are
signed Nostr events (kind `31436`, named for RFC 1436), relays mirror
them, and any bridge can serve them to any gopher client written since
1991. lynx, VF-1, Lagrange, an Amiga. All fine.

The hole belongs to your npub, not to a hostname. If a bridge
disappears, point your client at another one and nothing is lost.
Zaps, follows and web of trust come along for free, because it's all
just Nostr underneath.

## Why gopher and Nostr belong together

Cameron Kaiser's essay on why gopher still matters (read it:
`burrow read gopher://gopher.floodgap.com/0/gopher/relevance.txt`)
lands on one idea: gopher divorces interface from information. Every
hole is menus and text, navigated the same way, rendered by anything
with a TCP stack. Sites stand on the strength of their content, not
the glitz of their bling.

Gopher's one structural weakness is that a hole is a host. The
protocol never had a notion of authorship, so your writing lives and
dies with a hostname and a power supply, and nothing in the wire
format can prove who wrote what. That is precisely the shape of
problem Nostr solves: identity is a keypair, documents are signed
events, and relays mirror them without being asked nicely.

The trade works in both directions. Nostr's clients are timelines,
built for the scroll; long-form writing gets buried an hour after it
is posted. Gopher is the opposite temperament: a reading room, where
structure is mandatory and nothing fights for your attention. Kind
31436 gives gopher documents that outlive their host and prove their
author, and gives Nostr a calm, hierarchical surface that a 1991
client can browse.

And because every npub already renders as a virtual hole,
gopherspace quietly grows by the entire Nostr userbase. Kaiser wrote
that gopher and the web should coexist. Add Nostr, and all three are
reading the same content.

## What you get

Two things in one small repo: a publisher that turns a directory of
text files into signed events, and a bridge daemon that speaks gopher
on one side (RFC 1436, default port 7070) and Gemini on the other
(default 1965, TLS), both fed from the same events. Type 7 search
works in gopher, the status 10 input flow in Gemini. NIP-40 expiry is
enforced on read.

The part I like most: every npub is already a hole. If someone has
never heard of burrow, the bridge builds their hole out of what they
have anyway. Kind 0 profile becomes `/profile.txt`, top-level notes
become a phlog at `/notes`, NIP-23 long-form articles land under
`/articles`. Point lynx at any npub and start reading. Authored
documents shadow the virtual paths, so taking over your own hole is
just publishing.

## Quickstart

Needs Node 24 or newer.

```sh
# Browse gopherspace and Nostr interactively, no install
npx @forgesworn/burrow

# Publish the example hole (signs with your key, sends to relays)
BURROW_NSEC=nsec1... npx @forgesworn/burrow publish examples/hole

# Serve gopherspace. Gopher on 7070, Gemini on 1965, HTTP on 8070.
npx @forgesworn/burrow serve

# Browse your hole, or anyone else's npub, published or not
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
```

From a clone, `npm install` once and use `node src/cli.ts` in place
of `npx @forgesworn/burrow`; there is no build step.

`publish` prints your hole's root selector when it finishes. Add
`--dry-run` to inspect the signed events without sending anything,
or `--expire 30d` for documents that should vanish on their own
(NIP-40; s/m/h/d/w all work).

To take something down, `burrow unpublish /about.txt` (or `--all`)
sends a NIP-09 deletion request. Honest caveat: relays are free to
ignore those. If content genuinely must not outlive a date, publish
it with `--expire` in the first place; the bridge refuses to serve
expired documents either way.

## Writing a hole

A hole is a directory. Text files become type `0` documents.
`index.map` (or classic `gophermap`) becomes the menu for its
directory, and any other `*.map` file becomes a menu at its own path.

`index.map` is a burrowmap, which is a gophermap with the host and
port columns chopped off, because your documents don't have a host.
Plain lines are info text. Linked lines are `<type><display>`, a tab,
then the link:

```
Welcome to my burrow

0About this hole	/about.txt
1Phlog	/phlog
7Search this hole	/
1A friend's hole	npub1friend...
0Their best article	naddr1...
1Floodgap (legacy gopherspace)	gopher://gopher.floodgap.com/1/
hMy website	https://example.com
```

Links can be same-hole paths, Nostr entities (`npub`, `nprofile`, or
`naddr` pointing at a kind 31436 document or a kind 30023 article), a
`gopher://` URL (kept on its real host), or a web URL (served as an
`h` item). Pasting in an old gophermap mostly just works; the extra
columns are ignored.

Pages are editable after the fact. Kind 31436 events are addressable:
the path is the `d` tag, so editing a file and running `publish`
again replaces the document at that path everywhere, no dead links,
no cache busting. The same applies to kind 30023 articles, which you
can keep editing in any long-form Nostr client; every hole serves the
latest version.

## Running a public bridge

```sh
node src/cli.ts serve --port 70 --gemini-port 1965 \
  --hostname gopher.example.org \
  --relay wss://relay.damus.io --relay wss://nos.lol \
  --pin npub1somehole...
```

Default relays are Damus, nos.lol and Primal; `--relay` (repeatable)
replaces them. `--hostname` and `--public-port` control the address
written into gopher menus, which matters behind NAT or a port
redirect. `--pin` puts holes on the welcome menu under their profile
names.

Gemini needs TLS, so the bridge generates a self-signed cert with
openssl into `--state-dir` (default `~/.burrow`) on first run.
Bring your own with `--cert` and `--key`, or skip the whole frontend
with `--no-gemini`. `--no-virtual` turns virtual holes off if you
only want authored content.

Bridges are meant to be boring to operate: no database, no state
beyond the TLS cert. Relay responses are cached for a few
minutes (longer for immutable things like note bodies), and each IP
gets a token bucket (burst of 20, refills 1/s) so a scraper can't
turn your bridge into a relay cannon. Search uses NIP-50 where a relay supports it and quietly
falls back to grepping fetched events where it doesn't.

## Navigating: follows, followers, feed

Every hole has these paths, whether or not anyone published anything:

| Path | What it is |
|---|---|
| `/` | root menu |
| `/profile.txt` | kind 0 profile |
| `/notes`, `/notes/<id>` | recent top-level notes |
| `/articles`, `/articles/<d>` | NIP-23 long-form |
| `/follows` | who they follow, each linking to that person's hole |
| `/followers` | who follows them (a sample of what relays carry) |

So `burrow read npub1.../follows` walks the social graph from the
terminal, and the same paths are links in lynx, Lagrange, or any gopher
client. Your own feed lives at `/me/feed` over gopher, `/feed` over
HTTP and Gemini, or `burrow feed` in the terminal.

## Traditional gopherspace

burrow is a gopher client as well as a gopher server, so old holes
render through it too:

```sh
lynx http://localhost:8070/gopher/gopher.floodgap.com/1/
```

Menus, text files and type 7 searches all work, and links inside a
proxied menu stay inside the proxy, so you can wander Floodgap and the
rest of gopherspace from a browser that has never heard of gopher.
Burrowmap `gopher://` links route through it automatically. lynx can
of course also just speak gopher directly.

## The full experience in lynx

lynx is not only a gopher client, it speaks HTTP, so the bridge serves
a third frontend built for it: plain HTML, real forms, no JavaScript
anywhere. Start `burrow serve` and point lynx at
`http://localhost:8070/`.

Requests from loopback are treated as you, the operator, using the
same signer the CLI uses (`BURROW_NSEC`, or whatever `burrow pair`
stored). No login, no cookies, no certificates: open lynx on your own
machine and you are already signed in. You get menus and documents,
search forms, your feed, a note composer, and a delete button on your
own notes.

Remote visitors get the same pages, pair a signer through a form, and
carry a session cookie. That path is plain HTTP, so put it behind TLS
(or your existing reverse proxy) before exposing it, or pass
`--no-local-trust` and `--no-identity` to serve reading only. Turn the
frontend off entirely with `--no-http`.

## Gopher as a full client, locally

Gopher over the network is read-only, and always will be: the protocol
has no authentication and no encryption, so any credential sent over it
would be public.

On loopback none of that applies, because no credential is sent at all.
The bridge knows the request came from this machine, and uses the same
signer the CLI uses. So a local gopher client gets a personal menu at
`/me`:

```sh
lynx gopher://127.0.0.1:7070/1/me
```

Feed, your notes with delete links, who you follow, your followers, and
posting. Writes use type 7 items, whose search string is the only input
channel RFC 1436 ever offered, so you compose a note in the same prompt
gopher used for Veronica queries in 1992. Deleting asks you to type the
word "delete" to confirm.

Remote clients asking for `/me` get a polite type 3 error, and the
welcome menu only advertises it locally. `--no-local-trust` turns it
off entirely.

## The terminal client

You do not need a Gemini client, a browser, or a certificate to use
burrow. Run it bare and you get an interactive browser in the VF-1
tradition that speaks both gopherspace and Nostr:

```
$ burrow
burrow
======

    a gopher client that speaks nostr

    somewhere to start:
[1] Floodgap, the heart of gopherspace
[2] Why is gopher still relevant?
[3] Veronica-2, search all of gopherspace (?)

home> go npub1mgvlrnf...
TheCryptoDonkey
===============
[1] Profile
[2] Notes
[3] Articles (long-form)
[4] Follows
[5] Followers
[6] Search (?)
npub1mgvlrnf...> 2
```

Type a number to follow a link, `back`, `up` and `reload` to move,
`mark` to bookmark the page you are on. Links marked `(?)` prompt for
a search query: Veronica-2 for gopherspace, NIP-50 for holes. A menu
from Floodgap and a menu from an npub are the same thing to the
browser, and when a traditional gophermap links into a burrow bridge
(an npub selector, or a `nostr:` URL), the client follows it natively
through your own relays instead of someone else's bridge.

With a signer paired, `feed` renders notes from who you follow as a
navigable menu, and `post <text>` signs and broadcasts a note without
leaving the browser. Long documents go through `$PAGER`.

One-shot commands cover both worlds too, and reading needs no
identity at all:

```sh
burrow read npub1...              # someone's hole, virtual or authored
burrow read npub1.../notes        # their phlog
burrow read someone@example.org   # NIP-05 names work anywhere a target does
burrow read gopher://gopher.floodgap.com/1/    # traditional gopherspace
burrow search npub1... gopher     # search a hole
burrow search gopher://gopher.floodgap.com/7/v2/vs nostr   # Veronica-2
```

Writing needs a signer, resolved in this order: `BURROW_NSEC` (a local
key), `BURROW_BUNKER` (a one-off bunker URI), or whatever `burrow
pair` stored for you.

```sh
burrow pair bunker://...          # once; stored in the state dir
burrow whoami
burrow post "hello gopherspace"   # signed by your signer, broadcast
burrow feed                       # notes from who you follow
burrow delete <id|note1|nevent1>  # NIP-09 deletion request
burrow unpair
```

`burrow delete --wide` also sends the request to a broader relay set
than you read from, which matters because content spreads further than
your own relay list. Deletion is a request: relays may ignore it, and
clients keep local caches. If what you deleted contained a secret,
rotate the secret too.

`burrow post --dry-run` prints the signed event without sending it.
Every command accepts `--relay` (repeatable) and `--state-dir`.

## Signing in from a Gemini client

The terminal and the HTTP frontend cover most needs. The Gemini
frontend exists for people already living in Geminispace, where client
certificates are the native identity mechanism.

burrow binds that certificate to a NIP-46 remote signer. Visit
`/account`, pair once, and you're signed in. Lagrange will mint a
certificate for you, though its identity UI takes some getting used
to; if that sounds like hard work, use lynx over HTTP or the CLI
instead.

Pairing speaks the same dialect as the rest of the Nostr signer world:
paste a `bunker://` URI from Signet, Amber, nsecBunker or nsec.app, or
use `/pair/connect` for cross-device NostrConnect, where your phone
approves a URI the bridge displays. After that:

- `/post` writes a kind 1 note. The bridge builds the event, your
  signer signs it, relays get it. If your signer is a Heartwood ESP32,
  posting to gopherspace is literally pressing a physical button.
- `/feed` renders your follows (kind 3) as a menu of recent notes,
  each linking into the author's hole.
- `/unpair` cuts the link, and you can revoke the session on the
  signer too.

The bridge never holds a user key. Not pasted, not derived, not
cached. It keeps one small file (`pairings.json` in the state dir,
mode 600) mapping certificate fingerprints to bunker connections, and
every signer conversation has a hard timeout so a powered-off signer
can't wedge a request. Turn the whole layer off with `--no-identity`.

`/post` and `publish` both refuse content that looks like a
credential: a `bunker://` or `nostrconnect://` URI, an nsec or
ncryptsec, a bare `secret=` token. The pair and post inputs sit close
together, a remote signer will cheerfully sign whatever you hand it,
and relays do not forget. If you ever do leak a bunker URI, rotate the
secret on the signer; a deletion request is a polite suggestion, not
a recall.

Notes are single-line and capped around 1200 characters, because a
Gemini input is one URL line. That constraint is honest to the medium;
gopherspace was never the place for essays with inline video.

One clarification for bark users: bark is a NIP-07 browser extension,
and Lagrange isn't a browser, so bark can't inject here. But the
Heartwood bunker behind bark pairs with burrow directly. Same signer,
different front door.

Gopher stays read-only forever. The protocol has no authentication
and no encryption, so any credential sent over it would be public.
1991 gets to read; 2026 gets to write.

## Protocol

[SPEC.md](SPEC.md) has the event format, the burrowmap grammar, the
selector namespace, virtual hole paths and the Gemini mapping. The
short version: one addressable event per document, `d` tag is the
path, `type` tag is `0` or `1`, menus link by path or naddr instead
of host and port. [llms.txt](llms.txt) is the condensed version for
tools and language models.

## Support

burrow is unfunded hobby work under ForgeSworn. If it made you grin:

- Zap: `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`
- Lightning: `profusemeat89@walletofsatoshi.com`
- Ko-fi: <https://ko-fi.com/brays>
- Geyser: <https://geyser.fund/project/forgesworn>

## Licence

MIT
