import test from 'node:test'
import assert from 'node:assert/strict'
import { page, renderMenuHtml, renderTerminalHtml } from '../src/html.ts'
import { renderGemtextMenu } from '../src/gemtext.ts'
import { info } from '../src/resolve.ts'
import { parseKindmap } from '../src/linemap.ts'
import { resolveMapLines, type MenuItem } from '../src/resolve.ts'

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
  assert.match(
    out,
    /<pre>before<\/pre>\n<p><a href="\/npub1x\/x">A link<\/a><\/p>\n<pre>after<\/pre>/,
  )
})

test('blank padding around an info run is trimmed', () => {
  const out = renderMenuHtml('T', [info(''), info('text'), info('')])
  assert.match(out, /<pre>text<\/pre>/)
})

test('terminal SGR styling becomes inert HTML styling', () => {
  const source = [
    '\x1b[1;38;2;27;75;105mtrue colour',
    '\x1b[0;48;5;196;4m indexed & underlined',
    '\x1b[0;31;47;3;9m styled <text>',
    '\x1b[0m plain',
  ].join('')
  assert.equal(
    renderTerminalHtml(source),
    [
      '<span style="color:#1b4b69;font-weight:bold">true colour</span>',
      '<span style="background-color:#ff0000;text-decoration:underline"> indexed &amp; underlined</span>',
      '<span style="color:#aa0000;background-color:#aaaaaa;font-style:italic;text-decoration:line-through"> styled &lt;text&gt;</span>',
      ' plain',
    ].join(''),
  )
})

test('terminal controls cannot become active HTML', () => {
  const source =
    '\x1b]8;;https://attacker.example\x07linked\x1b]8;;\x07 ' +
    '\x1b[2Jcursor <script> \x1b[38:2::10:20:30mcolour'
  const out = renderTerminalHtml(source)
  assert.doesNotMatch(out, /attacker|\[2J|<script>/)
  assert.ok(!out.includes('\x1b'))
  assert.match(out, /linked cursor &lt;script&gt; /)
  assert.match(out, /<span style="color:#0a141e">colour<\/span>/)
})

test('gopher menu artwork and links retain terminal colours in HTML', () => {
  const map = '\x1b[38;2;27;75;105m⢀\x1b[0m\n0\x1b[32mA coloured link\x1b[0m\t/x'
  const out = renderMenuHtml('T', resolveMapLines(parseKindmap(map), 'npub1x'))
  assert.match(out, /<pre><span style="color:#1b4b69">⢀<\/span><\/pre>/)
  assert.match(
    out,
    /<a href="\/npub1x\/x"><span style="color:#00aa00">A coloured link<\/span><\/a>/,
  )
  assert.doesNotMatch(out, /\[38;/)
  assert.ok(!out.includes('\x1b'))
})

test('html shell keeps navigation and form controls within a mobile viewport', () => {
  const out = page(
    'Publish',
    '<form><input type="text" size="50"><textarea cols="72"></textarea></form>',
    true,
  )
  assert.match(out, /<meta name="viewport" content="width=device-width,initial-scale=1">/)
  assert.match(out, /\*\{box-sizing:border-box\}/)
  assert.match(out, /nav\{display:flex;flex-wrap:wrap;/)
  assert.match(out, /textarea,input,button,select\{[^}]*max-width:100%\}/)
  assert.match(out, /textarea\{width:100%;resize:vertical\}/)
  // Whitespace between the links is deliberate: flex ignores it, lynx needs it.
  assert.match(out, /<nav><a href="\/" data-history-back>back<\/a>\s<a href="\/">home<\/a>/)
  assert.match(out, /<a href="\/me">my pages<\/a>/)
  assert.match(out, /data-theme-toggle hidden>theme<\/button>/)
  assert.match(out, /:root\[data-theme="light"\]/)
  assert.match(out, /:root\[data-theme="dark"\]/)
  assert.match(out, /<script src="\/browser\.js" defer><\/script>/)
})

test('gemtext fences art but leaves prose alone', () => {
  const art = renderGemtextMenu('T', ART)
  assert.match(art, /```\n\*{23}/)
  const prose = renderGemtextMenu('T', [info('just a normal sentence here')])
  assert.doesNotMatch(prose, /```/)
})
