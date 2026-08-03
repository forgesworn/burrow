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

export interface PageMeta {
  canonical?: string
  description?: string
}

const STYLE = `*{box-sizing:border-box}
body{max-width:54em;margin:2em auto;padding:0 1em;font-family:monospace;
font-size:1rem;line-height:1.5;background:#111;color:#eae6dc;overflow-wrap:anywhere}
a{color:#8fd}h1,h2{font-weight:normal}
nav{display:flex;flex-wrap:wrap;gap:.25em 1em}
pre{white-space:pre;overflow-x:auto;max-width:100%}
hr{border:0;border-top:1px solid #444}
textarea,input,button,select{font-family:monospace;font-size:1rem;background:#000;color:#eae6dc;
border:1px solid #666;padding:.4em;max-width:100%}
textarea{width:100%;resize:vertical}
@media(prefers-color-scheme:light){body{background:#fff;color:#111}a{color:#046}
textarea,input,button,select{background:#fff;color:#111}}`

export function page(title: string, body: string, signedIn: boolean, meta: PageMeta = {}): string {
  const back = '<a href="/" data-history-back>back</a>'
  const nav = signedIn
    ? `${back}<a href="/">home</a><a href="/feed">feed</a><a href="/post">post</a><a href="/publish">publish</a><a href="/account">account</a>`
    : `${back}<a href="/">home</a><a href="/account">sign in</a>`
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
    if (run.length > 0) out.push(`<pre>${esc(run.join('\n'))}</pre>`)
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
      out.push(`<p><a href="${esc(link)}">${esc(item.display)}</a></p>`)
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
        body: `<h1>${esc(content.title)}</h1>\n<pre>${esc(content.body)}</pre>`,
      }
    case 'error':
      return { title: 'Not found', body: `<h1>Not found</h1>\n<p>${esc(content.message)}</p>` }
  }
}
