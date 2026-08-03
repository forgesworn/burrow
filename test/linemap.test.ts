import test from 'node:test'
import assert from 'node:assert/strict'
import { parseKindmap } from '../src/linemap.ts'

test('typed line with link', () => {
  const [line] = parseKindmap('0About\t/about.txt')
  assert.deepEqual(line, { type: '0', display: 'About', link: '/about.txt' })
})

test('plain prose becomes info lines', () => {
  const lines = parseKindmap('Welcome to my gopherkind\n\nsecond paragraph')
  assert.deepEqual(lines, [
    { type: 'i', display: 'Welcome to my gopherkind' },
    { type: 'i', display: '' },
    { type: 'i', display: 'second paragraph' },
  ])
})

test('explicit i prefix is stripped', () => {
  const [line] = parseKindmap('ihello')
  assert.deepEqual(line, { type: 'i', display: 'hello' })
})

test('extra tab fields from pasted gophermaps are ignored', () => {
  const [line] = parseKindmap('1Phlog\t/phlog\tgopher.example\t70')
  assert.deepEqual(line, { type: '1', display: 'Phlog', link: '/phlog' })
})

test('trailing blank lines dropped, interior ones kept', () => {
  assert.equal(parseKindmap('ihello\n\n').length, 1)
  assert.equal(parseKindmap('ihello\n').length, 1)
  assert.equal(parseKindmap('ihello\n\nix\n').length, 3)
})
