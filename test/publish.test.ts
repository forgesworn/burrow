import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { planDirectory, docToTemplate, decodeSecret } from '../src/publish.ts'
import { generateSecretKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'

function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'burrow-test-'))
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
    assert.deepEqual(
      [...byPath.keys()].sort(),
      ['/', '/about.txt', '/links', '/phlog', '/phlog/first.txt'],
    )
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

test('decodeSecret accepts nsec and hex, rejects junk', () => {
  const sk = generateSecretKey()
  assert.deepEqual(decodeSecret(nip19.nsecEncode(sk)), sk)
  assert.deepEqual(decodeSecret(Buffer.from(sk).toString('hex')), sk)
  assert.throws(() => decodeSecret('hunter2'))
})
