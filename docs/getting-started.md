# Getting started

Ten minutes from nothing to a signed hole that outlives the machine you
published it from. Reading takes none of them: skip to step two if you only
want to look around.

Requires Node 24 or newer. Nothing else, no database, no build step.

## 1. Install

```sh
# Until the one-time npm registry bootstrap is complete, install from GitHub.
npm install --global github:forgesworn/gopherkind
gopherkind why          # the argument, in your terminal
```

From a clone, `npm install` once and use `node src/cli.ts` wherever this guide
says `gopherkind`. Day-to-day source development needs no build step.

## 2. Read something first

No account, no key, no configuration:

```sh
gopherkind                                    # interactive browser
gopherkind read npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2
gopherkind read npub1.../notes                # their phlog
gopherkind read someone@example.org           # NIP-05 names work as targets
gopherkind read gopher://gopher.floodgap.com/1/   # traditional gopherspace
```

Every npub already has a hole. Profile, notes, replies, mentions, threads,
long-form articles, follows and followers are generated from ordinary Nostr
events, so there is something to read before anyone publishes anything.

In the interactive browser, type a number to follow a link, `back`, `up` and
`reload` to move, `mark` to bookmark, `why` for the pitch, `help` for the rest.

## 3. Connect a signer

gopherkind never accepts an nsec, and never generates a key for you. Writing
goes through a NIP-46 remote signer that you already control: Amber, nsec.app,
nsecBunker, Signet, a Heartwood ESP32, or anything else that speaks the
protocol.

Copy a `bunker://` URI out of that signer, then:

```sh
gopherkind pair 'bunker://...'
gopherkind whoami
```

The pairing is stored in the state directory (`~/.gopherkind` by default).
`GOPHERKIND_BUNKER` overrides it for one-off use. `gopherkind unpair` removes
it. Approve requests in the signer as they arrive; every signing request has a
hard timeout, so a signer that is switched off fails cleanly rather than
hanging.

## 4. Write a hole

A hole is a directory. Text files become type `0` documents. `index.map` (or a
classic `gophermap`) becomes the menu for its directory, and any other `*.map`
file becomes a menu at its own path.

```
my-hole/
  index.map
  about.txt
  phlog/
    index.map
    2026-08-04-first.txt
```

`index.map` is a kindmap: a gophermap with the host and port columns removed,
because your documents have no host. Plain lines are info text; linked lines
are `<type><display>`, a tab, then the link.

```
Welcome to my hole

0About this hole	/about.txt
1Phlog	/phlog
7Search this hole	/
1A friend's hole	npub1friend...
1Floodgap (legacy gopherspace)	gopher://gopher.floodgap.com/1/
hMy website	https://example.com
```

That tab matters: it is a real tab character, not spaces. Links can be
same-hole absolute paths, Nostr entities (`npub`, `nprofile`, or `naddr`
pointing at a kind 31436 document or a kind 30023 article), a `gopher://` URL
which keeps its real host, or a web URL served as an `h` item.

One trap, inherited from gophermap: a line with no tab is information text, and
a single leading `i` is removed from it, because that is how a gophermap marks
an information record. So a prose line beginning with the letter loses it:

```
it is fine to write prose here      ->  t is fine to write prose here
iit is fine to write prose here     ->  it is fine to write prose here
```

Either double the `i`, or reword the line. A signed document keeps whatever you
published, so it is worth reading your menu back after the first publish.

Look before you leap, then publish:

```sh
gopherkind publish ./my-hole --dry-run    # signed events, nothing sent
gopherkind publish ./my-hole
```

`--dry-run` withholds the relay traffic, not the signatures: it signs every
document and prints the finished events, which is what makes it useful for
inspection. On a signer with physical confirmation that means one approval per
document, twice over if you dry-run and then publish. With a hardware signer and
a hole of any size, dry-run once while you are still changing the shape of it,
then publish without.

Publishing discovers your current NIP-65 write relays, uses their union with
the configured relays, spreads your signed relay list alongside the documents,
and reads every document back from every destination. Acceptance and read-back
are reported separately, because a relay's `OK` is not proof that a later
reader can retrieve the event. The command fails if a document is rejected
everywhere or readable nowhere.

Editing is republishing. The path is the event's `d` tag, so changing a file
and running `publish` again replaces the document at that path everywhere. No
dead links, no cache busting.

For content that should not outlive its usefulness, `--expire 30d` sets NIP-40
expiration (`s`, `m`, `h`, `d`, `w` all work). A bridge must never serve an
expired event.

## 5. Check it is really there

```sh
gopherkind inspect npub1...           # per-relay view of your current documents
gopherkind inspect npub1... --json    # versioned report for monitoring
```

The report shows how many current documents each configured, hinted and author
write relay holds, including stale and missing paths. It is a snapshot of
retrievability now, not a retention guarantee. Nothing in Nostr is.

Keep an editable snapshot somewhere safe:

```sh
gopherkind export npub1... ./my-hole-backup
gopherkind publish ./my-hole-backup      # round-trips exactly
```

The export writes ordinary text and kindmap files plus a `.gopherkind.json`
manifest which maps each file back to its exact path, item type and title.

## 6. Serve it

```sh
gopherkind serve
```

Gopher on 7070, Gemini on 1965, HTTP on 8070, all bound to loopback by default.
Then pick a door:

```sh
lynx http://localhost:8070/                    # the full client, no JavaScript
lynx gopher://127.0.0.1:7070/1/npub1yourkey...
lynx gopher://127.0.0.1:7070/1/me              # your feed, notes, posting
```

Requests from loopback are treated as you, using the signer you paired in step
three: no login, no cookies, no certificate. That is also why the `/me` menu is
never served to a remote client. Gopher has no authentication and no
encryption, so it stays read-only over the network, permanently.

You do not have to run a bridge to have a hole. Your documents live on relays;
any bridge can serve them. Running one is for when you want your own front
door, or want to give one to other people. That is
[the operations guide](operations.md).

## 7. Post, delete, unpublish

```sh
gopherkind post "hello gopherspace"
gopherkind feed
gopherkind delete <id|note1|nevent1> [--wide]
gopherkind unpublish /about.txt        # or --all
```

Deletion is a NIP-09 request. Relays are free to ignore it and clients keep
caches, so treat it as a polite request rather than a recall. If what you
deleted contained a secret, rotate the secret. For anything deliberately
temporary, use `--expire` from its first publication instead.

## Where next

- [FAQ](faq.md) for the questions this page raised
- [Troubleshooting](troubleshooting.md) when something says no
- [Why gopher on Nostr](why-gopher-on-nostr.md) for the argument in full
- [SPEC.md](../SPEC.md) if you want to implement kind 31436 yourself
