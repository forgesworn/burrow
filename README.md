# burrow

Gopherholes served from Nostr relays.

Your gopherhole is a set of signed Nostr events (kind `31436`, after RFC
1436). Relays mirror it, so there is no server to maintain and no box
whose death takes your hole with it. Any burrow bridge can serve any
hole to any gopher client ever written: lynx, Lagrange, VF-1, an Amiga.

- **Publish once, hosted everywhere.** Documents live on relays;
  bridges are stateless and interchangeable.
- **A hole is an npub, not an address.** Signed content, portable
  identity, zappable phlogs.
- **The smolweb keeps its manners.** Plain text, menus, no scripts, no
  tracking, port 70.

## Quickstart

Requires Node >= 24.

```sh
npm install

# Publish the example hole (signs with your key, sends to relays)
BURROW_NSEC=nsec1... node src/cli.ts publish examples/hole

# Serve gopherspace
node src/cli.ts serve --port 7070

# Browse
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
```

`publish` prints your hole's root selector when it finishes. Use
`--dry-run` to inspect the signed events without sending them.

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
1A friend's hole	nostr:naddr1...
1Floodgap (legacy gopherspace)	gopher://gopher.floodgap.com/1/
hMy website	https://example.com
```

Links may be same-hole paths, `naddr`s of other holes, `gopher://`
URLs (served with their real host), or web URLs (served as `h` items).

## Running a public bridge

```sh
node src/cli.ts serve --port 70 --hostname gopher.example.org \
  --relay wss://relay.damus.io --relay wss://nos.lol \
  --pin npub1somehole...
```

`--hostname`/`--public-port` set the address written into menus (useful
behind NAT or a port redirect). `--pin` lists holes on the welcome menu.
The bridge caches relay responses for 60 seconds.

## Protocol

See [SPEC.md](SPEC.md) for the event format, burrowmap grammar and
selector mapping.

## Licence

MIT
