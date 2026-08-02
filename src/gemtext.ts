import type { MenuItem } from './resolve.ts'

// Gemtext rendering for the gemini frontend. Hole links stay relative so
// they work through whatever hostname the bridge is reached on; search
// items point at the reserved `/search` endpoint (status 10 input flow).

export function targetRef(item: MenuItem): string | null {
  const t = item.target
  switch (t.scheme) {
    case 'none':
    case 'invalid':
      return null
    case 'hole': {
      if (item.type === '7') return `/${t.npub}/search`
      return `/${t.npub}${t.path === '/' ? '' : t.path}`
    }
    case 'gopher': {
      const port = t.port === 70 ? '' : `:${t.port}`
      const selector = t.selector.replaceAll(' ', '%20')
      return `gopher://${t.host}${port}/${t.itemType}${selector}`
    }
    case 'web':
      return t.url
  }
}

function escapeInfo(line: string): string {
  return line.startsWith('```') ? ` ${line}` : line
}

export function renderGemtextMenu(title: string, items: MenuItem[]): string {
  const out = [`# ${title}`, '']
  for (const item of items) {
    const ref = targetRef(item)
    if (ref === null) {
      const text =
        item.target.scheme === 'invalid'
          ? `${item.display} (${item.target.reason})`
          : item.display
      out.push(escapeInfo(text))
    } else {
      out.push(`=> ${ref} ${item.display}`.trimEnd())
    }
  }
  return out.join('\n') + '\n'
}
