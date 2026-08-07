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

// SPEC.md: a display may carry SGR and nothing else addressable, a link carries
// no control character at all. baud.baby builds its root menu out of SGR info
// lines, so a parser that stripped them would mangle real gopherspace.
test('SGR survives in a display, every other control does not', () => {
  const styled = '\x1b[38;5;214mDonkey\x1b[0m'
  assert.deepEqual(parseKindmap(styled)[0], { type: 'i', display: styled })
  assert.deepEqual(parseKindmap(`0${styled}\t/about.txt`)[0], {
    type: '0',
    display: styled,
    link: '/about.txt',
  })
  // Not SGR: each control becomes a space, and the record loses its link.
  assert.equal(parseKindmap('\x1b[2Jcursor moved')[0]?.display, ' [2Jcursor moved')
  assert.deepEqual(parseKindmap('1\x1b[2JHome\t/')[0], { type: 'i', display: ' [2JHome' })
  // Anything at all in the link costs the link, SGR included.
  assert.deepEqual(parseKindmap('0About\t/about\x1b[0m.txt')[0], { type: 'i', display: 'About' })
})

test('extra tab fields from pasted gophermaps are ignored', () => {
  const [line] = parseKindmap('1Phlog\t/phlog\tgopher.example\t70')
  assert.deepEqual(line, { type: '1', display: 'Phlog', link: '/phlog' })
})

test('one terminal record is dropped, deliberate blank lines are kept', () => {
  assert.equal(parseKindmap('ihello\n\n').length, 2)
  assert.equal(parseKindmap('ihello\n').length, 1)
  assert.equal(parseKindmap('ihello\n\nix\n').length, 3)
})

test('links remain byte-exact and invalid linked records become info', () => {
  assert.deepEqual(parseKindmap('0Space\t/a b ')[0], {
    type: '0',
    display: 'Space',
    link: '/a b ',
  })
  assert.deepEqual(parseKindmap(' Broken\t/path')[0], { type: 'i', display: ' Broken' })
  assert.deepEqual(parseKindmap('1Broken\t')[0], { type: 'i', display: 'Broken' })
  assert.deepEqual(parseKindmap('1Bad\t/path\rcontrol')[0], { type: 'i', display: 'Bad' })
})
