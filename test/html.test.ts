import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMenuHtml } from '../src/html.ts'
import { renderGemtextMenu } from '../src/gemtext.ts'
import { info } from '../src/resolve.ts'
import type { MenuItem } from '../src/resolve.ts'

const ART = [
  info('***********************'),
  info('**   ASCII  ART      **'),
  info('***********************'),
]
const LINK: MenuItem = {
  type: '1',
  display: 'A link',
  target: { scheme: 'hole', npub: 'npub1x', path: '/x' },
}

test('ascii art keeps its alignment in a pre block', () => {
  const out = renderMenuHtml('T', ART)
  assert.match(out, /<pre>\*{23}\n\*\* {3}ASCII {2}ART {6}\*\*\n\*{23}<\/pre>/)
  assert.doesNotMatch(out, /<p>\*/)
})

test('info runs are split by links, not merged across them', () => {
  const out = renderMenuHtml('T', [info('before'), LINK, info('after')])
  const pres = out.match(/<pre>/g) ?? []
  assert.equal(pres.length, 2)
  assert.match(out, /<pre>before<\/pre>\n<p><a href="\/npub1x\/x">A link<\/a><\/p>\n<pre>after<\/pre>/)
})

test('blank padding around an info run is trimmed', () => {
  const out = renderMenuHtml('T', [info(''), info('text'), info('')])
  assert.match(out, /<pre>text<\/pre>/)
})

test('gemtext fences art but leaves prose alone', () => {
  const art = renderGemtextMenu('T', ART)
  assert.match(art, /```\n\*{23}/)
  const prose = renderGemtextMenu('T', [info('just a normal sentence here')])
  assert.doesNotMatch(prose, /```/)
})
