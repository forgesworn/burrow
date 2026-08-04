import type { MenuItem } from './resolve.ts'
import { plainTerminalText } from './protocol.ts'

// Gemtext rendering for the gemini frontend. Hole links stay relative so
// they work through whatever hostname the bridge is reached on. Search uses
// the bridge namespace so it cannot shadow a signed `/search` document.

// Percent-encode a hole path for a gemtext link ref: a space (or any
// control character) would otherwise split the `=> ref display` line and
// break the link, or forge a fake one.
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

export function holeRef(npub: string, path: string): string {
  return `/${npub}${path === '/' ? '' : encodePath(path)}`
}

export function targetRef(item: MenuItem): string | null {
  const t = item.target
  switch (t.scheme) {
    case 'none':
    case 'invalid':
      return null
    case 'hole': {
      if (item.type === '7') return `/_gopherkind/search/${t.npub}`
      return holeRef(t.npub, t.path)
    }
    case 'self':
      return encodePath(t.path)
    case 'gopher': {
      const port = t.port === 70 ? '' : `:${t.port}`
      const selector = t.selector.replaceAll(' ', '%20')
      return `gopher://${t.host}${port}/${t.itemType}${selector}`
    }
    case 'web':
      return t.url
  }
}

// A gemtext line is newline-delimited, so any raw control character in a
// display string or title can forge `=>` links. Strip them everywhere a
// renderer interpolates user-derived text.
export function cleanGemtext(text: string): string {
  return plainTerminalText(text)
}

function escapeInfo(line: string): string {
  return line.startsWith('```') || line.startsWith('=>') ? ` ${line}` : line
}

// Gopher menus align ASCII art with runs of spaces, which a gemini client
// renders in a proportional font unless it is fenced as preformatted.
// Fence a run only when it looks like art, so ordinary prose stays prose.
function looksPreformatted(lines: string[]): boolean {
  return lines.some((l) => /\S {2,}\S/.test(l) || /(.)\1{7,}/.test(l.trim()))
}

export function renderGemtextMenu(title: string, items: MenuItem[]): string {
  const out = [`# ${cleanGemtext(title)}`, '']
  let run: string[] = []
  const flush = (): void => {
    if (run.length === 0) return
    if (looksPreformatted(run)) out.push('```', ...run.map(escapeInfo), '```')
    else out.push(...run.map(escapeInfo))
    run = []
  }
  for (const item of items) {
    const ref = targetRef(item)
    const display = cleanGemtext(item.display)
    if (ref === null) {
      run.push(item.target.scheme === 'invalid' ? `${display} (${item.target.reason})` : display)
    } else {
      flush()
      out.push(`=> ${ref} ${display}`.trimEnd())
    }
  }
  flush()
  return `${out.join('\n')}\n`
}
