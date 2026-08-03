// Refuse to broadcast anything that looks like a credential. A remote
// signer will happily sign a note containing your own bunker secret, and
// relays do not forget. The /pair and /post inputs sit two lines apart in
// the UI, so this guard is not hypothetical.

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\bbunker:\/\//i, what: 'a bunker:// URI' },
  { re: /\bnostrconnect:\/\//i, what: 'a nostrconnect:// URI' },
  { re: /\bnsec1[02-9ac-hj-np-z]{20,}/i, what: 'an nsec private key' },
  { re: /\bncryptsec1[02-9ac-hj-np-z]{20,}/i, what: 'an encrypted private key' },
  { re: /\bsecret=[0-9a-f]{8,}/i, what: 'a secret token' },
  // A 64-hex string next to the word "secret" or "nsec"/"key": a bare 64-hex
  // is not flagged on its own because event ids and pubkeys share that shape
  // and are pasted legitimately, but in a key context it is almost certainly
  // a raw private key (decodeSecret accepts exactly that form).
  { re: /\b(?:secret|priv(?:ate)?[ _-]?key|nsec)\b[^0-9a-f]{0,12}[0-9a-f]{64}\b/i, what: 'a private key' },
  { re: /\b[0-9a-f]{64}\b[^0-9a-f]{0,12}(?:secret|priv(?:ate)?[ _-]?key|nsec)\b/i, what: 'a private key' },
]

export function findSecret(content: string): string | null {
  // Normalise away zero-width and format characters that could split a match.
  const normalised = content.normalize('NFKC').replace(/[​-‍⁠﻿­]/g, '')
  for (const { re, what } of PATTERNS) if (re.test(normalised)) return what
  return null
}
