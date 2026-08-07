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

// SPEC.md: display text carries no control character, and a record whose
// display holds one is information text with those characters replaced by
// spaces and no link. Colour belongs to a type 0 body, not to a menu record;
// see docs/bridge-profile.md.
test('terminal control sequences never survive in a menu record', () => {
  const styled = '\x1b[38;5;214mDonkey\x1b[0m'
  assert.deepEqual(parseKindmap(styled)[0], { type: 'i', display: ' [38;5;214mDonkey [0m' })
  // The escape costs the record its link, exactly as an invalid record must.
  assert.deepEqual(parseKindmap(`0${styled}\t/about.txt`)[0], {
    type: 'i',
    display: ' [38;5;214mDonkey [0m',
  })
  assert.equal(parseKindmap('\x1b[2Jcursor moved')[0]?.display, ' [2Jcursor moved')
  for (const line of parseKindmap(`${styled}\n0${styled}\t/about.txt`)) {
    assert.ok(!line.display.includes(String.fromCharCode(27)))
  }
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
