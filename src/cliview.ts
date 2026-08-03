import type { Content } from './router.ts'
import type { MenuItem } from './resolve.ts'
import { targetRef } from './gemtext.ts'

// Terminal rendering. Menu links are numbered and shown as the selector
// you would pass straight back to `burrow read`.

export function renderForTerminal(content: Content): string {
  switch (content.kind) {
    case 'text':
      return content.body.replace(/\n+$/, '') + '\n'
    case 'error':
      return `error: ${content.message}\n`
    case 'menu': {
      const out = [content.title, '='.repeat(content.title.length), '']
      for (const item of content.items) {
        const ref = targetRef(item)
        if (ref === null) {
          out.push(
            item.target.scheme === 'invalid'
              ? `  ${item.display} (${item.target.reason})`
              : `  ${item.display}`,
          )
        } else {
          out.push(`  ${item.display}`)
          out.push(`      ${ref}`)
        }
      }
      return out.join('\n') + '\n'
    }
  }
}

// Followable menu links: everything a browse session can act on. Info
// and invalid lines stay in the text but get no number.
export function pageLinks(content: Content): MenuItem[] {
  if (content.kind !== 'menu') return []
  return content.items.filter(
    (item) => item.target.scheme !== 'none' && item.target.scheme !== 'invalid',
  )
}

// Interactive rendering: [n] prefixes on followable lines, and every
// display starting in the same column so aligned ASCII art stays aligned.
export function renderNumbered(content: Content): string {
  switch (content.kind) {
    case 'text':
      return content.body.replace(/\n+$/, '') + '\n'
    case 'error':
      return `error: ${content.message}\n`
    case 'menu': {
      const links = pageLinks(content)
      const width = String(Math.max(links.length, 1)).length
      const gutter = ' '.repeat(width + 3)
      const out = [content.title, '='.repeat(content.title.length), '']
      let n = 0
      for (const item of content.items) {
        if (item.target.scheme === 'none') {
          out.push(`${gutter}${item.display}`.trimEnd())
        } else if (item.target.scheme === 'invalid') {
          out.push(`${gutter}${item.display} (${item.target.reason})`)
        } else {
          n += 1
          const marker = item.type === '7' ? '?' : item.target.scheme === 'web' ? 'w' : ''
          out.push(`[${String(n).padStart(width)}] ${item.display}${marker === '' ? '' : ` (${marker})`}`)
        }
      }
      return out.join('\n') + '\n'
    }
  }
}
