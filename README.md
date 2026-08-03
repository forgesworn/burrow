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
npm install

# Publish the example hole (signs with your key, sends to relays)
BURROW_NSEC=nsec1... node src/cli.ts publish examples/hole

# Serve gopherspace. Gopher on 7070, Gemini on 1965.
node src/cli.ts serve

# Browse your hole, or anyone else's npub, published or not
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
```

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

Gopher on port 70 stays read-only forever, because the protocol has no
authentication and no encryption. lynx just gets the good version over
HTTP instead.

## Using it from the terminal

You do not need a Gemini client, a browser, or a certificate to use
burrow. Reading needs no identity at all:

```sh
burrow read npub1...              # someone's hole, virtual or authored
burrow read npub1.../notes        # their phlog
burrow search npub1... gopher     # search a hole
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
