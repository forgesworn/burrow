import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from '../src/selector.ts'

const pubkey = getPublicKey(generateSecretKey())
const npub = nip19.npubEncode(pubkey)

test('empty selector is the welcome menu', () => {
  assert.deepEqual(parseSelector(''), { kind: 'welcome' })
  assert.deepEqual(parseSelector('/'), { kind: 'welcome' })
})

test('bare npub is the hole root', () => {
  const route = parseSelector(`/${npub}`)
  assert.equal(route.kind, 'doc')
  assert.equal((route as { path: string }).path, '/')
  assert.equal((route as { pubkey: string }).pubkey, pubkey)
})

test('leading slash optional, trailing slash normalised', () => {
  assert.equal((parseSelector(`${npub}/phlog/`) as { path: string }).path, '/phlog')
})

test('nested path', () => {
  const route = parseSelector(`/${npub}/phlog/2026-08-02.txt`)
  assert.equal((route as { path: string }).path, '/phlog/2026-08-02.txt')
})

test('tab query becomes a search route', () => {
  const route = parseSelector(`/${npub}\tmeteor`)
  assert.equal(route.kind, 'search')
  assert.equal((route as { query: string }).query, 'meteor')
})

test('gopher+ probe is not a search', () => {
  assert.equal(parseSelector(`/${npub}\t+`).kind, 'doc')
  assert.equal(parseSelector(`/${npub}\t$`).kind, 'doc')
})

test('rejects garbage npub', () => {
  assert.throws(() => parseSelector('/npub1garbage'), SelectorError)
  assert.throws(() => parseSelector('/about.txt'), SelectorError)
})

test('rejects path traversal', () => {
  assert.throws(() => parseSelector(`/${npub}/../etc/passwd`), SelectorError)
})
