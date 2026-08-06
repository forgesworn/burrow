import type { Event, EventTemplate } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import type { PairingStore } from './identity.ts'
import { Nip46Client } from './nip46client.ts'

// Where a CLI signature comes from, in priority order:
//   1. GOPHERKIND_BUNKER      one-off bunker URI, no stored pairing
//   2. stored CLI pairing  `gopherkind pair` wrote it to the state dir
// The CLI pairing reuses PairingStore with a fixed key, so the bridge and
// the CLI share one file format.

export const CLI_PAIRING_KEY = 'cli'

export interface CliSigner {
  describe: string
  pubkey(): Promise<string>
  sign(template: EventTemplate): Promise<Event>
}

// Signing with the wrong identity is quiet and hard to undo. A kind 31436
// document is addressable, so publishing one replaces whatever that author had
// at that path: a hole root signed by the wrong key overwrites somebody's front
// page, and the only trace is an npub in the output that looks much like any
// other. Someone holding several keys in one hardware signer can select the
// wrong slot without noticing.
//
// `--as` states the intended author up front. Checking it costs no signature,
// because a NIP-46 get_public_key is not a signing operation, so the wrong
// signer is refused before it is ever asked to sign anything.
export async function requireSignerIdentity(
  signer: CliSigner,
  expected: string | undefined,
): Promise<CliSigner> {
  if (expected === undefined) return signer
  let wanted: string
  try {
    const decoded = nip19.decode(expected)
    if (decoded.type !== 'npub') throw new Error('not an npub')
    wanted = decoded.data
  } catch {
    throw new Error(`--as needs an npub, got: ${expected}`)
  }
  const actual = await signer.pubkey()
  if (actual !== wanted) {
    throw new Error(
      `the signer is ${nip19.npubEncode(actual)}, not ${expected}. Nothing was signed.`,
    )
  }
  return signer
}

export async function bunkerSignerFromUri(uri: string): Promise<CliSigner> {
  const client = new Nip46Client({ allowNip05: true, trustLocalRelays: true })
  const result = await client.pair(uri)
  const pairing = {
    fingerprint: CLI_PAIRING_KEY,
    userPubkey: result.userPubkey,
    clientSecretKey: result.clientSecretKey,
    bunker: result.bunker,
    pairedAt: Math.floor(Date.now() / 1000),
  }
  return {
    describe: 'bunker (GOPHERKIND_BUNKER)',
    pubkey: async () => pairing.userPubkey,
    sign: (tpl) => client.sign(pairing, tpl),
  }
}

export function storedSigner(store: PairingStore): CliSigner | null {
  const pairing = store.get(CLI_PAIRING_KEY)
  if (!pairing) return null
  const client = new Nip46Client()
  return {
    describe: `stored pairing via ${pairing.bunker.relays[0] ?? 'no relay'}`,
    pubkey: async () => pairing.userPubkey,
    sign: (tpl) => client.sign(pairing, tpl),
  }
}

export async function resolveSigner(store: PairingStore): Promise<CliSigner> {
  const bunker = process.env['GOPHERKIND_BUNKER']
  if (bunker !== undefined) return bunkerSignerFromUri(bunker)
  const stored = storedSigner(store)
  if (stored) return stored
  throw new Error(
    'no signer. Either `gopherkind pair bunker://...` once, or set GOPHERKIND_BUNKER.',
  )
}

export async function pairCli(store: PairingStore, uri: string): Promise<string> {
  const result = await new Nip46Client({ allowNip05: true, trustLocalRelays: true }).pair(uri)
  store.set({
    fingerprint: CLI_PAIRING_KEY,
    userPubkey: result.userPubkey,
    clientSecretKey: result.clientSecretKey,
    bunker: result.bunker,
    pairedAt: Math.floor(Date.now() / 1000),
  })
  return result.userPubkey
}
