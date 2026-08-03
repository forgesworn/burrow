import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import type { Event, Filter } from 'nostr-tools'
import { matchVirtualPath, PAGE, PEOPLE_PAGE } from '../src/virtual.ts'
import { HoleStore, type PoolLike } from '../src/fetch.ts'
import { resolveRoute, type Content } from '../src/router.ts'
import { NOTE_KIND, CONTACTS_KIND, LONG_FORM_KIND, tagValue } from '../src/protocol.ts'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const npub = nip19.npubEncode(pk)
const now = Math.floor(Date.now() / 1000)

test('cursor paths parse, and permalinks still win', () => {
  const id = 'b'.repeat(64)
  assert.deepEqual(matchVirtualPath('/notes'), { kind: 'notes' })
  assert.deepEqual(matchVirtualPath(`/notes/before/1700000000/${id}`), {
    kind: 'notes',
    before: { createdAt: 1700000000, id },
  })
  assert.deepEqual(matchVirtualPath(`/notes/${'a'.repeat(64)}`), {
    kind: 'note',
    id: 'a'.repeat(64),
  })
  assert.deepEqual(matchVirtualPath(`/articles/before/42/${id}`), {
    kind: 'articles',
    before: { createdAt: 42, id },
  })
  assert.deepEqual(matchVirtualPath('/follows/from/200'), { kind: 'follows', from: 200 })
  assert.deepEqual(matchVirtualPath('/followers/from/0'), { kind: 'followers', from: 0 })
  // junk cursors are not paths, not pages
  assert.equal(matchVirtualPath('/notes/before/abc'), null)
  assert.equal(matchVirtualPath(`/notes/before/12345678901/${id}`), null)
  assert.equal(matchVirtualPath('/articles/before-2024'), null)
  assert.equal(matchVirtualPath('/follows/from/x'), null)
})

function note(created_at: number, content: string): Event {
  return finalizeEvent({ kind: NOTE_KIND, created_at, tags: [], content }, sk)
}

function article(created_at: number, d: string): Event {
  return finalizeEvent({ kind: LONG_FORM_KIND, created_at, tags: [['d', d]], content: d }, sk)
}

function fakePool(handler: (filter: Filter) => Event[]): PoolLike & { filters: Filter[] } {
  const filters: Filter[] = []
  return {
    filters,
    async querySync(_relays: string[], filter: Filter) {
      filters.push(filter)
      return handler(filter)
    },
    publish: (relays: string[]) => relays.map(() => Promise.resolve('ok')),
    async ensureRelay() {
      return { onnotice: () => {} }
    },
    destroy() {},
  }
}

function menuLinks(content: Content): string[] {
  if (content.kind !== 'menu') return []
  return content.items.flatMap((i) => (i.target.scheme === 'hole' ? [i.target.path] : []))
}

// One note per second, newest first, so a page boundary is unambiguous.
const stream = Array.from({ length: 60 }, (_, i) => note(now - i, `note ${i}`))

test('a full notes page offers the next one, and the cursor advances', async () => {
  const pool = fakePool((f) => {
    if (!f.kinds?.includes(NOTE_KIND)) return []
    const until = f.until ?? Infinity
    return stream.filter((ev) => ev.created_at <= until)
  })
  const store = new HoleStore(['wss://bridge'], pool)
  const first = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/notes' }, store, {
    virtual: true,
  })
  const links = menuLinks(first)
  assert.equal(links.filter((p) => p.startsWith('/notes/before/')).length, 1, 'one older link')
  const cursor = links.find((p) => p.startsWith('/notes/before/')) as string
  // the cursor is the oldest note on this page
  assert.equal(cursor, `/notes/before/${now - (PAGE - 1)}/${stream[PAGE - 1]?.id}`)

  const second = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: cursor }, store, {
    virtual: true,
  })
  const secondLinks = menuLinks(second)
  assert.ok(secondLinks.includes('/notes'), 'a way back to the latest')
  // no overlap: the boundary note does not appear twice
  const firstIds = new Set(links.filter((p) => /^\/notes\/[0-9a-f]{64}$/.test(p)))
  const secondIds = secondLinks.filter((p) => /^\/notes\/[0-9a-f]{64}$/.test(p))
  assert.equal(secondIds.length, PAGE)
  assert.ok(
    secondIds.every((id) => !firstIds.has(id)),
    'pages must not repeat a note',
  )
})

test('a composite cursor keeps events that share the boundary second', async () => {
  const sameSecond = Array.from({ length: PAGE + 10 }, (_, i) => note(now, `same ${i}`))
  const pool = fakePool((f) => (f.kinds?.includes(NOTE_KIND) ? sameSecond : []))
  const store = new HoleStore(['wss://bridge'], pool)
  const first = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/notes' }, store, {
    virtual: true,
  })
  const firstLinks = menuLinks(first)
  const cursor = firstLinks.find((p) => p.startsWith('/notes/before/')) as string
  const second = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: cursor }, store, {
    virtual: true,
  })
  const noteLinks = [...firstLinks, ...menuLinks(second)].filter((p) =>
    /^\/notes\/[0-9a-f]{64}$/.test(p),
  )
  assert.equal(noteLinks.length, sameSecond.length)
  assert.equal(new Set(noteLinks).size, sameSecond.length)
})

