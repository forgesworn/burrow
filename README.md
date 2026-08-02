# burrow

Gopherholes served from Nostr relays.

Your gopherhole is a set of signed Nostr events (kind `31436`, after RFC
1436). Relays mirror it, so there is no server to maintain and no box
whose death takes your hole with it. Any burrow bridge can serve any
hole to any gopher client ever written: lynx, Lagrange, VF-1, an Amiga.

- **Publish once, hosted everywhere.** Documents live on relays;
  bridges are stateless and interchangeable.
- **Every npub is already a hole.** Profiles, notes and NIP-23
  long-form articles are served as *virtual holes*: the whole of Nostr
  is browsable from gopherspace without anyone publishing a thing.
- **Gopher and Gemini from one daemon.** Port 70 and port 1965, same
  events, TLS certs generated on first run.
- **A hole is an npub, not an address.** Signed content, portable
  identity, zappable phlogs.
- **The smolweb keeps its manners.** Plain text, menus, no scripts, no
  tracking. Per-IP rate limiting and bounded caches keep a public
  bridge polite in both directions.

## Quickstart

Requires Node >= 24.

```sh
npm install

# Publish the example hole (signs with your key, sends to relays)
BURROW_NSEC=nsec1... node src/cli.ts publish examples/hole

# Serve gopherspace (gopher on 7070, gemini on 1965)
node src/cli.ts serve

# Browse your hole -- or anyone's npub, published or not
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
```

`publish` prints your hole's root selector when it finishes. Useful
flags: `--dry-run` to inspect the signed events without sending them,
`--expire 30d` for ephemeral documents (NIP-40; s/m/h/d/w).

`unpublish` sends a NIP-09 deletion request: `burrow unpublish
/about.txt`, or `--all` for the whole hole. Relays may ignore it;
prefer `--expire` for content that must vanish.

## Writing a hole

A hole is a directory. Text files become type `0` documents;
`index.map` (or classic `gophermap`) becomes the menu for its
directory; any other `*.map` file becomes a menu at its own path.

`index.map` is a **burrowmap**: a gophermap without host/port columns,
because your documents have no host. Plain lines are info text; linked
lines are `<type><display>` TAB `<link>`:

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

Links may be same-hole paths, `npub`/`nprofile`/`naddr` entities
(kind 31436 documents, or kind 30023 articles served from the author's
virtual hole), `gopher://` URLs (served with their real host), or web
URLs (served as `h` items).

## Virtual holes

Any npub browses as a hole even if it never published a kind 31436
event: `/profile.txt` from kind 0, `/notes` from recent top-level kind
1 notes, `/articles` from NIP-23 long-form. Authored documents shadow
virtual paths, so publishing a real root menu takes over cleanly.
Disable with `--no-virtual`.

## Running a public bridge

```sh
node src/cli.ts serve --port 70 --gemini-port 1965 \
  --hostname gopher.example.org \
  --relay wss://relay.damus.io --relay wss://nos.lol \
  --pin npub1somehole...
```

`--hostname`/`--public-port` set the address written into gopher menus
(useful behind NAT or a port redirect). `--pin` lists holes on the
welcome menu by their profile name. Gemini serves a self-signed cert
from `--state-dir` (default `~/.burrow`), generated with openssl on
first run; bring your own with `--cert`/`--key`, or turn the frontend
off with `--no-gemini`. Search uses NIP-50 where relays support it and
falls back to grepping fetched events. Responses are cached for a
minute; per-IP token buckets (20 burst, 1/s refill) blunt abuse.

## Protocol

See [SPEC.md](SPEC.md) for the event format, burrowmap grammar,
selector mapping, virtual hole paths and the gemini mapping.

## Licence

MIT
