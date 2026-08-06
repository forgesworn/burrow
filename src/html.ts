import { stripVTControlCharacters } from 'node:util'
import type { Content } from './router.ts'
import type { MenuItem } from './resolve.ts'
import { isSafeWebUrl } from './resolve.ts'
import { targetRef } from './gemtext.ts'
import { proxyPath } from './gopherclient.ts'

// HTML aimed at lynx first: linear structure, no layout tricks, every
// link on its own line so lynx numbers them cleanly. Graphical browsers
// get a readable column from the small inline stylesheet.

export function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

interface TerminalStyle {
  foreground: string | null
  background: string | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  hidden: boolean
  strike: boolean
}

const ANSI_COLOURS = [
  '#000000',
  '#aa0000',
  '#00aa00',
  '#aa5500',
  '#0000aa',
  '#aa00aa',
  '#00aaaa',
  '#aaaaaa',
  '#555555',
  '#ff5555',
  '#55ff55',
  '#ffff55',
  '#5555ff',
  '#ff55ff',
  '#55ffff',
  '#ffffff',
]

function terminalStyle(): TerminalStyle {
  return {
    foreground: null,
    background: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    hidden: false,
    strike: false,
  }
}

function byteHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}

function rgb(red: number, green: number, blue: number): string {
  return `#${byteHex(red)}${byteHex(green)}${byteHex(blue)}`
}

function indexedColour(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 255) return null
  if (value < 16) return ANSI_COLOURS[value] ?? null
  if (value < 232) {
    const index = value - 16
    const levels = [0, 95, 135, 175, 215, 255]
    return rgb(
      levels[Math.floor(index / 36)] ?? 0,
      levels[Math.floor((index % 36) / 6)] ?? 0,
      levels[index % 6] ?? 0,
    )
  }
  const grey = 8 + (value - 232) * 10
  return rgb(grey, grey, grey)
}

// ECMA-48 permits both semicolon and colon forms for extended colour. Turn a
// colon group into the same compact code sequence used by the common form.
function sgrCodes(raw: string): number[] {
  if (raw === '') return [0]
  const out: number[] = []
  for (const group of raw.split(';')) {
    const fields = group.split(':')
    if ((fields[0] === '38' || fields[0] === '48') && fields.length > 1) {
      const mode = Number(fields[1])
      if (mode === 2) {
        const components = fields.slice(2).filter((field) => field !== '')
        const colour = components.slice(-3).map(Number)
        out.push(Number(fields[0]), mode, ...colour)
        continue
      }
      if (mode === 5) {
        out.push(Number(fields[0]), mode, Number(fields.at(-1)))
        continue
      }
    }
    out.push(Number(group === '' ? '0' : group))
  }
  return out
}

function setExtendedColour(style: TerminalStyle, codes: number[], index: number): number {
  const target = codes[index] === 38 ? 'foreground' : 'background'
  const mode = codes[index + 1]
  if (mode === 2) {
    const values = codes.slice(index + 2, index + 5)
    if (
      values.length === 3 &&
      values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ) {
      style[target] = rgb(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0)
      return index + 4
    }
  }
  if (mode === 5) {
    const colour = indexedColour(codes[index + 2] ?? -1)
    if (colour !== null) {
      style[target] = colour
      return index + 2
    }
  }
  return index
}

function applySgr(style: TerminalStyle, raw: string): void {
  const codes = sgrCodes(raw)
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index]
    if (code === 0) Object.assign(style, terminalStyle())
    else if (code === 1) style.bold = true
    else if (code === 2) style.dim = true
    else if (code === 3) style.italic = true
    else if (code === 4 || code === 21) style.underline = true
    else if (code === 7) style.inverse = true
    else if (code === 8) style.hidden = true
    else if (code === 9) style.strike = true
    else if (code === 22) {
      style.bold = false
      style.dim = false
    } else if (code === 23) style.italic = false
    else if (code === 24) style.underline = false
    else if (code === 27) style.inverse = false
    else if (code === 28) style.hidden = false
    else if (code === 29) style.strike = false
    else if (code >= 30 && code <= 37) style.foreground = ANSI_COLOURS[code - 30] ?? null
    else if (code === 38 || code === 48) index = setExtendedColour(style, codes, index)
    else if (code === 39) style.foreground = null
    else if (code >= 40 && code <= 47) style.background = ANSI_COLOURS[code - 40] ?? null
    else if (code === 49) style.background = null
    else if (code >= 90 && code <= 97) style.foreground = ANSI_COLOURS[code - 82] ?? null
    else if (code >= 100 && code <= 107) style.background = ANSI_COLOURS[code - 92] ?? null
  }
}

function cleanTerminalText(value: string): string {
  return [...stripVTControlCharacters(value)]
    .map((character) => {
      if (character === '\n' || character === '\t') return character
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : character
    })
    .join('')
}

