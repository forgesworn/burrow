import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  planDirectory,
  docToTemplate,
  decodeSecret,
  parseDuration,
  planDeletion,
} from '../src/publish.ts'
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'

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

test('decodeSecret accepts nsec and hex, rejects junk', () => {
  const sk = generateSecretKey()
  assert.deepEqual(decodeSecret(nip19.nsecEncode(sk)), sk)
  assert.deepEqual(decodeSecret(Buffer.from(sk).toString('hex')), sk)
  assert.throws(() => decodeSecret('hunter2'))
})
