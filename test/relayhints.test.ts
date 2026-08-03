import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import type { Event, Filter } from 'nostr-tools'
import { safeRelayUrls } from '../src/netguard.ts'
import { parseBurrowmap } from '../src/linemap.ts'
import { resolveMapLines, relayHints } from '../src/resolve.ts'
import { parseClientTarget } from '../src/target.ts'
import { HoleStore, type PoolLike } from '../src/fetch.ts'
import { resolveRoute } from '../src/router.ts'
import { BURROW_KIND, LONG_FORM_KIND } from '../src/protocol.ts'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const npub = nip19.npubEncode(pk)
const now = Math.floor(Date.now() / 1000)

test('safeRelayUrls keeps ws/wss and drops everything else', () => {
  assert.deepEqual(safeRelayUrls(['wss://relay.example', 'ws://plain.example']), [
    'wss://relay.example',
    'ws://plain.example',
  ])
  // internal addresses, wrong schemes and junk are all refused
  assert.deepEqual(
    safeRelayUrls([
      'wss://127.0.0.1',
      'wss://10.0.0.1:4869',
      'wss://[::1]',
      'http://relay.example',
      'javascript:alert(1)',
      'not a url',
    ]),
    [],
  )
})

test('safeRelayUrls dedupes, caps and rejects absurd input', () => {
  assert.deepEqual(safeRelayUrls(['wss://a.example', 'wss://a.example/']), ['wss://a.example'])
  const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((h) => `wss://${h}.example`)
  assert.equal(safeRelayUrls(many).length, 4)
  assert.deepEqual(safeRelayUrls(undefined), [])
  assert.deepEqual(safeRelayUrls([`wss://${'x'.repeat(300)}.example`]), [])
})

test('a burrowmap naddr link carries its relay hints', () => {
  const naddr = nip19.naddrEncode({
    kind: BURROW_KIND,
    pubkey: pk,
    identifier: '/notes',
    relays: ['wss://their.example', 'wss://127.0.0.1'],
  })
  const items = resolveMapLines(parseBurrowmap(`1Their notes\tnostr:${naddr}`), 'npub1owner')
  const target = items[0]?.target
  assert.equal(target?.scheme, 'hole')
  assert.deepEqual(target?.scheme === 'hole' ? target.relays : null, ['wss://their.example'])
  // and they are collectable, keyed by npub, for the store to remember
  assert.deepEqual([...relayHints(items)], [[npub, ['wss://their.example']]])
})

test('an article naddr and an nprofile carry hints too', () => {
  const article = nip19.naddrEncode({
    kind: LONG_FORM_KIND,
    pubkey: pk,
    identifier: 'my-post',
    relays: ['wss://blog.example'],
  })
  const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://who.example'] })
  const items = resolveMapLines(
    parseBurrowmap(`0Post\t${article}\n1Them\t${nprofile}`),
    'npub1owner',
  )
  const [a, b] = items
  assert.deepEqual(a?.target.scheme === 'hole' ? a.target.relays : null, ['wss://blog.example'])
  assert.deepEqual(b?.target.scheme === 'hole' ? b.target.relays : null, ['wss://who.example'])
})

test('a link with no usable hint has no relays field at all', () => {
  const naddr = nip19.naddrEncode({ kind: BURROW_KIND, pubkey: pk, identifier: '/a', relays: [] })
  const items = resolveMapLines(parseBurrowmap(`1A\t${naddr}`), 'npub1owner')
  assert.deepEqual(items[0]?.target, { scheme: 'hole', npub, path: '/a' })
  assert.equal(relayHints(items).size, 0)
})

test('client targets carry hints, and a hintless one is unchanged', () => {
  const nprofile = nip19.nprofileEncode({ pubkey: pk, relays: ['wss://hint.example'] })
  assert.deepEqual(parseClientTarget(`nostr:${nprofile}/notes`), {
    kind: 'hole',
    pubkey: pk,
    npub,
    path: '/notes',
    relays: ['wss://hint.example'],
  })
  const bare = nip19.nprofileEncode({ pubkey: pk, relays: [] })
  assert.deepEqual(parseClientTarget(bare), { kind: 'hole', pubkey: pk, npub, path: '/' })
})

function fakePool(handler: (filter: Filter) => Event[]): PoolLike & { relaysSeen: string[][] } {
  const relaysSeen: string[][] = []
  return {
    relaysSeen,
    async querySync(relays: string[], filter: Filter) {
      relaysSeen.push(relays)
      return handler(filter)
    },
    publish: (relays: string[]) => relays.map(() => Promise.resolve('ok')),
    async ensureRelay() {
      return { onnotice: () => {} }
    },
    destroy() {},
  }
}

test('a remembered hint widens the read set for that author', async () => {
  const pool = fakePool(() => [])
  const store = new HoleStore(['wss://bridge'], pool)
  store.addRelayHints(pk, ['wss://hinted.example'])
  await store.doc(pk, '/')
  assert.ok(
    pool.relaysSeen.every((r) => r.includes('wss://bridge')),
    'the bridge relays are always kept',
  )
  assert.ok(
    pool.relaysSeen.some((r) => r.includes('wss://hinted.example')),
    'the hinted relay should be queried',
  )
})

test('hints for one author do not leak into another author read', async () => {
  const other = getPublicKey(generateSecretKey())
  const pool = fakePool(() => [])
  const store = new HoleStore(['wss://bridge'], pool)
  store.addRelayHints(pk, ['wss://hinted.example'])
  await store.notes(other)
  assert.ok(pool.relaysSeen.every((r) => !r.includes('wss://hinted.example')))
})

test('hints per author are capped', async () => {
  const pool = fakePool(() => [])
  const store = new HoleStore(['wss://bridge'], pool)
  store.addRelayHints(pk, ['a', 'b', 'c', 'd', 'e', 'f'].map((h) => `wss://${h}.example`))
  await store.doc(pk, '/')
  const widest = pool.relaysSeen.reduce((a, b) => (a.length > b.length ? a : b))
  assert.equal(widest.length, 5, 'one bridge relay plus at most four hints')
})

test('rendering a menu teaches the store where the linked hole lives', async () => {
  const naddr = nip19.naddrEncode({
    kind: BURROW_KIND,
    pubkey: pk,
    identifier: '/notes',
    relays: ['wss://their.example'],
  })
  const owner = generateSecretKey()
  const ownerPk = getPublicKey(owner)
  const menu = finalizeEvent(
    {
      kind: BURROW_KIND,
      created_at: now,
      tags: [
        ['d', '/'],
        ['type', '1'],
      ],
      content: `1Their notes\tnostr:${naddr}`,
    },
    owner,
  )
  const pool = fakePool((f) => (f.authors?.includes(ownerPk) ? [menu] : []))
  const store = new HoleStore(['wss://bridge'], pool)
  await resolveRoute(
    { kind: 'doc', pubkey: ownerPk, npub: nip19.npubEncode(ownerPk), path: '/' },
    store,
    { virtual: false },
  )
  // following the link now reads the linked author from the relay they named
  await store.doc(pk, '/notes')
  assert.ok(pool.relaysSeen.some((r) => r.includes('wss://their.example')))
})
