import { hasControlCharacters, replaceControlCharacters } from './protocol.ts'

// Kindmap: the host-agnostic menu source stored in kind 31436 events.
// One item per line: `<type><display>` or `<type><display>\t<link>`.
// Lines without a tab are info text; a leading `i` is optional there. The
// first two fields of a linked line are normative and later gophermap fields
// are ignored.

export interface MapLine {
  type: string
  display: string
  link?: string
}

const ITEM_TYPE = /^[\x21-\x7e]$/

function cleanInfo(value: string): string {
  return replaceControlCharacters(value)
}

export function parseKindmap(content: string): MapLine[] {
  const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
  // Discard only the empty record created by one terminating LF. Deliberate
  // blank records before it remain visible information lines.
  if (lines.at(-1) === '') lines.pop()
  return lines.map((raw): MapLine => {
    const tab = raw.indexOf('\t')
    if (tab === -1) {
      const display = raw.startsWith('i') ? raw.slice(1) : raw
      return { type: 'i', display: cleanInfo(display) }
    }
    const head = raw.slice(0, tab)
    const link = raw.slice(tab + 1).split('\t')[0] ?? ''
    const type = head.slice(0, 1)
    const display = head.slice(1)
    if (!ITEM_TYPE.test(type)) {
      const fallback = head.startsWith('i') ? head.slice(1) : head
      return { type: 'i', display: cleanInfo(fallback) }
    }
    if (
      type === 'i' ||
      link === '' ||
      hasControlCharacters(display) ||
      hasControlCharacters(link)
    ) {
      return { type: 'i', display: cleanInfo(display) }
    }
    return { type, display, link }
  })
}
