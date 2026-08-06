# Operating a gopherkind bridge

The safe default is local-only: `gopherkind serve` binds all three listeners
to `127.0.0.1`. Exposing a bridge is an explicit operator decision.

## Public reference bridge

The reference deployment runs release `v0.15.3` at commit
`eb39ca57972f73f3f62de565234dcd4946545c34`:

- `gopher://gopherkind.com/`
- `gemini://gopherkind.com/`
- `https://gopherkind.com/`

It runs the repository image as an unprivileged user with a read-only root
filesystem, a persistent state mount, automatic restart and explicit CPU,
memory and process limits. The deployment exposes Gopher on TCP 70 and Gemini
on TCP 1965; web traffic shares the host's existing Caddy listener on 443.
Port 8070 is bound to `127.0.0.1`, and the same-host Caddy proxy is its only
caller. The bridge runs with `--http-behind-proxy`,
`--no-local-trust` and the HTTPS URL above, so NIP-07 and NIP-46 identity are
available without granting proxy traffic local-operator authority.

The bridge serves the project's own hole as its front page, and pins it:

```sh
--home npub18y4d9g6gjc8n6vkqdq0wphh5zzt6zna9tleyvhwzw063pvr5p4fsv05p0s \
--pin  npub18y4d9g6gjc8n6vkqdq0wphh5zzt6zna9tleyvhwzw063pvr5p4fsv05p0s
```

`--home` replaces the generic welcome with that hole's root menu on gopher,
Gemini and HTTP. The hole is authored content, so what the front page says is
changed by publishing rather than by redeploying the bridge. If its relays are
unreachable the bridge falls back to the generic welcome, which is why the
project relay belongs in the bridge's own `--relay` set.

Its NIP-05 name is served statically by the proxy rather than by the bridge.
A bridge is a window onto relays, and who owns a name at a hostname is the
operator's claim, not something relay data can answer. The reference Caddyfile
answers `/.well-known/nostr.json` for both `_@gopherkind.com` (which clients
display as the bare domain) and `gopherkind@gopherkind.com`, with the
`Access-Control-Allow-Origin: *` header NIP-05 requires. Verify after any proxy
change:

```sh
curl -fsS 'https://gopherkind.com/.well-known/nostr.json?name=_'
gopherkind read gopherkind@gopherkind.com
```

The proxy also serves the project page at `https://gopherkind.com/project/`,
straight from `site/` in the deployed checkout, so it needs no publish step of
its own and cannot drift from the release that is running. The root belongs to
the bridge, which serves gopherkind's own hole: the project's front door is the
software doing its job, and the prose about it lives one path down. The GitHub
Pages copy is the same bytes and declares `gopherkind.com/project/` canonical,
so old links keep working without the project having two homes. Verify after
any proxy change:

```sh
curl -fsS -o /dev/null -w '%{http_code}\n' https://gopherkind.com/project/
curl -fsS -o /dev/null -w '%{http_code}\n' https://gopherkind.com/project/logo.png
```

The live HTTPS route uses [the checked-in Caddyfile](../deploy/reference.Caddyfile)
as a fragment of the host's shared, system-managed Caddy configuration. Caddy
owns ports 80 and 443, obtains and renews the public certificate, and replaces
the forwarding headers before sending requests to `127.0.0.1:8070`. The app
container remains the only gopherkind-specific runtime: it runs read-only as
the unprivileged `node` user with automatic restart, a health check, a
persistent state mount, dropped capabilities and explicit CPU, memory and
process limits.

## Native service

Run the compiled package as an unprivileged service user. Keep the state
directory on persistent storage and mode 700:

```sh
install -d -m 700 -o gopherkind -g gopherkind /var/lib/gopherkind
gopherkind serve \
  --host 127.0.0.1 \
  --hostname gopher.example.org \
  --state-dir /var/lib/gopherkind \
  --no-local-trust
```

Put the HTTP listener behind a same-host TLS reverse proxy and proxy only to
`127.0.0.1:8070`. `--no-local-trust` is essential in that layout: otherwise
every proxied request arrives from loopback and would be treated as the local
operator. Set `--http-url https://gopher.example.org` so public pages carry
canonical metadata. Remote HTTP visitors can pair their own NIP-46 signer or
connect a NIP-07 browser extension. Both require this HTTPS identity boundary;
the direct plaintext deployment remains read-only.

