import path from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { planDirectory, docToTemplate } from '../src/publish.ts'
import { docPath } from '../src/protocol.ts'
import type { HoleStore } from '../src/fetch.ts'
import type { CliSigner } from '../src/signing.ts'

export const sk = generateSecretKey()
export const pubkey = getPublicKey(sk)
export const npub = nip19.npubEncode(pubkey)
export const testSigner: CliSigner = {
  describe: 'test remote signer',
  pubkey: async () => pubkey,
  sign: async (template) => finalizeEvent(template, sk),
}

export const holeDir = path.join(import.meta.dirname, '..', 'examples', 'hole')
const directoryDocs = planDirectory(holeDir).map((d) =>
  finalizeEvent(docToTemplate(d, 1_754_000_000), sk),
)
export const searchDoc = finalizeEvent(
  docToTemplate(
    {
      path: '/search',
      type: '0',
      title: 'An authored search document',
      content: 'not an endpoint\n',
    },
    1_754_000_001,
  ),
  sk,
)
export const spaceDoc = finalizeEvent(
  docToTemplate(
    { path: '/a b', type: '0', title: 'Space', content: 'space path\n' },
    1_754_000_002,
  ),
  sk,
)
export const percentDoc = finalizeEvent(
  docToTemplate(
    { path: '/a%20b', type: '0', title: 'Percent', content: 'literal percent path\n' },
    1_754_000_003,
  ),
  sk,
)
export const authored = [...directoryDocs, searchDoc, spaceDoc, percentDoc]
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
  {
    kind: 0,
    created_at: 1_754_000_000,
    tags: [],
    content: '{"name":"testdonkey","about":"test hole"}',
  },
  sk,
)

// Structural stub of HoleStore: everything the router and the gemini
// account routes touch, no network. published collects store.publish calls.
export function makeStore(published: unknown[] = []): HoleStore {
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
    contacts: async (pk: string) => (pk === pubkey ? [pubkey] : []),
    followers: async (pk: string) => (pk === pubkey ? [pubkey] : []),
    feedNotes: async (pks: string[]) => (pks.includes(pubkey) ? [note] : []),
    profilesBatch: async (pks: string[]) =>
      new Map(pks.includes(pubkey) ? [[pubkey, profileEvent]] : []),
    publish: async (ev: unknown) => {
      published.push(ev)
      return 3
    },
    close: () => {},
  } as unknown as HoleStore
}
