import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { parseKindmap } from '../src/linemap.ts'
import { resolveMapLines } from '../src/resolve.ts'
import { renderGemtextMenu } from '../src/gemtext.ts'

const npub = nip19.npubEncode(getPublicKey(generateSecretKey()))

function render(map: string): string {
  return renderGemtextMenu('Test', resolveMapLines(parseKindmap(map), npub))
}

test('menu renders heading, info text and links', () => {
  const out = render('iWelcome\n0About\t/about.txt')
  assert.equal(out, `# Test\n\nWelcome\n=> /${npub}/about.txt About\n`)
})

// Gemini puts styling "under the exclusive control of the rendering user
// agent", so an author's escape has nothing to say here under any reading.
test('gemtext carries no terminal control characters', () => {
  const out = render('\x1b[38;5;214mDonkey\x1b[0m')
  assert.match(out, /Donkey/)
  assert.ok(!out.includes(String.fromCharCode(27)))
})

test('search items point at the bridge namespace', () => {
  const out = render('7Find things\t/')
  assert.equal(out, `# Test\n\n=> /_gopherkind/search/${npub} Find things\n`)
})

test('literal percent signs are encoded separately from spaces', () => {
  assert.match(render('0Space\t/a b'), new RegExp(`=> /${npub}/a%20b Space`))
  assert.match(render('0Percent\t/a%20b'), new RegExp(`=> /${npub}/a%2520b Percent`))
})

test('gopher links become absolute gopher urls', () => {
  const out = render('1Floodgap\tgopher://gopher.floodgap.com/1/world wide')
  assert.match(out, /=> gopher:\/\/gopher\.floodgap\.com\/1\/world%20wide Floodgap/)
})

test('gopher default port elided, others kept', () => {
  assert.match(render('1A\tgopher://a.example/1/x'), /=> gopher:\/\/a\.example\/1\/x A/)
  assert.match(render('1B\tgopher://b.example:7070/1/x'), /=> gopher:\/\/b\.example:7070\/1\/x B/)
})

test('web links pass through, invalid links degrade to text', () => {
  assert.match(render('hSite\thttps://example.com'), /=> https:\/\/example\.com Site/)
  assert.match(render('1Bad\tnaddr1garbage'), /Bad \(unresolvable link\)/)
})

test('info lines opening a preformat fence are escaped', () => {
  const out = render('i```code')
  assert.match(out, /\n {1}```code\n/)
})

test('info text cannot turn into a gemtext link', () => {
  const out = render('=> gemini://evil.example/ Click me')
  assert.doesNotMatch(out, /\n=> gemini:\/\/evil\.example/)
})

test('an info line cannot escape an automatically generated preformat fence', () => {
  const out = render('iASCII  art\ni```\ni=> gemini://evil.example/ Click me')
  assert.doesNotMatch(out, /\n```\n=> gemini:\/\/evil\.example/)
  assert.match(out, /\n ```\n => gemini:\/\/evil\.example\/ Click me\n```/)
})

test('control characters in a display cannot forge a gemtext link', () => {
  const evil = 'Innocent\n=> gemini://phish.example/ Verify your account'
  const out = renderGemtextMenu('Follows', [
    { type: '1', display: evil, target: { scheme: 'hole', npub, path: '/' } },
  ])
  // The forged "=>" must not appear on its own line: the newline is stripped.
  assert.doesNotMatch(out, /\n=> gemini:\/\/phish\.example/)
})

test('control characters in a title cannot inject gemtext', () => {
  const out = renderGemtextMenu('Hi\n=> gemini://evil/ x', [])
  assert.doesNotMatch(out, /\n=> gemini:\/\/evil/)
})

test('a self-scheme item renders as a bare relative ref', () => {
  const out = renderGemtextMenu('You', [
    { type: '1', display: 'Your feed', target: { scheme: 'self', path: '/me/feed' } },
  ])
  assert.match(out, /=> \/me\/feed Your feed/)
})
