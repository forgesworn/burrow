# Security policy

burrow's whole premise is key hygiene: the bridge never holds a user key,
signing is always remote over NIP-46, and disk state is limited to the Gemini
TLS cert and a mode-600 `pairings.json`. Reports that undermine those
properties are taken seriously.

## Reporting a vulnerability

Please report privately, not in a public issue:

- Open a [GitHub security advisory](https://github.com/forgesworn/burrow/security/advisories/new), or
- Zap or DM `npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2` on Nostr.

Include a description, affected version or commit, and a proof of concept if
you have one. burrow is unfunded hobby work, so there is no bounty, but credit
is given in the changelog unless you prefer otherwise.

## In scope

- Anything that gets a user key onto the bridge, or has it signed without
  the user's intent (CSRF, request forgery, the credential guard).
- Escaping a hole's selector namespace, or injecting into a wire format
  (gopher menus, gemtext, HTML).
- Reaching the loopback operator surface from a remote client (source-IP
  spoofing, DNS rebinding, reverse-proxy confusion).
- SSRF through the gopher proxy or the NIP-46 pairing flow.
- Serving content that should not be served (expired NIP-40 events).

## Out of scope

- Relays ignoring NIP-09 deletion requests: this is documented behaviour,
  not a bug. Use NIP-40 `expiration` for content that must stop being served.
- Gopher being plaintext and unauthenticated: it is read-only by design and
  never accepts credentials.
- Denial of service from a single well-resourced client beyond the per-IP
  token bucket.

## Deployment notes that are security-relevant

- The HTTP frontend trusts loopback as the operator. Behind a reverse proxy
  every request originates on loopback, so operator trust is disabled unless
  the bridge is bound to a loopback address (or you pass
  `--trust-loopback-anyway`). Put the frontend behind TLS before exposing it.
- The gopher proxy refuses to connect to private, loopback and link-local
  ranges. Do not re-expose it to internal networks.
