import path from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { planDirectory, docToTemplate } from '../src/publish.ts'
import { docPath } from '../src/protocol.ts'
import type { HoleStore } from '../src/fetch.ts'

export const sk = generateSecretKey()
export const pubkey = getPublicKey(sk)
export const npub = nip19.npubEncode(pubkey)

export const holeDir = path.join(import.meta.dirname, '..', 'examples', 'hole')
export const authored = planDirectory(holeDir).map((d) =>
  finalizeEvent(docToTemplate(d, 1_754_000_000), sk),
)
const byPath = new Map(authored.map((ev) => [docPath(ev), ev]))

export const note = finalizeEvent(
  { kind: 1, created_at: 1_754_000_100, tags: [], content: 'braying about gopherspace and hay' },
  sk,
)
export const article = finalizeEvent(
  {
    kind: 30023,
    created_at: 1_754_000_200,
    tags: [
      ['d', 'pallasite-lore'],
      ['title', 'Pallasite Lore'],
    ],
    content: 'olivine crystals in iron',
  },
  sk,
)
export const profileEvent = finalizeEvent(
  { kind: 0, created_at: 1_754_000_000, tags: [], content: '{"name":"testdonkey","about":"test hole"}' },
  sk,
)

// Structural stub of HoleStore: everything the router touches, no network.
export function makeStore(): HoleStore {
  return {
    doc: async (pk: string, p: string) => (pk === pubkey ? (byPath.get(p) ?? null) : null),
    hole: async (pk: string) => (pk === pubkey ? authored : []),
    profile: async (pk: string) => (pk === pubkey ? profileEvent : null),
    notes: async (pk: string) => (pk === pubkey ? [note] : []),
    articles: async (pk: string) => (pk === pubkey ? [article] : []),
    article: async (pk: string, d: string) =>
      pk === pubkey && d === 'pallasite-lore' ? article : null,
    event: async (id: string) => (id === note.id ? note : null),
    searchRelays: async () => [],
    close: () => {},
  } as unknown as HoleStore
}