Expose TCP 70 or 7070 for gopher and TCP 1965 for Gemini as required. The
bridge's default high gopher port avoids needing root; use a firewall redirect
or a capable service manager if the public address must use port 70. Never
forward the state directory or a listener onto an internal network.

`GET /healthz` on the HTTP listener returns `200` and `ok`. It does not query a
relay, consume the client rate limit, or require identity. A healthy process
therefore means that the listener is ready, not that every configured Nostr
relay is currently accepting traffic.

SIGTERM and SIGINT stop new connections, allow the listeners to close, close
the relay pool and then exit. The process forces shutdown after ten seconds.

## Container

Build and run the included image:

```sh
docker build -t gopherkind:local .
docker run --name gopherkind --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v gopherkind-state:/var/lib/gopherkind \
  -p 7070:7070 -p 1965:1965 \
  gopherkind:local serve \
  --host 0.0.0.0 --hostname gopher.example.org \
  --state-dir /var/lib/gopherkind \
  --no-local-trust --http-behind-proxy \
  --http-url https://gopher.example.org
```

The container runs as the unprivileged `node` user and includes a health
check. Replace `gopher.example.org` with the address clients actually use;
this is written into gopher menus. The example expects a TLS proxy on the same
private container network. Port 8070 is deliberately not published on the
host. The proxy must preserve `Host`, set `X-Forwarded-Proto: https`, and
replace `X-Forwarded-For` with the single client address. The last rule lets
the bridge rate-limit visitors separately without accepting a spoofed or
ambiguous chain. `--http-behind-proxy` refuses to start without an HTTPS
`--http-url` and `--no-local-trust`. Omit that option and add `--no-identity`
for a direct, read-only plaintext HTTP deployment.

## After deploying a new version

Run through this before calling a deployment done. It is short because most of
it is checking that the thing a release changed is actually reachable.

```sh
curl -fsS https://bridge.example/healthz
curl -fsS https://bridge.example/about | head -20            # http
printf '/about\r\n' | nc bridge.example 70 | head -5         # gopher
gopherkind read gopher://bridge.example/1/                   # the welcome menu
```

Then read one known hole through each enabled frontend, because `/healthz` only
proves the listener is up, not that relays are answering.

A bridge which is new, or whose advertised address has changed, should tell
Nostr clients it exists:

```sh
gopherkind announce --hostname bridge.example \
  --http-url https://bridge.example --dry-run
```

That builds a NIP-89 handler announcement (kind 31990) saying this bridge opens
kind 31436. Drop `--dry-run` to sign and publish it. It needs the same remote
signer as any other write, and it is worth re-running after a hostname or port
change, since the announcement carries the addresses clients will use.

Finally, record what is actually deployed: the release tag and commit at the top
of this document are the only durable statement of what the public bridge is
running, and a stale one is worse than none.

## State, backup and recovery

The state directory contains the generated Gemini TLS key and certificate,
NIP-46 pairing records, and bookmarks. It never contains a user's Nostr
secret key, but the NIP-46 client secrets are still sensitive. Back the
directory up encrypted and do not share it between concurrently running
instances.

For an upgrade, retain the previous image or package and take a state backup.
Stop the old process, start the new one, check `/healthz`, then read one known
hole through each enabled frontend. Rollback is the same operation with the
previous image or package; the on-disk formats are JSON and backward-compatible
within the pre-1.0 series unless a release note explicitly says otherwise.

Relay acceptance is not service health. After publishing, use the publisher's
per-relay acceptance and read-back report as the evidence that documents are
actually retrievable. Re-run the read check later with:

```sh
gopherkind inspect npub1...
gopherkind inspect npub1... --json > inspection.json
```

The inspection discovers the author's current NIP-65 write relays and reports
current, stale and missing documents per relay. JSON output carries a stable
format name, version, check time, summary and per-document copy count. Either
form proves what can be read at that moment, not future retention.

Keep an editable recovery snapshot outside the bridge state directory:

```sh
gopherkind export npub1... /srv/backups/my-hole
```

The snapshot contains ordinary text and kindmap files plus a
`.gopherkind.json` manifest. `gopherkind publish /srv/backups/my-hole`
re-publishes the exact paths, types and titles. A later export refuses to
overwrite a non-empty target unless `--force` is supplied; rotate or copy the
previous snapshot before doing that.
