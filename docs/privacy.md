# Privacy

gopherkind is a durability and authorship tool, not a privacy tool. This page
states exactly what is visible to whom, and what you can do about it. Read it
before you publish or bridge anything sensitive.

## What is public by design

- **Everything served is public.** A gopherhole is signed Nostr events copied
  to relays. Treat publishing here exactly like publishing on a website.
- **Authorship is permanent and linkable.** Documents are signed by a npub.
  That is the point: a hole belongs to a key, not a hostname, and survives any
  server being seized. The cost is that everything one key publishes is
  trivially attributable to that key, forever. If you do not want a hole
  linked to your main identity, generate a dedicated key for it.
- **Gopher is plaintext and unauthenticated.** RFC 1436 has no TLS and no
  credentials. The protocol is read-only, so there is nothing to steal in
  transit, but anyone on the network path can see what a gopher client
  fetches. The Gemini frontend is TLS; the HTTP frontend is whatever you put
  in front of it.

## What relays and bridges can observe

- **Relays see read patterns.** Every document read is a subscription filter
  naming the author and path. A relay you query learns what you read and when,
  plus your IP address unless you proxy. Reading never requires a key, so
  there is at least no reader pubkey to correlate.
- **Relays see your network location** unless you use Tor (below).
- **A bridge is a web server.** It logs what visitors fetch like any other.
  Reading through someone else's bridge means trusting that bridge; reading
  through the terminal client (`gopherkind read`) means trusting only the
  relays you query.

## Mitigations

### Readers: route relay traffic through Tor

```sh
gopherkind read <target> --proxy socks5h://127.0.0.1:9050
# or for everything:
export GOPHERKIND_PROXY=socks5h://127.0.0.1:9050
```

All relay connections — reads, publishes, NIP-46 signing, the bridge's own
fetches — go through the SOCKS5 proxy. Use `socks5h` so DNS resolves at the
proxy; this also makes `wss://....onion` relay URLs usable, which are
otherwise unreachable and rejected. A trusted relay configured as a local
address (a development relay) is still dialled directly, because Tor cannot
reach your loopback.

Choose your read relays deliberately with `--relay`. Querying one relay you
trust (your own, or a paid relay with a no-logging stance) shrinks the set of
parties that see your filters; querying four big public relays broadcasts them.

### Operators: serve the hole as an onion service

Visitors then leave no IP address with the network path, and the hole gets a
second, unseizable address:

```
# torrc
HiddenServiceDir /var/lib/tor/gopherkind/
HiddenServicePort 70 127.0.0.1:7070
HiddenServicePort 80 127.0.0.1:8070
```

Combine with `--host 127.0.0.1` so the frontends answer only on loopback and
the onion address is the only way in.

## What this does not give you

- **Not anonymity.** Tor hides your network location from relays and bridges.
  It does not stop a relay seeing your read filters, and it does not unlink a
  publisher's key from their content.
- **Not metadata resistance against a global observer.** Timing and traffic
  correlation across relays and exits is out of scope.
- **Not secrecy.** There is no access control. NIP-40 expiry asks relays to
  forget; relays are not obliged to comply.

If your threat model needs those properties, you need different tools. This
one is for making sure a document still resolves after every host that ever
served it is gone.