test('a short page offers no older link', async () => {
  const few = stream.slice(0, 3)
  const pool = fakePool((f) => (f.kinds?.includes(NOTE_KIND) ? few : []))
  const store = new HoleStore(['wss://bridge'], pool)
  const content = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/notes' }, store, {
    virtual: true,
  })
  assert.equal(menuLinks(content).filter((p) => p.startsWith('/notes/before/')).length, 0)
})

test('article pagination cannot resurrect an older addressable revision', async () => {
  const winner = article(now, 'revised')
  const middle = Array.from({ length: PAGE }, (_, index) =>
    article(now - index - 1, `article-${index}`),
  )
  const replaced = article(now - 100, 'revised')
  const all = [winner, ...middle, replaced]
  const pool = fakePool((filter) => {
    if (!filter.kinds?.includes(LONG_FORM_KIND)) return []
    const until = filter.until ?? Infinity
    return all.filter((event) => event.created_at <= until)
  })
  const store = new HoleStore(['wss://bridge'], pool)
  const first = await store.articles(pk)
  const boundary = first.at(-1)
  assert.ok(boundary)
  const second = await store.articles(pk, { createdAt: boundary.created_at, id: boundary.id })
  assert.deepEqual(
    second.map((event) => tagValue(event, 'd')),
    ['article-19'],
  )
  const articleFilters = pool.filters.filter((filter) => filter.kinds?.includes(LONG_FORM_KIND))
  assert.ok(articleFilters.some((filter) => filter.until === boundary.created_at))
  assert.ok(articleFilters.some((filter) => filter['#d']?.includes('revised')))
})

test('a long follow list pages instead of being silently cut off', async () => {
  const others = Array.from({ length: PEOPLE_PAGE + 30 }, () => getPublicKey(generateSecretKey()))
  const contacts = finalizeEvent(
    {
      kind: CONTACTS_KIND,
      created_at: now,
      tags: others.map((p) => ['p', p]),
      content: '',
    },
    sk,
  )
  const pool = fakePool((f) => (f.kinds?.includes(CONTACTS_KIND) ? [contacts] : []))
  const store = new HoleStore(['wss://bridge'], pool)
  const first = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/follows' }, store, {
    virtual: true,
  })
  assert.ok(first.kind === 'menu')
  assert.ok(
    first.items.some((i) => i.display === `showing 1-${PEOPLE_PAGE} of ${others.length}`),
    'the page says where it is in the list',
  )
  const more = menuLinks(first).find((p) => p.startsWith('/follows/from/'))
  assert.equal(more, `/follows/from/${PEOPLE_PAGE}`)

  const second = await resolveRoute(
    { kind: 'doc', pubkey: pk, npub, path: more as string },
    store,
    {
      virtual: true,
    },
  )
  assert.ok(second.kind === 'menu')
  assert.ok(second.items.some((i) => i.display === `showing ${PEOPLE_PAGE + 1}-230 of 230`))
  assert.ok(menuLinks(second).includes('/follows'), 'a way back to the start')
  assert.equal(menuLinks(second).filter((p) => p.startsWith('/follows/from/')).length, 0)
})

test('a short follow list gets no pagination furniture at all', async () => {
  const contacts = finalizeEvent(
    {
      kind: CONTACTS_KIND,
      created_at: now,
      tags: [['p', getPublicKey(generateSecretKey())]],
      content: '',
    },
    sk,
  )
  const pool = fakePool((f) => (f.kinds?.includes(CONTACTS_KIND) ? [contacts] : []))
  const store = new HoleStore(['wss://bridge'], pool)
  const content = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/follows' }, store, {
    virtual: true,
  })
  assert.ok(content.kind === 'menu')
  assert.ok(!content.items.some((i) => i.display.startsWith('showing ')))
})

test('people are sorted before the page offset is applied', async () => {
  const pubkeys = Array.from({ length: PEOPLE_PAGE + 1 }, () => getPublicKey(generateSecretKey()))
  const profiles = new Map(
    pubkeys.map((pubkey, index) => [
      pubkey,
      finalizeEvent(
        {
          kind: 0,
          created_at: now,
          tags: [],
          content: JSON.stringify({ name: index === PEOPLE_PAGE ? '000 first' : `z ${index}` }),
        },
        sk,
      ),
    ]),
  )
  const store = {
    doc: async () => null,
    contacts: async () => pubkeys,
    profilesBatch: async () => profiles,
  } as unknown as HoleStore
  const content = await resolveRoute({ kind: 'doc', pubkey: pk, npub, path: '/follows' }, store, {
    virtual: true,
  })
  assert.equal(content.kind, 'menu')
  if (content.kind === 'menu') {
    const firstPerson = content.items.find((item) => item.target.scheme === 'hole')
    assert.equal(firstPerson?.display, '000 first')
  }
})

test('a cursor page is not served when virtual holes are off', async () => {
  const pool = fakePool(() => [])
  const store = new HoleStore(['wss://bridge'], pool)
  const content = await resolveRoute(
    {
      kind: 'doc',
      pubkey: pk,
      npub,
      path: `/notes/before/1700000000/${'a'.repeat(64)}`,
    },
    store,
    { virtual: false },
  )
  assert.equal(content.kind, 'error')
})
