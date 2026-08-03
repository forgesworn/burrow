import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { DOC_KIND, isValidDocPath, parseDocument } from '../src/protocol.ts'

const sk = generateSecretKey()

function doc(tags: string[][]) {
  return finalizeEvent({ kind: DOC_KIND, created_at: 1_754_000_000, tags, content: '' }, sk)
}

test('document metadata is strict and a missing d never means root', () => {
  assert.deepEqual(
    parseDocument(
      doc([
        ['d', '/'],
        ['type', '1'],
      ]),
    ),
    { path: '/', type: '1', title: '/' },
  )
  assert.equal(parseDocument(doc([['type', '1']])), null)
  assert.equal(
    parseDocument(
      doc([
        ['d', '/'],
        ['d', '/other'],
        ['type', '1'],
      ]),
    ),
    null,
  )
  assert.equal(parseDocument(doc([['d', '/']])), null)
  assert.equal(
    parseDocument(
      doc([
        ['d', '/'],
        ['type', '9'],
      ]),
    ),
    null,
  )
  assert.equal(
    parseDocument(
      doc([
        ['d', '/x'],
        ['type', '0'],
        ['title', 'bad\ud800name'],
      ]),
    ),
    null,
  )
})

test('titles are optional, unique and free of controls', () => {
  assert.deepEqual(
    parseDocument(
      doc([
        ['d', '/x'],
        ['type', '0'],
        ['title', 'A / title'],
      ]),
    )?.title,
    'A / title',
  )
  assert.equal(
    parseDocument(
      doc([
        ['d', '/x'],
        ['type', '0'],
        ['title', 'one'],
        ['title', 'two'],
      ]),
    ),
    null,
  )
  assert.equal(
    parseDocument(
      doc([
        ['d', '/x'],
        ['type', '0'],
        ['title', 'bad\nname'],
      ]),
    ),
    null,
  )
})

test('path grammar preserves identity instead of normalising it', () => {
  for (const path of ['/', '/a', '/a b', '/a%20b', '/CAFÉ', '/CAFE\u0301']) {
    assert.equal(isValidDocPath(path), true, path)
  }
  for (const path of ['', 'a', '/a/', '/a//b', '/a/./b', '/a/../b', '/a\tb', '/a\ud800']) {
    assert.equal(isValidDocPath(path), false, path)
  }
  assert.notEqual('/a b', '/a%20b')
  assert.notEqual('/CAFÉ', '/CAFE\u0301')
})
