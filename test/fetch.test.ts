import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event, Filter } from 'nostr-tools'
import { HoleStore, type PoolLike } from '../src/fetch.ts'
import { BURROW_KIND, NOTE_KIND, RELAY_LIST_KIND } from '../src/protocol.ts'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const now = Math.floor(Date.now() / 1000)

function ev(partial: Partial<Event> & { kind: number }): Event {
  return finalizeEvent(
    {
      kind: partial.kind,
      created_at: partial.created_at ?? now,
      tags: partial.tags ?? [],
      content: partial.content ?? '',
    },
    sk,
  )
}

// A fake pool that answers querySync from a per-kind handler and records the
// relay set each query was sent to.
function fakePool(byKind: (filter: Filter) => Event[]): PoolLike & { relaysSeen: string[][] } {
  const relaysSeen: string[][] = []
  return {
    relaysSeen,
    async querySync(relays: string[], filter: Filter) {
      relaysSeen.push(relays)
      return byKind(filter)
    },
    publish: (relays: string[]) => relays.map(() => Promise.resolve('ok')),
    async ensureRelay() {
      return { onnotice: () => {} }
    },
    destroy() {},
  }
}

test('expired events are never served (notes and single event)', async () => {
  const fresh = ev({ kind: NOTE_KIND, content: 'alive' })
  const stale = ev({ kind: NOTE_KIND, content: 'gone', tags: [['expiration', String(now - 10)]] })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool((f) => (f.ids ? [stale] : [fresh, stale])),
  )
  const notes = await store.notes(pk)
  assert.equal(notes.length, 1)
  assert.equal(notes[0]?.content, 'alive')
  // a single expired event by id resolves to null, not its body
  assert.equal(await store.event(stale.id), null)
})

test('doc resolves the newest event, lowest id on a tie', async () => {
  const older = ev({
    kind: BURROW_KIND,
    created_at: now - 100,
    tags: [
      ['d', '/a'],
      ['type', '0'],
    ],
    content: 'old',
  })
  const newer = ev({
    kind: BURROW_KIND,
    created_at: now,
    tags: [
      ['d', '/a'],
      ['type', '0'],
    ],
    content: 'new',
  })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool(() => [older, newer]),
  )
  const got = await store.doc(pk, '/a')
  assert.equal(got?.content, 'new')
})

test('a hole reads from the author write relays (NIP-65), not just the bridge', async () => {
  const relayList = ev({
    kind: RELAY_LIST_KIND,
    tags: [
      ['r', 'wss://author.example'],
      ['r', 'wss://read.only.example', 'read'],
    ],
  })
  const doc = ev({
    kind: BURROW_KIND,
    tags: [
      ['d', '/'],
      ['type', '1'],
    ],
    content: 'iHi',
  })
  const pool = fakePool((f) => (f.kinds?.includes(RELAY_LIST_KIND) ? [relayList] : [doc]))
  const store = new HoleStore(['wss://bridge'], pool)
  await store.doc(pk, '/')
  // the burrow-doc query must have gone to bridge + author write relay, and
  // must not include the author's read-only relay
  const docQuery = pool.relaysSeen.find((r) => r.includes('wss://author.example'))
  assert.ok(docQuery, 'author write relay should be queried')
  assert.ok(docQuery?.includes('wss://bridge'))
  assert.ok(!docQuery?.includes('wss://read.only.example'))
})

test('query failures degrade to an empty result, not a throw', async () => {
  const store = new HoleStore(['wss://bridge'], {
    async querySync() {
      throw new Error('relay down')
    },
    publish: () => [],
    async ensureRelay() {
      return { onnotice: () => {} }
    },
    destroy() {},
  })
  assert.deepEqual(await store.notes(pk), [])
})
