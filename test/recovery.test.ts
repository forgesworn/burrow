import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Event, EventTemplate, Filter } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { docToTemplate, planDirectory, RECOVERY_MANIFEST } from '../src/publish.ts'
import {
  formatHoleInspection,
  inspectHole,
  type InspectPool,
  writeHoleExport,
} from '../src/recovery.ts'
import { RELAY_LIST_KIND } from '../src/protocol.ts'

function signed(template: EventTemplate, secret: Uint8Array): Event {
  return finalizeEvent(template, secret)
}

test('export manifest round-trips document coordinates that filenames cannot express', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-export-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  const source = [
    { path: '/', type: '0' as const, title: 'root text', content: 'root body' },
    { path: '/foo', type: '1' as const, title: 'foo menu', content: 'iFoo\n' },
    { path: '/foo.map', type: '0' as const, title: 'literal map', content: 'not a menu' },
    { path: '/odd/name', type: '0' as const, title: 'A custom title', content: 'odd' },
  ]
  const events = source.map((doc, index) => signed(docToTemplate(doc, 1000 + index), secret))

  const manifest = writeHoleExport(events, pubkey, dir, {
    now: new Date('2026-08-03T12:00:00.000Z'),
  })
  assert.equal(manifest.documents.length, source.length)
  assert.equal(manifest.exportedAt, '2026-08-03T12:00:00.000Z')
  assert.equal(JSON.parse(readFileSync(path.join(dir, RECOVERY_MANIFEST), 'utf8')).version, 1)

  assert.deepEqual(
    planDirectory(dir),
    source.sort((a, b) => a.path.localeCompare(b.path)),
  )
})

test('export refuses to mix a snapshot into a non-empty directory without --force', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-export-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, 'keep.txt'), 'mine')
  const secret = generateSecretKey()
  const event = signed(
    docToTemplate({ path: '/', type: '1', title: 'root', content: 'iRoot\n' }, 1000),
    secret,
  )
  assert.throws(() => writeHoleExport([event], getPublicKey(secret), dir), /not empty.*--force/)
  assert.equal(readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'mine')
})

test('publisher rejects traversal in a recovery manifest', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gopherkind-export-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'snapshot')
  mkdirSync(dir)
  writeFileSync(path.join(root, 'outside.txt'), 'secret')
  writeFileSync(
    path.join(dir, RECOVERY_MANIFEST),
    JSON.stringify({
      format: 'gopherkind-hole-export',
      version: 1,
      documents: [{ file: '../outside.txt', path: '/', type: '0', title: 'root' }],
    }),
  )
  assert.throws(() => planDirectory(dir), /unsafe file path/)
})

test('forced export refuses a symlinked documents directory', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gopherkind-export-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'snapshot')
  const outside = path.join(root, 'outside')
  mkdirSync(dir)
  mkdirSync(outside)
  symlinkSync(outside, path.join(dir, 'documents'))
  const secret = generateSecretKey()
  const event = signed(
    docToTemplate({ path: '/', type: '0', title: 'root', content: 'safe' }, 1000),
    secret,
  )
  assert.throws(
    () => writeHoleExport([event], getPublicKey(secret), dir, { force: true }),
    /unsafe export documents directory/,
  )
  assert.deepEqual(readFileNames(outside), [])
})

function readFileNames(dir: string): string[] {
  return readdirSync(dir)
}

class InspectFakePool implements InspectPool {
  destroyed = false
  private readonly relayList: Event
  private readonly byRelay: Map<string, Event[]>

  constructor(relayList: Event, byRelay: Map<string, Event[]>) {
    this.relayList = relayList
    this.byRelay = byRelay
  }

  async querySync(relays: string[], filter: Filter): Promise<Event[]> {
    if (filter.kinds?.includes(RELAY_LIST_KIND)) return [this.relayList]
    if (relays.length === 1 && relays[0] === 'wss://down.example') throw new Error('offline')
    return relays.flatMap((relay) => this.byRelay.get(relay) ?? [])
  }

  destroy(): void {
    this.destroyed = true
  }
}

test('relay inspection distinguishes current, stale, missing and unreachable documents', async () => {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  const oldRoot = signed(
    docToTemplate({ path: '/', type: '1', title: 'root', content: 'old' }, 1000),
    secret,
  )
  const root = signed(
    docToTemplate({ path: '/', type: '1', title: 'root', content: 'new' }, 1001),
    secret,
  )
  const about = signed(
    docToTemplate({ path: '/about', type: '0', title: 'about', content: 'hello' }, 1000),
    secret,
  )
  const relayList = signed(
    {
      kind: RELAY_LIST_KIND,
      created_at: 999,
      tags: [['r', 'wss://author.example', 'write']],
      content: '',
    },
    secret,
  )
  const pool = new InspectFakePool(
    relayList,
    new Map([
      ['wss://configured.example', [root]],
      ['wss://author.example', [oldRoot, about]],
    ]),
  )
  const result = await inspectHole(pubkey, ['wss://configured.example'], ['wss://down.example'], {
    pool,
    filterUntrustedRelays: async (urls) => [...urls],
    now: 2000,
  })

  assert.deepEqual(result.documents.map((doc) => doc.path).sort(), ['/', '/about'])
  assert.deepEqual(result.suppressed, [])
  assert.deepEqual(result.relays, [
    {
      relay: 'wss://configured.example',
      reachable: true,
      present: ['/'],
      stale: [],
      missing: ['/about'],
    },
    {
      relay: 'wss://down.example',
      reachable: false,
      present: [],
      stale: [],
      missing: ['/', '/about'],
    },
    {
      relay: 'wss://author.example',
      reachable: true,
      present: ['/about'],
      stale: ['/'],
      missing: [],
    },
  ])
  assert.match(formatHoleInspection(result), /read check now, not proof/)
  assert.equal(pool.destroyed, true)
})

test('relay inspection exposes a coordinate suppressed by its winning revision', async () => {
  const secret = generateSecretKey()
  const pubkey = getPublicKey(secret)
  const valid = signed(
    docToTemplate({ path: '/', type: '1', title: 'root', content: 'old' }, 1000),
    secret,
  )
  const malformed = signed(
    {
      kind: 31436,
      created_at: 1001,
      tags: [
        ['d', '/'],
        ['type', '9'],
      ],
      content: 'bad',
    },
    secret,
  )
  const relayList = signed(
    { kind: RELAY_LIST_KIND, created_at: 999, tags: [], content: '' },
    secret,
  )
  const pool = new InspectFakePool(
    relayList,
    new Map([['wss://configured.example', [valid, malformed]]]),
  )
  const result = await inspectHole(pubkey, ['wss://configured.example'], [], {
    pool,
    filterUntrustedRelays: async (urls) => [...urls],
    now: 2000,
  })
  assert.deepEqual(result.documents, [])
  assert.deepEqual(result.suppressed, ['/'])
  assert.match(formatHoleInspection(result), /winning malformed or expired revision: \//)
})
