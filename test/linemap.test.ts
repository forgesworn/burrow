import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBurrowmap } from '../src/linemap.ts'

test('typed line with link', () => {
  const [line] = parseBurrowmap('0About\t/about.txt')
  assert.deepEqual(line, { type: '0', display: 'About', link: '/about.txt' })
})

test('plain prose becomes info lines', () => {
  const lines = parseBurrowmap('Welcome to my burrow\n\nsecond paragraph')
  assert.deepEqual(lines, [
    { type: 'i', display: 'Welcome to my burrow' },
    { type: 'i', display: '' },
    { type: 'i', display: 'second paragraph' },
  ])
})

test('explicit i prefix is stripped', () => {
  const [line] = parseBurrowmap('ihello')
  assert.deepEqual(line, { type: 'i', display: 'hello' })
})

test('extra tab fields from pasted gophermaps are ignored', () => {
  const [line] = parseBurrowmap('1Phlog\t/phlog\tgopher.example\t70')
  assert.deepEqual(line, { type: '1', display: 'Phlog', link: '/phlog' })
})

test('trailing blank lines dropped, interior ones kept', () => {
  assert.equal(parseBurrowmap('ihello\n\n').length, 1)
  assert.equal(parseBurrowmap('ihello\n').length, 1)
  assert.equal(parseBurrowmap('ihello\n\nix\n').length, 3)
})