// A type 0 document has no link structure: RFC 1436 gives text files no way to
// carry one, so an address written in prose is just prose. Gopher and Gemini
// must live with that, but a browser reader reasonably expects to follow it, so
// the HTML frontend turns recognised addresses in a text body into real links.
// Only in text bodies: a menu display is already inside its own anchor.
const URL_IN_TEXT = /\b(?:https?|gopher|gemini):\/\/[^\s<>"'`]+/g

// Sentence punctuation is not part of the address. Brackets only count as
// trailing when unbalanced, so a URL that legitimately ends in ")" survives.
function trimTrailingPunctuation(url: string): { url: string; tail: string } {
  let end = url.length
  for (;;) {
    const ch = url[end - 1]
    if (ch === undefined) break
    if ('.,;:!?'.includes(ch)) {
      end--
      continue
    }
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '['
      const slice = url.slice(0, end)
      const opens = slice.split(open).length - 1
      const closes = slice.split(ch).length - 1
      if (closes > opens) {
        end--
        continue
      }
    }
    break
  }
  return { url: url.slice(0, end), tail: url.slice(end) }
}

function textHref(url: string): string | null {
  // Defence in depth: the allowlist first, then a parse. Anything that does not
  // survive both stays inert text rather than becoming a live href.
  if (!isSafeWebUrl(url)) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'gopher:') {
      const port = parsed.port === '' ? 70 : Number(parsed.port)
      const type = parsed.pathname.length > 1 ? (parsed.pathname[1] ?? '1') : '1'
      const selector =
        parsed.pathname.length > 2 ? decodeURIComponent(parsed.pathname.slice(2)) : ''
      return proxyPath({ host: parsed.hostname, port, type, selector })
    }
    if (['http:', 'https:', 'gemini:'].includes(parsed.protocol)) return url
    return null
  } catch {
    return null
  }
}

function escapeAndLink(raw: string): string {
  let out = ''
  let last = 0
  for (const match of raw.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0
    const matched = match[0]
    const { url, tail } = trimTrailingPunctuation(matched)
    out += esc(raw.slice(last, start))
    const href = textHref(url)
    out += href === null ? esc(url) : `<a href="${esc(href)}">${esc(url)}</a>`
    out += esc(tail)
    last = start + matched.length
  }
  return out + esc(raw.slice(last))
}

function styledText(value: string, style: TerminalStyle, linkify = false): string {
  const cleaned = cleanTerminalText(value)
  const text = linkify ? escapeAndLink(cleaned) : esc(cleaned)
  if (text === '') return ''
  const css: string[] = []
  const foreground = style.inverse ? (style.background ?? 'var(--terminal-bg)') : style.foreground
  const background = style.inverse ? (style.foreground ?? 'var(--terminal-fg)') : style.background
  if (foreground !== null) css.push(`color:${foreground}`)
  if (background !== null) css.push(`background-color:${background}`)
  if (style.bold) css.push('font-weight:bold')
  if (style.dim) css.push('opacity:.7')
  if (style.italic) css.push('font-style:italic')
  const decoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
    .filter((value) => value !== '')
    .join(' ')
  if (decoration !== '') css.push(`text-decoration:${decoration}`)
  if (style.hidden) css.push('visibility:hidden')
  return css.length === 0 ? text : `<span style="${css.join(';')}">${text}</span>`
}

// Interpret only Select Graphic Rendition sequences. Other terminal controls
// are stripped, so cursor motion, OSC hyperlinks and clipboard commands can
// never become active browser behaviour.
export function renderTerminalHtml(value: string, linkify = false): string {
  const style = terminalStyle()
  const out: string[] = []
  const pattern = new RegExp(`${String.fromCharCode(27)}\\[([0-9;:]*)m`, 'g')
  let offset = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? offset
    out.push(styledText(value.slice(offset, index), style, linkify))
    applySgr(style, match[1] ?? '')
    offset = index + match[0].length
  }
  out.push(styledText(value.slice(offset), style, linkify))
  return out.join('')
}

export interface PageMeta {
  canonical?: string
  description?: string
}

