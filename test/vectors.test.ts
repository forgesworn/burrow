import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import type { Event } from 'nostr-tools'
import { parseSelector, SelectorError } from '../src/selector.ts'
import { parseKindmap } from '../src/linemap.ts'
import { renderMenu, renderText } from '../src/render.ts'
import {
  currentDocument,
  isValidDocPath,
  parseDocument,
  replacementWinner,
} from '../src/protocol.ts'

// Executable form of the SPEC.md "Test vectors" appendix, so a second
// implementation has something to validate against and the spec cannot drift
// from the code.

const N = nip19.npubEncode(getPublicKey(generateSecretKey()))
const bridge = { host: 'b.test', port: 70 }

interface Fixture {
  version: number
  documents: {
    name: string
    event: Pick<Event, 'kind' | 'tags' | 'content'>
    valid: boolean
    meta?: ReturnType<typeof parseDocument>
  }[]
  paths: { value: string; valid: boolean; urlPath?: string }[]
  distinctPaths: [string, string][]
  kindmap: { name: string; input: string; output: ReturnType<typeof parseKindmap> }[]
  replacement: {
    name: string
    now: number
    events: { id: string; created_at: number; tags: string[][] }[]
    winner: string
    visible: string | null
  }[]
  type0Wire: { input: string; output: string }[]
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/kind31436-v2.json', import.meta.url), 'utf8'),
) as Fixture

function fixtureEvent(
  partial: Pick<Event, 'kind' | 'tags' | 'content'> & Partial<Pick<Event, 'id' | 'created_at'>>,
): Event {
  return {
    id: partial.id ?? '0'.repeat(64),
    pubkey: '0'.repeat(64),
    created_at: partial.created_at ?? 0,
    kind: partial.kind,
    tags: partial.tags,
    content: partial.content,
    sig: '0'.repeat(128),
  }
}

test('published protocol fixtures match the implementation', () => {
  assert.equal(fixture.version, 2)
  for (const vector of fixture.documents) {
    const parsed = parseDocument(fixtureEvent(vector.event))
    assert.equal(parsed !== null, vector.valid, vector.name)
    if (vector.valid) assert.deepEqual(parsed, vector.meta, vector.name)
  }
  for (const vector of fixture.paths) {
    assert.equal(isValidDocPath(vector.value), vector.valid, vector.value)
    if (vector.urlPath !== undefined) {
      const encoded = vector.value
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
      assert.equal(encoded, vector.urlPath, vector.value)
    }
  }
  for (const [left, right] of fixture.distinctPaths) assert.notEqual(left, right)
  for (const vector of fixture.kindmap) {
    assert.deepEqual(parseKindmap(vector.input), vector.output, vector.name)
  }
  for (const vector of fixture.replacement) {
    const events = vector.events.map((event) =>
      fixtureEvent({ kind: 31436, content: '', ...event }),
    )
    assert.equal(replacementWinner(events)?.id ?? null, vector.winner, vector.name)
    assert.equal(currentDocument(events, vector.now)?.id ?? null, vector.visible, vector.name)
  }
  for (const vector of fixture.type0Wire) {
    assert.equal(renderText(vector.input), vector.output)
  }
})

test('selector to route vectors', () => {
  assert.equal(parseSelector('').kind, 'welcome')
  const doc = parseSelector(`/${N}/about.txt`)
  assert.deepEqual(
    { kind: doc.kind, path: (doc as { path: string }).path },
    {
      kind: 'doc',
      path: '/about.txt',
    },
  )
  const search = parseSelector(`/${N}\thay`)
  assert.deepEqual(
    { kind: search.kind, query: (search as { query: string }).query },
    {
      kind: 'search',
      query: 'hay',
    },
  )
  assert.throws(() => parseSelector(`/${N}/..`), SelectorError)
})

test('kindmap line to gopher wire vectors', () => {
  assert.equal(
    renderMenu(parseKindmap('0About\t/about.txt'), N, bridge),
    `0About\t/${N}/about.txt\tb.test\t70\r\n.\r\n`,
  )
  assert.equal(renderMenu(parseKindmap('1Home\t/'), N, bridge), `1Home\t/${N}\tb.test\t70\r\n.\r\n`)
  assert.equal(renderMenu(parseKindmap('hello'), N, bridge), 'ihello\t-\terror.host\t1\r\n.\r\n')
  assert.equal(
    renderMenu(parseKindmap('hSite\thttps://example.com'), N, bridge),
    'hSite\tURL:https://example.com\tb.test\t70\r\n.\r\n',
  )
})

test('type 0 body dot-stuffing vector', () => {
  assert.equal(renderText('hello\n.hidden\n'), 'hello\r\n..hidden\r\n.\r\n')
})
