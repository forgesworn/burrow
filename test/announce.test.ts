import test from 'node:test'
import assert from 'node:assert/strict'
import { handlerTemplate, HANDLER_KIND, AnnounceError } from '../src/announce.ts'
import { DOC_KIND } from '../src/protocol.ts'

const base = {
  name: 'test bridge',
  about: 'a bridge',
  hostname: 'bridge.example',
  gopherPort: 70,
  geminiPort: 1965,
  httpUrl: 'https://bridge.example',
  identifier: 'gopherkind-bridge',
}

function tagsOf(tmpl: { tags: string[][] }, name: string): string[][] {
  return tmpl.tags.filter((t) => t[0] === name)
}

test('a handler announcement claims kind 31436 on every surface', () => {
  const tmpl = handlerTemplate(base, 1700000000)
  assert.equal(tmpl.kind, HANDLER_KIND)
  assert.equal(tmpl.created_at, 1700000000)
  assert.deepEqual(tagsOf(tmpl, 'd'), [['d', 'gopherkind-bridge']])
  assert.deepEqual(tagsOf(tmpl, 'k'), [['k', String(DOC_KIND)]])
  // NIP-89's <bech32> placeholder must survive verbatim on every url
  for (const t of [...tagsOf(tmpl, 'web'), ...tagsOf(tmpl, 'gopher'), ...tagsOf(tmpl, 'gemini')]) {
    assert.ok(t[1]?.includes('<bech32>'), `${t[0]} url should carry the placeholder`)
    assert.ok(['npub', 'nprofile', 'naddr'].includes(t[2] ?? ''), 'each url names its entity')
  }
  assert.deepEqual(JSON.parse(tmpl.content), { name: 'test bridge', about: 'a bridge' })
})

test('default ports are left out of the urls', () => {
  const tmpl = handlerTemplate(base, 1)
  assert.ok(tagsOf(tmpl, 'gopher')[0]?.[1]?.startsWith('gopher://bridge.example/1/'))
  assert.ok(tagsOf(tmpl, 'gemini')[0]?.[1]?.startsWith('gemini://bridge.example/'))
})

test('non-default ports are carried', () => {
  const tmpl = handlerTemplate({ ...base, gopherPort: 7070, geminiPort: 1966 }, 1)
  assert.ok(tagsOf(tmpl, 'gopher')[0]?.[1]?.startsWith('gopher://bridge.example:7070/1/'))
  assert.ok(tagsOf(tmpl, 'gemini')[0]?.[1]?.startsWith('gemini://bridge.example:1966/'))
})

test('disabled surfaces are simply not announced', () => {
  const tmpl = handlerTemplate({ ...base, geminiPort: null, httpUrl: null }, 1)
  assert.equal(tagsOf(tmpl, 'gemini').length, 0)
  assert.equal(tagsOf(tmpl, 'web').length, 0)
  assert.ok(tagsOf(tmpl, 'gopher').length > 0)
})

test('announcing localhost or a bad url is refused, not published', () => {
  assert.throws(() => handlerTemplate({ ...base, hostname: 'localhost' }, 1), AnnounceError)
  assert.throws(() => handlerTemplate({ ...base, hostname: 'a b.example' }, 1), AnnounceError)
  assert.throws(() => handlerTemplate({ ...base, httpUrl: 'gopher://x.example' }, 1), AnnounceError)
  assert.throws(() => handlerTemplate({ ...base, httpUrl: 'not a url' }, 1), AnnounceError)
})
