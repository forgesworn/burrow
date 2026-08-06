# gopherkind

Gopherholes served from Nostr relays.

[![ci](https://github.com/forgesworn/gopherkind/actions/workflows/ci.yml/badge.svg)](https://github.com/forgesworn/gopherkind/actions/workflows/ci.yml)
[![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![node >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)

**[Why gopher on Nostr](docs/why-gopher-on-nostr.md)** ·
**[Getting started](docs/getting-started.md)** ·
**[Docs](docs/index.md)** ·
**[FAQ](docs/faq.md)** ·
**[gopherkind.com](https://gopherkind.com/)** ·
**[Support](docs/support.md)**

Gopherspace has one endemic disease: holes die. The hobby box behind
your favourite phlog loses power, the domain lapses, and fifteen years
of writing are gone. gopherkind moves the hole off the box. Documents are
signed Nostr events (kind `31436`, named for RFC 1436), published to relays
the author chooses, and any bridge that can retrieve a copy can serve them to
any gopher client written since 1991. lynx, VF-1, Lagrange, an Amiga. All fine.

The hole belongs to your npub, not to a hostname. If a bridge disappears,
another bridge can serve the same signed events from the relays that still
carry them. That removes the hostname as a single point of failure; it does
not promise that relays will retain every event forever.
Profiles, follows and the rest of the author's Nostr identity remain
available to readers because the documents use that same pubkey.

## Why gopher and Nostr belong together

Cameron Kaiser's essay on why gopher still matters (read it:
`gopherkind read gopher://gopher.floodgap.com/0/gopher/relevance.txt`)
lands on one idea: gopher divorces interface from information. Every
hole is menus and text, navigated the same way, rendered by anything
with a TCP stack. Sites stand on the strength of their content, not
the glitz of their bling.

Gopher's one structural weakness is that a hole is a host. The
protocol never had a notion of authorship, so your writing lives and
dies with a hostname and a power supply, and nothing in the wire
format can prove who wrote what. That is precisely the shape of
problem Nostr solves: identity is a keypair, documents are signed
events, and the author can place copies on more than one relay.

The trade works in both directions. Nostr's clients are timelines,
built for the scroll; long-form writing gets buried an hour after it
is posted. Gopher is the opposite temperament: a reading room, where
structure is mandatory and nothing fights for your attention. Kind
31436 gives gopher documents that are independent of one host, prove their
author, and remain recoverable while a relay retains a copy. It gives Nostr a
calm, hierarchical surface that a 1991 client can browse.

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
enforced after replacement selection, so an expired latest revision
makes the path absent rather than deliberately selecting older content
when both revisions are visible.

The part I like most: every npub is already a hole. If someone has
never heard of gopherkind, the bridge builds their hole out of what they
have anyway. Kind 0 profile becomes `/profile.txt`, top-level notes
become a phlog at `/notes`, replies and mentions get their own views,
thread pages add context, NIP-23 long-form articles land under `/articles`,
and `/feed.xml` is an Atom feed. Point lynx at any npub and start reading. Authored
documents shadow the virtual paths, so taking over your own hole is
just publishing.

## Quickstart

Needs Node 24 or newer.

```sh
# Until the one-time npm bootstrap is complete, install from GitHub.
npm install --global github:forgesworn/gopherkind

# The case for all this, in your terminal
gopherkind why

# Browse gopherspace and Nostr interactively
gopherkind

# Pair your existing NIP-46 signer. Your secret key never enters gopherkind.
gopherkind pair 'bunker://...'

# Publish the example hole through that signer.
gopherkind publish examples/hole

# Serve gopherspace. Gopher on 7070, Gemini on 1965, HTTP on 8070.
gopherkind serve

# Browse your hole, or anyone else's npub, published or not
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
```

From a clone, `npm install` once and use `node src/cli.ts` in place
of `gopherkind`; day-to-day source development needs no build step.

The public reference bridge is available on all three frontends:

- Gopher: `gopher://gopherkind.com/`
- Gemini: `gemini://gopherkind.com/`
- Web: <https://gopherkind.com/>

Every bridge explains itself at `/about` on all three, built from the same
document the terminal prints for `gopherkind why`. A reader who has never heard
of Nostr needs no account to get the point.

gopherkind has an identity of its own rather than borrowing the maintainer's,
because a hole belongs to a key. Its pages live in this repository's `hole/`
directory and are published from there, so the documentation is readable
through the thing it documents:

```sh
gopherkind read npub18y4d9g6gjc8n6vkqdq0wphh5zzt6zna9tleyvhwzw063pvr5p4fsv05p0s
gopherkind read gopherkind@gopherkind.com    # the same hole, by NIP-05 name
```

Until the first publication reaches relays, that npub renders as an ordinary
empty virtual hole, which is itself the point: the address exists before the
content does.

The web endpoint terminates TLS on the bridge host, so remote visitors can
connect a NIP-07 browser extension or pair a NIP-46 signer. Port 8070 is not
publicly reachable. The bridge is one route to relay-held events, not a
promise of uptime or relay retention.

Nothing needs to be published for that to work. Point it at any npub
and a hole is already there, generated from the events that account
already has:

```
$ gopherkind read npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2
TheCryptoDonkey
===============

  TheCryptoDonkey
  a virtual hole generated from Nostr events

  Bitcoin, freedom, decentralisation, liberty advocate.

  Profile
      /npub1mgvlrnf.../profile.txt
  Notes
      /npub1mgvlrnf.../notes
  Articles (long-form)
      /npub1mgvlrnf.../articles
  Follows
      /npub1mgvlrnf.../follows
  Followers
      /npub1mgvlrnf.../followers
  Search
      /_gopherkind/search/npub1mgvlrnf...
```

(npubs abbreviated above; the real output prints them in full.)

Long streams page rather than stopping dead, on every surface:

```
$ gopherkind read npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2/notes
...
  Older
      /npub1mgvlrnf.../notes/before/1774317715/7e4a...c912
```

Follow that link and you get the next page, plus a way back to the
top. Same on gopher, Gemini and in lynx.

`publish` prints your hole's root selector when it finishes. Add
`--dry-run` to inspect the signed events without sending anything,
or `--expire 30d` for documents that should vanish on their own
(NIP-40; s/m/h/d/w all work).

Publishing discovers the author's current NIP-65 write relays, uses their
union with the configured relays, spreads an existing signed relay list
alongside the documents, and reads each document back from every destination.
Acceptance and read-back are reported separately; a document rejected
everywhere or not readable anywhere makes the command fail.

`gopherkind inspect npub1...` performs the read side of that check again later.
It shows how many current documents are readable from each configured,
hinted and author write relay, including stale and missing paths. Add `--json`
for a versioned machine-readable report suitable for monitoring and recovery
checks. Either form is a snapshot of retrievability now, not a retention
guarantee.

To recover a hole into editable files:

```sh
gopherkind export npub1... ./recovered-hole
gopherkind publish ./recovered-hole
```

The export includes `.gopherkind.json`, which maps each source file back to
its exact path, item type and title. The manifest is authoritative when that
directory is published, so coordinates which cannot be represented safely by
filename conventions still round-trip. Export refuses a non-empty directory;
use `--force` only when deliberately replacing an earlier snapshot.

To take something down, `gopherkind unpublish /about.txt` (or `--all`)
sends a NIP-09 deletion request. Honest caveat: relays are free to
ignore those. For deliberately temporary material, use `--expire` from
its first publication; the bridge refuses to serve an expired event it
has received.

One subtlety matters for revised documents: a relay may delete an expired
latest event while still retaining an older revision. A reader arriving later
cannot know that missing replacement existed. `--expire` is therefore not a
durable tombstone for a path with older history; coordinate deletion is still
needed if that distinction matters, and deletion itself remains best-effort.

## Writing a hole

A hole is a directory. Text files become type `0` documents.
`index.map` (or classic `gophermap`) becomes the menu for its
directory, and any other `*.map` file becomes a menu at its own path.

`index.map` is a kindmap, which is a gophermap with the host and
port columns chopped off, because your documents don't have a host.
Plain lines are info text. Linked lines are `<type><display>`, a tab,
then the link:

```
Welcome to my gopherkind

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

Paths are exact identifiers. A bridge does not trim trailing spaces,
collapse slashes, case-fold, or Unicode-normalise a signed `d`. In a URL,
`/a b` becomes `/a%20b`, while the different document `/a%20b` becomes
`/a%2520b`.

## Running a public bridge

```sh
gopherkind serve --host 0.0.0.0 --port 7070 --public-port 70 \
  --gemini-port 1965 --no-identity --no-local-trust \
  --hostname gopher.example.org \
  --relay wss://relay.damus.io --relay wss://nos.lol \
  --pin npub1somehole...
```

That direct-public profile is deliberately read-only over HTTP. To put the
HTTP frontend behind a same-host TLS reverse proxy and allow visitors to pair
their own signer, keep port 8070 private and make the trust boundary explicit:

```sh
gopherkind serve --host 0.0.0.0 --port 7070 --public-port 70 \
  --hostname gopher.example.org --no-local-trust \
  --http-url https://gopher.example.org --http-behind-proxy
```

The proxy must be the only route to port 8070, preserve `Host`, set
`X-Forwarded-Proto: https`, and replace `X-Forwarded-For` with the single
client address. The bridge then emits canonical and social-preview metadata
for the HTTPS origin and rate-limits visitors separately. NIP-05 names work in
the HTTP opener and as direct paths, but redirect to an npub URL so links are
portable between bridges.

Default relays are Damus, nos.lol and Primal; `--relay` (repeatable)
replaces them. `--hostname` and `--public-port` control the address
written into gopher menus, which matters behind NAT or a port
redirect. `--pin` puts holes on the welcome menu under their profile
names.

Gemini needs TLS, so the bridge generates a self-signed cert with
openssl into `--state-dir` (default `~/.gopherkind`) on first run.
Bring your own with `--cert` and `--key`, or skip the whole frontend
with `--no-gemini`. `--no-virtual` turns virtual holes off if you
only want authored content.

Bridges are meant to be boring to operate: no database. The state directory
contains the TLS certificate, NIP-46 pairing records and local bookmarks.
Relay responses are cached for a few minutes (longer for immutable things like note bodies), and each IP
gets a token bucket (burst of 20, refills 1/s) so a scraper can't
turn your bridge into a relay cannon. Search uses NIP-50 where a relay supports it and quietly
falls back to grepping fetched events where it doesn't.

Reads follow the author's NIP-65 relay list (kind 10002), so a hole
published to someone's own relays is found even when your bridge does
not carry those relays, not silently replaced by their virtual hole.
A relay hint inside an `nprofile` or `naddr` link is honoured the same
way. Hinted relays and public bunker relays are checked again during DNS
lookup at socket connection time, and loopback, private and link-local answers
are refused. The built-in gopher proxy applies the same network boundary, and
`/robots.txt` keeps crawlers out of it.

The HTTP listener exposes `GET /healthz` for service checks and the process
closes its listeners and relay pool on SIGTERM or SIGINT. The container,
reverse-proxy and rollback details are in the
[operations guide](docs/operations.md).

Release tarballs and checksums are attached to GitHub releases even while the
first npm registry publication remains an owner-controlled bootstrap. The
exact release procedure and registry gate are in the
[release guide](docs/releasing.md).

Once the bridge is up, tell Nostr clients it exists:

```sh
gopherkind announce --hostname gopher.example.org \
  --http-url https://gopher.example.org --dry-run
```

That builds a NIP-89 handler announcement (kind 31990) saying this
bridge opens kind 31436. Drop `--dry-run` to sign and publish it.

The proposed event format is deliberately small: [SPEC.md](SPEC.md)
defines kind `31436`, exact paths and kindmap. Virtual holes, pagination,
search and frontend routing live separately in the
[bridge profile](docs/bridge-profile.md).

## Navigating: follows, followers, feed

Every hole has these paths, whether or not anyone published anything:

| Path | What it is |
|---|---|
| `/` | root menu |
| `/profile.txt` | kind 0 profile |
| `/notes`, `/notes/<id>` | recent top-level notes |
| `/replies` | kind 1 replies which tag the hole owner |
| `/mentions` | top-level kind 1 mentions which tag the hole owner |
| `/threads/<id>` | note context and replies found on the bridge relays |
| `/articles`, `/articles/<naddr>` | NIP-23 long-form |
| `/feed.xml` | Atom feed of recent notes and articles, using `nostr:` IDs |
| `/follows` | who they follow, each linking to that person's hole |
| `/followers` | who follows them (a sample of what relays carry) |

So `gopherkind read npub1.../follows` walks the social graph from the
terminal, and the same paths are links in lynx, Lagrange, or any gopher
client. Your own feed lives at `/me/feed` over gopher, `/feed` over
HTTP and Gemini, or `gopherkind feed` in the terminal.

## Traditional gopherspace

gopherkind is a gopher client as well as a gopher server, so old holes
render through it too:

```sh
lynx http://localhost:8070/gopher/gopher.floodgap.com/1/
```

Menus, text files and type 7 searches all work, and links inside a
proxied menu stay inside the proxy, so you can wander Floodgap and the
rest of gopherspace from a browser that has never heard of gopher.
Kindmap `gopher://` links route through it automatically. lynx can
of course also just speak gopher directly.

Traditional menus which use ANSI SGR colours or text attributes retain that
styling in the graphical web frontend. Other terminal controls stay inert;
cursor movement, terminal hyperlinks and clipboard commands are never passed
through as browser behaviour.

## The full experience in lynx

lynx is not only a gopher client, it speaks HTTP, so the bridge serves
a third frontend built for it: plain HTML and real forms whose complete
NIP-46 path needs no JavaScript. Start `gopherkind serve` and point lynx at
`http://localhost:8070/`.

Requests from loopback are treated as you, the operator, using the
remote signer that `gopherkind pair` stored. No login, no cookies, no
certificates: open lynx on your own
machine and you are already signed in. You get menus and documents,
search forms, your feed, a note composer and a page workspace at `/me`.
The workspace lists your authored paths and lets you add a page, open it,
edit and republish it in place, or publish a signed deletion request. Your own
notes also carry a deletion button.

HTTP and Gemini search lives at `/_gopherkind/search/<npub>`, outside
the authored hole namespace. A document published at `/search` is
therefore served normally rather than being intercepted by the bridge.

Remote visitors can get the same pages, pair a NIP-46 signer through a form or
connect a standard NIP-07 browser extension, and carry a session cookie when
the listener sits behind TLS. A non-loopback bind
requires `--http-behind-proxy`, an HTTPS `--http-url`, and
`--no-local-trust`; the HTTP port must not be exposed directly. Identity is
disabled automatically on an ordinary public bind, so direct plaintext
deployment is read-only. Turn the frontend off entirely with `--no-http`.

Operator trust is decided by connection origin (loopback), so behind a
reverse proxy every request would look local. Pass `--no-local-trust` for any
proxied deployment. A same-host proxy can reach a `127.0.0.1` bind; a
container-network proxy uses the explicit `--http-behind-proxy` contract.
`--trust-loopback-anyway` is only for a proxy that cannot be reached by anyone
but you. State-changing forms carry a CSRF token and reject cross-site origins,
and the loopback operator is recognised only on a loopback `Host`, so a stray
browser tab or a rebound domain cannot post as you.

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
gopherkind. Run it bare and you get an interactive browser in the VF-1
tradition that speaks both gopherspace and Nostr:

```
$ gopherkind
gopherkind
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
browser, and when a traditional gophermap links into a gopherkind bridge
(an npub selector, or a `nostr:` URL), the client follows it natively
through your own relays instead of someone else's bridge.

With a signer paired, `feed` renders notes from who you follow as a
navigable menu, and `post <text>` signs and broadcasts a note without
leaving the browser. Long documents go through `$PAGER`.

One-shot commands cover both worlds too, and reading needs no
identity at all:

```sh
gopherkind read npub1...              # someone's hole, virtual or authored
gopherkind read npub1.../notes        # their phlog
gopherkind read someone@example.org   # NIP-05 names work anywhere a target does
gopherkind read gopher://gopher.floodgap.com/1/    # traditional gopherspace
gopherkind search npub1... gopher     # search a hole
gopherkind search gopher://gopher.floodgap.com/7/v2/vs nostr   # Veronica-2
```

Writing always uses a remote NIP-46 signer. `GOPHERKIND_BUNKER` provides a
one-off bunker URI; otherwise gopherkind uses the pairing that `gopherkind
pair` stored. Local secret keys and nsec input are never accepted.

```sh
gopherkind pair bunker://...          # once; stored in the state dir
gopherkind whoami
gopherkind post "hello gopherspace"   # signed by your signer, broadcast
gopherkind feed                       # notes from who you follow
gopherkind delete <id|note1|nevent1>  # NIP-09 deletion request
gopherkind unpair
```

`gopherkind delete --wide` also sends the request to a broader relay set
than you read from, which matters because content spreads further than
your own relay list. Deletion is a request: relays may ignore it, and
clients keep local caches. If what you deleted contained a secret,
rotate the secret too.

`gopherkind post --dry-run` prints the signed event without sending it.
Every command accepts `--relay` (repeatable) and `--state-dir`.

## Signing in from a browser extension

Open `/account` in Chrome or another graphical browser and gopherkind detects
the standard `window.nostr` interface supplied by a NIP-07 extension. Choose
**Connect browser extension** and approve the public-key and connection
requests in the extension. Bark and other conforming providers use the
same interface; gopherkind does not contain extension-specific integration.

The connection request is a fresh NIP-98 event scoped to the exact bridge URL
and HTTP method. The bridge verifies its id, signature, author, timestamp and
scope, refuses replay, and then issues a short-lived HTTP-only session cookie.
Posting, publishing and deletion are signed inside the extension. Only the
public signed event crosses to gopherkind, which verifies the session author
and exact event template before sending anything to relays. A NIP-07 session
can never borrow the bridge's NIP-46 signer.

Public browser identity requires the documented HTTPS reverse-proxy mode.
Direct plaintext public HTTP deliberately stays read-only. The base pages,
NIP-46 forms and all reading continue to work without JavaScript in lynx.

Every HTTP page has a **back** link. In a graphical browser it follows real
browser history, while a direct visit or a text browser safely falls back to
Home.

## Signing in from a Gemini client

The terminal and the HTTP frontend cover most needs. The Gemini
frontend exists for people already living in Geminispace, where client
certificates are the native identity mechanism.

gopherkind binds that certificate to a NIP-46 remote signer. Visit
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
- `/publish` guides you through a plain-text page or a menu page, including a
  working kindmap example, then writes one kind 31436 document after explicit
  confirmation that the exact path will replace its current revision. It uses
  the same NIP-65 relay plan and acceptance/read-back checks as the CLI
  publisher.
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

Notes are single-line and capped at a few hundred characters, because a
Gemini input is one URL line and a Gemini request URL may not exceed
1024 bytes once the text is percent-encoded. That constraint is honest
to the medium; gopherspace was never the place for essays with inline
video.

One clarification for Bark users: in Chrome, Bark injects the standard
`window.nostr` provider and the NIP-07 button uses it directly. Lagrange is
not a browser, so Bark cannot inject there; pair the Heartwood bunker behind
Bark over NIP-46 instead. Same signer, different front door.

Gopher stays read-only forever. The protocol has no authentication
and no encryption, so any credential sent over it would be public.
1991 gets to read; 2026 gets to write.

## Protocol

[SPEC.md](SPEC.md) has the proposed kind's event format, exact path rules,
replacement semantics and kindmap grammar. The selector namespace, virtual
views, pagination and frontend mapping are deliberately separate in the
[bridge profile](docs/bridge-profile.md). The language-neutral fixture and its
field definitions are in [the conformance guide](docs/conformance.md).
[llms.txt](llms.txt) is the condensed implementation guide for tools and
language models.

Kind 31436 is not yet an accepted NIP. The proposal was submitted to
`nostr-protocol/nips` as [PR #2429](https://github.com/nostr-protocol/nips/pull/2429)
on 3 August 2026 and remains unmerged. [docs/nip-submission.md](docs/nip-submission.md)
records the proposal and its independent fixture evidence.

## Documentation

| Document | What it covers |
|---|---|
| [Why gopher on Nostr](docs/why-gopher-on-nostr.md) | The case, and its honest limits |
| [Getting started](docs/getting-started.md) | Install, read, pair, publish, verify, serve |
| [FAQ](docs/faq.md) | Retention, deletion, keys, tokens, what this is not |
| [Troubleshooting](docs/troubleshooting.md) | Error messages and what to do about them |
| [Operations](docs/operations.md) | Running a public bridge properly |
| [Bridge profile](docs/bridge-profile.md) | Normative application behaviour |
| [SPEC.md](SPEC.md) | Kind 31436 itself |
| [Support](docs/support.md) | What funding buys |

[docs/index.md](docs/index.md) is the full map.

## Support

gopherkind is MIT-licensed, unfunded work under ForgeSworn. No company, no
token, no ads, no telemetry, no custody of anyone's key, and nothing to sell
you. It is paid for in evenings and a small hosting bill, so funding buys the
only thing the project is made of: consecutive evenings.

- Zap: `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2`
- Lightning: `profusemeat89@walletofsatoshi.com`
- Ko-fi: <https://ko-fi.com/brays>
- Geyser: <https://geyser.fund/project/forgesworn>

[docs/support.md](docs/support.md) says what the money actually does, what it
will never do, and the several ways to help that cost nothing.

## Licence

MIT
