import type { Content } from './router.ts'
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
