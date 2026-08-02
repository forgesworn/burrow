import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import { parseBurrowmap } from '../src/linemap.ts'
import { renderMenu, renderText, renderError } from '../src/render.ts'
import { BURROW_KIND } from '../src/protocol.ts'

const bridge = { host: 'bridge.test', port: 7070 }
const owner = nip19.npubEncode(getPublicKey(generateSecretKey()))

test('same-hole link is rewritten to a bridge selector', () => {
  const out = renderMenu(parseBurrowmap('0About\t/about.txt'), owner, bridge)
  assert.equal(out, `0About\t/${owner}/about.txt\tbridge.test\t7070\r\n.\r\n`)
})

test('root link omits trailing slash', () => {
  const out = renderMenu(parseBurrowmap('1Home\t/'), owner, bridge)
  assert.equal(out, `1Home\t/${owner}\tbridge.test\t7070\r\n.\r\n`)
})

test('naddr link resolves to the other hole', () => {
  const otherPk = getPublicKey(generateSecretKey())
  const otherNpub = nip19.npubEncode(otherPk)
  const naddr = nip19.naddrEncode({ pubkey: otherPk, kind: BURROW_KIND, identifier: '/notes' })
  const out = renderMenu(parseBurrowmap(`1Their notes\tnostr:${naddr}`), owner, bridge)
  assert.equal(out, `1Their notes\t/${otherNpub}/notes\tbridge.test\t7070\r\n.\r\n`)
})

test('naddr of the wrong kind degrades to info', () => {
  const pk = getPublicKey(generateSecretKey())
  const naddr = nip19.naddrEncode({ pubkey: pk, kind: 30023, identifier: 'post' })
  const out = renderMenu(parseBurrowmap(`1Blog\t${naddr}`), owner, bridge)
  assert.match(out, /^iBlog \(unresolvable link\)\t/)
})

test('external gopher url keeps its own host', () => {
  const out = renderMenu(
    parseBurrowmap('1Floodgap\tgopher://gopher.floodgap.com/1/world'),
    owner,
    bridge,
  )
  assert.equal(out, '1Floodgap\t/world\tgopher.floodgap.com\t70\r\n.\r\n')
})

test('gopher url with explicit port and no path', () => {
  const out = renderMenu(parseBurrowmap('1SDF\tgopher://sdf.org:70'), owner, bridge)
  assert.equal(out, '1SDF\t\tsdf.org\t70\r\n.\r\n')
})

test('web link becomes an hURL item', () => {
  const out = renderMenu(parseBurrowmap('hSite\thttps://example.com/x'), owner, bridge)
  assert.equal(out, 'hSite\tURL:https://example.com/x\tbridge.test\t7070\r\n.\r\n')
})

test('info lines use the standard dummy fields', () => {
  const out = renderMenu(parseBurrowmap('just some text'), owner, bridge)
  assert.equal(out, 'ijust some text\t-\terror.host\t1\r\n.\r\n')
})

test('text is CRLF, dot-stuffed, dot-terminated', () => {
  const out = renderText('hello\n.hidden\nworld\n')
  assert.equal(out, 'hello\r\n..hidden\r\nworld\r\n.\r\n')
})

test('errors are type 3 menus', () => {
  assert.equal(renderError('nope'), '3nope\t-\terror.host\t1\r\n.\r\n')
})
