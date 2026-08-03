// Refuse to broadcast anything that looks like a credential. A remote
// signer will happily sign a note containing your own bunker secret, and
// relays do not forget. The /pair and /post inputs sit two lines apart in
// the UI, so this guard is not hypothetical.

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\bbunker:\/\//i, what: 'a bunker:// URI' },
  { re: /\bnostrconnect:\/\//i, what: 'a nostrconnect:// URI' },
  { re: /\bnsec1[02-9ac-hj-np-z]{20,}/i, what: 'an nsec private key' },
  { re: /\bncryptsec1[02-9ac-hj-np-z]{20,}/i, what: 'an encrypted private key' },
  { re: /\bsecret=[0-9a-f]{32,}/i, what: 'a secret token' },
  { re: /\b[0-9a-f]{64}\b.*\bsecret\b/i, what: 'a secret token' },
]

export function findSecret(content: string): string | null {
  for (const { re, what } of PATTERNS) if (re.test(content)) return what
  return null
}
