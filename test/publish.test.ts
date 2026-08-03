import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  planDirectory,
  docToTemplate,
  parseDuration,
  planDeletion,
  publishDocument,
  publishHole,
  unpublishHole,
  type PublishPool,
} from '../src/publish.ts'
import { generateSecretKey, finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { Event, EventTemplate, Filter } from 'nostr-tools'
import type { CliSigner } from '../src/signing.ts'
import { DOC_KIND, RELAY_LIST_KIND } from '../src/protocol.ts'

function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-test-'))
  writeFileSync(path.join(dir, 'index.map'), 'iWelcome\n0About\t/about.txt\n')
  writeFileSync(path.join(dir, 'about.txt'), 'hello\n')
  writeFileSync(path.join(dir, '.secret'), 'skip me\n')
  mkdirSync(path.join(dir, 'phlog'))
  writeFileSync(path.join(dir, 'phlog', 'index.map'), '0First post\t/phlog/first.txt\n')
  writeFileSync(path.join(dir, 'phlog', 'first.txt'), 'post body\n')
  writeFileSync(path.join(dir, 'links.map'), '1Elsewhere\tgopher://sdf.org/1/\n')
  return dir
}

test('planDirectory maps files to documents', () => {
  const dir = fixture()
  try {
    const docs = planDirectory(dir)
    const byPath = new Map(docs.map((d) => [d.path, d]))
    assert.deepEqual([...byPath.keys()].sort(), [
      '/',
      '/about.txt',
      '/links',
      '/phlog',
      '/phlog/first.txt',
    ])
    assert.equal(byPath.get('/')?.type, '1')
    assert.equal(byPath.get('/phlog')?.type, '1')
    assert.equal(byPath.get('/links')?.type, '1')
    assert.equal(byPath.get('/about.txt')?.type, '0')
    assert.equal(byPath.get('/phlog/first.txt')?.content, 'post body\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docToTemplate carries d, type and title tags', () => {
  const tpl = docToTemplate({ path: '/x.txt', type: '0', title: 'x.txt', content: 'hi' }, 1234)
  assert.equal(tpl.kind, 31436)
  assert.equal(tpl.created_at, 1234)
  assert.deepEqual(tpl.tags, [
    ['d', '/x.txt'],
    ['type', '0'],
    ['title', 'x.txt'],
  ])
})

test('docToTemplate refuses invalid identifiers and titles', () => {
  assert.throws(() => docToTemplate({ path: '/a/', type: '0', title: 'a', content: '' }, 1234))
  assert.throws(() =>
    docToTemplate({ path: '/a', type: '0', title: 'bad\nname', content: '' }, 1234),
  )
})

test('parseDuration understands s/m/h/d/w, rejects junk', () => {
  assert.equal(parseDuration('45s'), 45)
  assert.equal(parseDuration('90m'), 5400)
  assert.equal(parseDuration('12h'), 43_200)
  assert.equal(parseDuration('30d'), 2_592_000)
  assert.equal(parseDuration('2w'), 1_209_600)
  assert.throws(() => parseDuration('5x'))
  assert.throws(() => parseDuration('soon'))
})

test('docToTemplate adds an expiration tag when asked', () => {
  const tpl = docToTemplate({ path: '/x', type: '0', title: 'x', content: 'c' }, 1000, 60)
  assert.deepEqual(tpl.tags.at(-1), ['expiration', '1060'])
})

test('planDeletion covers each document with e and a tags', () => {
  const sk = generateSecretKey()
  const doc = finalizeEvent(
    docToTemplate({ path: '/x.txt', type: '0', title: 'x', content: 'c' }, 1000),
    sk,
  )
  const del = planDeletion([doc], 2000)
  assert.equal(del.kind, 5)
  assert.equal(del.created_at, 2000)
  assert.ok(del.tags.some((t) => t[0] === 'k' && t[1] === '31436'))
  assert.ok(del.tags.some((t) => t[0] === 'e' && t[1] === doc.id))
  assert.ok(del.tags.some((t) => t[0] === 'a' && t[1] === `31436:${doc.pubkey}:/x.txt`))
})

class FakePool implements PublishPool {
  readonly published = new Map<string, Event[]>()
  destroyed = false
  private readonly relayList: Event | null
  private readonly rejectDocs: boolean
  private readonly hideReadback: boolean

  constructor(
    relayList: Event | null,
    rejectDocs = false,
    initial: Event[] = [],
    hideReadback = false,
  ) {
    this.relayList = relayList
    this.rejectDocs = rejectDocs
    this.hideReadback = hideReadback
    for (const event of initial) this.published.set('wss://author.example', [event])
  }

  async querySync(relays: string[], filter: Filter): Promise<Event[]> {
    if (filter.kinds?.includes(RELAY_LIST_KIND))
      return this.relayList === null ? [] : [this.relayList]
    const events = relays.flatMap((relay) => this.published.get(relay) ?? [])
    if (filter.ids) {
      return this.hideReadback ? [] : events.filter((event) => filter.ids?.includes(event.id))
    }
    return events.filter(
      (event) =>
        (filter.kinds === undefined || filter.kinds.includes(event.kind)) &&
        (filter.authors === undefined || filter.authors.includes(event.pubkey)),
    )
  }

  publish(relays: string[], event: Event): Promise<string>[] {
    return relays.map(async (relay) => {
      if (this.rejectDocs && event.kind === DOC_KIND) throw new Error('rejected')
      const events = this.published.get(relay) ?? []
      events.push(event)
      this.published.set(relay, events)
      return 'ok'
    })
  }

  destroy(): void {
    this.destroyed = true
  }
}

function signerFor(secret: Uint8Array): CliSigner {
  return {
    describe: 'test remote signer',
    pubkey: async () => getPublicKey(secret),
    sign: async (template: EventTemplate) => finalizeEvent(template, secret),
  }
}

test('publish follows the author NIP-65 write set, spreads it and verifies read-back', async () => {
  const dir = fixture()
  const secret = generateSecretKey()
  const relayList = finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: 1000,
      tags: [['r', 'wss://author.example', 'write']],
      content: '',
    },
    secret,
  )
  const pool = new FakePool(relayList)
  try {
    await publishHole(dir, ['wss://configured.example'], signerFor(secret), { pool })
    for (const relay of ['wss://configured.example', 'wss://author.example']) {
      const events = pool.published.get(relay) ?? []
      assert.ok(
        events.some((event) => event.id === relayList.id),
        `${relay} should get NIP-65`,
      )
      assert.equal(events.filter((event) => event.kind === DOC_KIND).length, 5)
    }
    assert.equal(pool.destroyed, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('single-document publishing keeps NIP-65 destinations and read-back truth', async () => {
  const secret = generateSecretKey()
  const relayList = finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: 1000,
      tags: [['r', 'wss://author.example', 'write']],
      content: '',
    },
    secret,
  )
  const pool = new FakePool(relayList)
  const report = await publishDocument(
    { path: '/from-web.txt', type: '0', title: 'From the web', content: 'hello\n' },
    ['wss://configured.example'],
    signerFor(secret),
    { pool, now: 2000 },
  )
  assert.equal(report.path, '/from-web.txt')
  assert.deepEqual(report.relays, ['wss://configured.example', 'wss://author.example'])
  assert.deepEqual(report.acceptedBy, report.relays)
  assert.deepEqual(report.readableFrom, report.relays)
  assert.ok(
    report.relays.every((relay) =>
      (pool.published.get(relay) ?? []).some((event) => event.id === relayList.id),
    ),
  )
  assert.equal(pool.destroyed, true)
})

test('single-document publishing refuses secrets and false relay acceptance', async () => {
  const secret = generateSecretKey()
  await assert.rejects(
    publishDocument(
      {
        path: '/leak.txt',
        type: '0',
        title: 'leak',
        content: `nsec1${'q'.repeat(58)}`,
      },
      ['wss://configured.example'],
      signerFor(secret),
      { pool: new FakePool(null) },
    ),
    /looks like an nsec/,
  )
  await assert.rejects(
    publishDocument(
      { path: '/rejected.txt', type: '0', title: 'rejected', content: 'hello' },
      ['wss://configured.example'],
      signerFor(secret),
      { pool: new FakePool(null, true), now: 2000 },
    ),
    /rejected by every relay/,
  )
  await assert.rejects(
    publishDocument(
      { path: '/hidden.txt', type: '0', title: 'hidden', content: 'hello' },
      ['wss://configured.example'],
      signerFor(secret),
      { pool: new FakePool(null, false, [], true), now: 2000 },
    ),
    /accepted but is not readable/,
  )
})

test('publish fails truthfully when every relay rejects a document', async () => {
  const dir = fixture()
  const secret = generateSecretKey()
  const pool = new FakePool(null, true)
  try {
    await assert.rejects(
      publishHole(dir, ['wss://configured.example'], signerFor(secret), { pool }),
      /rejected by every relay/,
    )
    assert.equal(pool.destroyed, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('publish fails truthfully when accepted documents cannot be read back', async () => {
  const dir = fixture()
  const secret = generateSecretKey()
  const pool = new FakePool(null, false, [], true)
  try {
    await assert.rejects(
      publishHole(dir, ['wss://configured.example'], signerFor(secret), { pool }),
      /accepted but not readable/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unpublish discovers documents on the author NIP-65 write relays', async () => {
  const secret = generateSecretKey()
  const signer = signerFor(secret)
  const doc = finalizeEvent(
    docToTemplate({ path: '/gone.txt', type: '0', title: 'gone', content: 'bye' }, 1001),
    secret,
  )
  const relayList = finalizeEvent(
    {
      kind: RELAY_LIST_KIND,
      created_at: 1000,
      tags: [['r', 'wss://author.example', 'write']],
      content: '',
    },
    secret,
  )
  const pool = new FakePool(relayList, false, [doc])
  await unpublishHole(['/gone.txt'], ['wss://configured.example'], signer, false, pool)
  for (const relay of ['wss://configured.example', 'wss://author.example']) {
    assert.ok((pool.published.get(relay) ?? []).some((event) => event.kind === 5))
  }
  assert.equal(pool.destroyed, true)
})