const STYLE = `*{box-sizing:border-box}
:root{color-scheme:dark;--terminal-fg:#eae6dc;--terminal-bg:#111;--link:#8fd;
--control-bg:#000;--control-border:#666;--rule:#444}
:root[data-theme="light"]{color-scheme:light;--terminal-fg:#111;--terminal-bg:#fff;--link:#046;
--control-bg:#fff;--control-border:#888;--rule:#bbb}
:root[data-theme="dark"]{color-scheme:dark;--terminal-fg:#eae6dc;--terminal-bg:#111;--link:#8fd;
--control-bg:#000;--control-border:#666;--rule:#444}
body{max-width:54em;margin:2em auto;padding:0 1em;
font-family:monospace;font-size:1rem;line-height:1.5;background:var(--terminal-bg);
color:var(--terminal-fg);overflow-wrap:anywhere}
a{color:var(--link)}h1,h2{font-weight:normal}
nav{display:flex;flex-wrap:wrap;gap:.25em 1em}
nav button{font:inherit;color:var(--link);background:transparent;border:0;padding:0;text-decoration:underline;cursor:pointer}
pre{white-space:pre;overflow-x:auto;max-width:100%}
hr{border:0;border-top:1px solid var(--rule)}
textarea,input,button,select{font-family:monospace;font-size:1rem;background:var(--control-bg);color:var(--terminal-fg);
border:1px solid var(--control-border);padding:.4em;max-width:100%}
textarea{width:100%;resize:vertical}
@media(prefers-color-scheme:light){:root:not([data-theme]){color-scheme:light;--terminal-fg:#111;
--terminal-bg:#fff;--link:#046;--control-bg:#fff;--control-border:#888;--rule:#bbb}}`

export function page(title: string, body: string, signedIn: boolean, meta: PageMeta = {}): string {
  const back = '<a href="/" data-history-back>back</a>'
  const theme = '<button type="button" data-theme-toggle hidden>theme</button>'
  // Joined with newlines: a flex container ignores the whitespace between its
  // items, while lynx (which ignores the stylesheet entirely) needs it to keep
  // the links from running into one word.
  const links = signedIn
    ? [
        back,
        '<a href="/">home</a>',
        '<a href="/me">my pages</a>',
        '<a href="/feed">feed</a>',
        '<a href="/post">post</a>',
        '<a href="/publish">publish</a>',
        '<a href="/account">account</a>',
        theme,
      ]
    : [
        back,
        '<a href="/">home</a>',
        '<a href="/about">about</a>',
        '<a href="/account">sign in</a>',
        theme,
      ]
  const nav = links.join('\n')
  const metadata = [
    meta.canonical ? `<link rel="canonical" href="${esc(meta.canonical)}">` : '',
    meta.description ? `<meta name="description" content="${esc(meta.description)}">` : '',
    `<meta property="og:title" content="${esc(title)}">`,
    meta.description ? `<meta property="og:description" content="${esc(meta.description)}">` : '',
    meta.canonical ? `<meta property="og:url" content="${esc(meta.canonical)}">` : '',
    '<meta property="og:type" content="website">',
    '<meta name="twitter:card" content="summary">',
  ]
    .filter((line) => line !== '')
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)}</title>
${metadata}
<style>${STYLE}</style><script src="/browser.js" defer></script></head>
<body><nav>${nav}</nav><hr>
${body}
</body></html>
`
}

function href(item: MenuItem): string | null {
  // Legacy gopherspace goes through the built-in proxy so it works in
  // graphical browsers too, not just clients that speak gopher natively.
  if (item.target.scheme === 'gopher') {
    const t = item.target
    return proxyPath({ host: t.host, port: t.port, type: t.itemType, selector: t.selector })
  }
  // Defence in depth: never emit an href for a non-allowlisted scheme.
  if (item.target.scheme === 'web' && !isSafeWebUrl(item.target.url)) return null
  return targetRef(item)
}

export function renderMenuHtml(title: string, items: MenuItem[]): string {
  const out = [`<h1>${esc(title)}</h1>`]
  // Runs of info lines become one <pre> block. Gopher menus align ASCII
  // art and box borders with runs of spaces, which <p> would collapse.
  let run: string[] = []
  const flush = (): void => {
    while (run.length > 0 && run[run.length - 1]?.trim() === '') run.pop()
    while (run.length > 0 && run[0]?.trim() === '') run.shift()
    if (run.length > 0) out.push(`<pre>${renderTerminalHtml(run.join('\n'))}</pre>`)
    run = []
  }
  for (const item of items) {
    const link = href(item)
    if (link === null) {
      run.push(
        item.target.scheme === 'invalid' ? `${item.display} (${item.target.reason})` : item.display,
      )
    } else {
      flush()
      out.push(`<p><a href="${esc(link)}">${renderTerminalHtml(item.display)}</a></p>`)
    }
  }
  flush()
  return out.join('\n')
}

export function renderContentHtml(content: Content): { title: string; body: string } {
  switch (content.kind) {
    case 'menu':
      return { title: content.title, body: renderMenuHtml(content.title, content.items) }
    case 'text':
      return {
        title: content.title,
        body: `<h1>${esc(content.title)}</h1>\n<pre>${renderTerminalHtml(content.body, true)}</pre>`,
      }
    case 'error':
      return { title: 'Not found', body: `<h1>Not found</h1>\n<p>${esc(content.message)}</p>` }
  }
}
