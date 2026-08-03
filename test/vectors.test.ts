import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from '../src/selector.ts'
import { parseBurrowmap } from '../src/linemap.ts'
import { renderMenu, renderText } from '../src/render.ts'

// Executable form of the SPEC.md "Test vectors" appendix, so a second
// implementation has something to validate against and the spec cannot drift
// from the code.

const N = nip19.npubEncode(getPublicKey(generateSecretKey()))
const bridge = { host: 'b.test', port: 70 }

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

test('burrowmap line to gopher wire vectors', () => {
  assert.equal(
    renderMenu(parseBurrowmap('0About\t/about.txt'), N, bridge),
    `0About\t/${N}/about.txt\tb.test\t70\r\n.\r\n`,
  )
  assert.equal(
    renderMenu(parseBurrowmap('1Home\t/'), N, bridge),
    `1Home\t/${N}\tb.test\t70\r\n.\r\n`,
  )
  assert.equal(renderMenu(parseBurrowmap('hello'), N, bridge), 'ihello\t-\terror.host\t1\r\n.\r\n')
  assert.equal(
    renderMenu(parseBurrowmap('hSite\thttps://example.com'), N, bridge),
    'hSite\tURL:https://example.com\tb.test\t70\r\n.\r\n',
  )
})

test('type 0 body dot-stuffing vector', () => {
  assert.equal(renderText('hello\n.hidden\n'), 'hello\r\n..hidden\r\n.\r\n')
})
