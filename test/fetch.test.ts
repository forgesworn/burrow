import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event, Filter } from 'nostr-tools'
import { HoleStore, type PoolLike } from '../src/fetch.ts'
import { DOC_KIND, NOTE_KIND, RELAY_LIST_KIND } from '../src/protocol.ts'

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
    kind: DOC_KIND,
    created_at: now - 100,
    tags: [
      ['d', '/a'],
      ['type', '0'],
    ],
    content: 'old',
  })
  const newer = ev({
    kind: DOC_KIND,
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

test('an expired winning document does not resurrect an older revision', async () => {
  const older = ev({
    kind: DOC_KIND,
    created_at: now - 100,
    tags: [
      ['d', '/a'],
      ['type', '0'],
    ],
    content: 'must stay replaced',
  })
  const expiredWinner = ev({
    kind: DOC_KIND,
    created_at: now,
    tags: [
      ['d', '/a'],
      ['type', '0'],
      ['expiration', String(now - 1)],
    ],
    content: 'expired winner',
  })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool(() => [older, expiredWinner]),
  )
  assert.equal(await store.doc(pk, '/a'), null)
  assert.deepEqual(await store.hole(pk), [])
})

test('malformed documents are absent rather than becoming root', async () => {
  const missingD = ev({ kind: DOC_KIND, tags: [['type', '1']], content: 'iHostile root' })
  const duplicateD = ev({
    kind: DOC_KIND,
    tags: [
      ['d', '/'],
      ['d', '/other'],
      ['type', '1'],
    ],
  })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool(() => [missingD, duplicateD]),
  )
  assert.equal(await store.doc(pk, '/'), null)
  assert.deepEqual(await store.hole(pk), [])
})

test('a malformed winning document does not reveal an older valid revision', async () => {
  const older = ev({
    kind: DOC_KIND,
    created_at: now - 100,
    tags: [
      ['d', '/a'],
      ['type', '0'],
    ],
    content: 'must stay replaced',
  })
  const malformedWinner = ev({
    kind: DOC_KIND,
    created_at: now,
    tags: [
      ['d', '/a'],
      ['type', '9'],
    ],
    content: 'invalid winner',
  })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool(() => [older, malformedWinner]),
  )
  assert.equal(await store.doc(pk, '/a'), null)
  assert.deepEqual(await store.hole(pk), [])
})

test('a cached document disappears at its expiration time', async () => {
  const expiration = Math.floor(Date.now() / 1000) + 1
  const temporary = ev({
    kind: DOC_KIND,
    tags: [
      ['d', '/temporary'],
      ['type', '0'],
      ['expiration', String(expiration)],
    ],
    content: 'briefly here',
  })
  const store = new HoleStore(
    ['wss://bridge'],
    fakePool(() => [temporary]),
  )
  assert.equal((await store.doc(pk, '/temporary'))?.id, temporary.id)
  assert.equal((await store.hole(pk)).length, 1)
  await delay(Math.max(expiration * 1000 - Date.now() + 20, 20))
  assert.equal(await store.doc(pk, '/temporary'), null)
  assert.deepEqual(await store.hole(pk), [])
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
    kind: DOC_KIND,
    tags: [
      ['d', '/'],
      ['type', '1'],
    ],
    content: 'iHi',
  })
  const pool = fakePool((f) => (f.kinds?.includes(RELAY_LIST_KIND) ? [relayList] : [doc]))
  const store = new HoleStore(['wss://bridge'], pool)
  await store.doc(pk, '/')
  // the gopherkind-doc query must have gone to bridge + author write relay, and
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
