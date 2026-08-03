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

// Gopher menus align ASCII art with runs of spaces, which a gemini client
// renders in a proportional font unless it is fenced as preformatted.
// Fence a run only when it looks like art, so ordinary prose stays prose.
function looksPreformatted(lines: string[]): boolean {
  return lines.some((l) => /\S {2,}\S/.test(l) || /(.)\1{7,}/.test(l.trim()))
}

export function renderGemtextMenu(title: string, items: MenuItem[]): string {
  const out = [`# ${title}`, '']
  let run: string[] = []
  const flush = (): void => {
    if (run.length === 0) return
    if (looksPreformatted(run)) out.push('```', ...run, '```')
    else out.push(...run.map(escapeInfo))
    run = []
  }
  for (const item of items) {
    const ref = targetRef(item)
    if (ref === null) {
      run.push(
        item.target.scheme === 'invalid'
          ? `${item.display} (${item.target.reason})`
          : item.display,
      )
    } else {
      flush()
      out.push(`=> ${ref} ${item.display}`.trimEnd())
    }
  }
  flush()
  return out.join('\n') + '\n'
}
