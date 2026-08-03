import type { Event, EventTemplate } from 'nostr-tools'
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
