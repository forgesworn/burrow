# Troubleshooting

Error messages, what they mean, and what to do next. If something here is
wrong or missing, that is a bug worth [reporting](https://github.com/forgesworn/gopherkind/issues).

## Installing and running

**`Unknown file extension ".ts"`, or syntax errors on startup.** The source
runs on Node 24's type stripping. Check `node --version`; anything older than
24 will not run it. A global install from GitHub compiles `dist/` through
`prepare`, so `gopherkind` itself works on any Node 24 or newer.

**`command not found: gopherkind` after a global install.** Your npm global bin
directory is not on `PATH`. `npm bin -g` prints it.

**`could not generate a certificate (is openssl installed?); pass --cert/--key`.**
The Gemini frontend needs a TLS certificate and generates a self-signed one
with openssl on first run. Install openssl, bring your own certificate with
`--cert` and `--key`, or turn the frontend off with `--no-gemini`.

## Reading

**`not a gopherhole: <something>`.** The first path segment must be an npub. A
NIP-05 name (`someone@example.org`), a `nostr:` entity or a `gopher://` URL all
work as CLI targets, but a bridge selector is `/<npub>[/path]`.

**`no document at /path in npub1...`.** Nothing authored at that exact path,
and no virtual view matches it. Paths are byte-exact signed identifiers: a
trailing space, a different case or a collapsed slash is a different document.
`gopherkind inspect npub1...` lists what actually exists.

**A document you published is missing.** Three usual causes: the relay you are
reading from never accepted it, the event expired (NIP-40 is enforced after
replacement selection, so an expired latest revision makes the path absent
rather than falling back to an older one), or you are reading from a different
relay set. Try `gopherkind read npub1.../path --relay wss://the-relay-you-used`.

**Someone's hole shows the generated view when they have published one.** Their
documents are probably on relays neither you nor the bridge carries. Reads
follow the author's NIP-65 list, so this usually means their kind 10002 is
missing or stale.

## Signing and pairing

**`no signer. Either 'gopherkind pair bunker://...' once, or set GOPHERKIND_BUNKER.`**
Exactly what it says: nothing is paired and no environment override is set.

**`bunker connect (approve it on your signer) timed out after 60s`.** The
signer never answered. Check it is running, unlocked and connected to the
relays in the bunker URI, then approve the request when it appears. Every
signer conversation has a hard timeout on purpose: a bridge that waits forever
is a bridge that can be wedged by a flat battery.

**`not a valid bunker:// URI or NIP-05 bunker address`.** Copy the whole URI,
including the `?relay=` and `&secret=` parameters. Some signers wrap it across
lines.

**`bunker relay address is not permitted`.** The URI named a loopback, private
or link-local relay. Untrusted relay hints are checked at socket connection
time, so a hostname that resolves inside your network is refused.

**Content refused before it is signed.** The credential guard blocks anything
that looks like a `bunker://` or `nostrconnect://` URI, an nsec, an ncryptsec or
a bare `secret=` token. A remote signer will cheerfully sign whatever it is
handed and relays do not forget, so the pair and post inputs are guarded. If
you have already leaked a bunker URI, rotate the secret on the signer.

**`This page is too large for the safe 20 KiB remote-signing request limit.`**
Constrained hardware signers have small transport frames. Split the page.

## Publishing

**`document was rejected by every relay`.** Every destination said no. Common
reasons: the relay requires payment or an allow list, the event is larger than
its limit, or your NIP-65 list points at relays that no longer exist. Pass
`--relay` explicitly to test one relay at a time.

**`document was accepted but is not readable from any relay`.** Acceptance is
not retrievability, which is exactly why publishing reads back. Try again, and
if it persists, publish to a relay you control.

**`invalid kind 31436 document` or `invalid document path`.** A path must be
absolute, valid UTF-8 and free of `.` or `..` segments. A menu file must parse
as a kindmap: `<type><display>`, a real tab character, then the link. Spaces
instead of a tab are the usual culprit.

**Menu links go nowhere.** Same-hole links must be absolute paths beginning
`/`. A kindmap does not publish the documents it links to; publish those files
too.

**`export takes a hole root, not an individual path`** and
**`no current documents found to export`.** Export operates on a whole hole and
needs at least one current document; check with `gopherkind inspect` first.

## Serving

**`--http-behind-proxy requires --no-local-trust`,
`--http-behind-proxy requires an https --http-url`.** The proxied deployment is
an explicit contract. Behind a reverse proxy every request arrives from
loopback, so operator trust must be switched off or every visitor would be
treated as you.

**`--hostname is required when --host is a wildcard address`.** Gopher menus
carry an absolute host and port. Binding to `0.0.0.0` gives the bridge no way
to guess which name clients use.

**Menus link to the wrong host or port.** That is `--hostname` and
`--public-port`, which control what is written into menu records, not what the
bridge binds to. Behind NAT or a port redirect they will differ.

**Permission denied binding port 70 or 1965.** Ports below 1024 need
privileges. Bind the default 7070 and redirect with your firewall, or use a
service manager that can grant the capability.

**`/me` returns a type 3 error.** By design: it is loopback-only and never
advertised remotely, because gopher has no authentication or encryption.
`--no-local-trust` disables it entirely.

**Remote HTTP visitors cannot sign in.** Public browser identity requires the
documented HTTPS reverse-proxy mode. A direct plaintext public bind is
read-only on purpose.

**Lagrange will not pair.** Gemini identity is bound to a client certificate,
so mint one in the client and make sure it is active for that host before
visiting `/account`. If its identity UI is more work than it is worth, use lynx
over HTTP or the CLI instead.

## Still stuck

`gopherkind inspect npub1... --json` produces a versioned report that is safe
to attach to an issue: it contains public event coordinates and relay results,
no secrets. Include your Node version and how the bridge is deployed.
