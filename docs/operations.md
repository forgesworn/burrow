# Operating a gopherkind bridge

The safe default is local-only: `gopherkind serve` binds all three listeners
to `127.0.0.1`. Exposing a bridge is an explicit operator decision.

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
operator. Remote HTTP visitors can still pair their own NIP-46 signer.

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
  -p 7070:7070 -p 1965:1965 -p 8070:8070 \
  gopherkind:local serve \
  --host 0.0.0.0 --hostname gopher.example.org \
  --state-dir /var/lib/gopherkind
```

The container runs as the unprivileged `node` user and includes a health
check. Replace `gopher.example.org` with the address clients actually use;
this is written into gopher menus. Its public bind deliberately makes HTTP
read-only: session identity is disabled rather than accepting credentials over
plaintext. To offer remote HTTP sign-in, run the process and TLS proxy in the
same network namespace, bind gopherkind to loopback, and use
`--no-local-trust` as in the native example.

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
actually retrievable.
