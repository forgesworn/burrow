// Burrowmap: the host-agnostic menu source stored in kind 31436 events.
// One item per line: `<type><display>` or `<type><display>\t<link>`.
// Lines without a tab are info text; a leading `i` is optional there.
// Extra tab-separated fields (host/port from a pasted classic gophermap)
// are ignored, so real gophermaps degrade gracefully.

export interface MapLine {
  type: string
  display: string
  link?: string
}

export function parseBurrowmap(content: string): MapLine[] {
  const lines = content.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((raw): MapLine => {
    const tab = raw.indexOf('\t')
    if (tab === -1) {
      const display = raw.startsWith('i') ? raw.slice(1) : raw
      return { type: 'i', display }
    }
    const head = raw.slice(0, tab)
    const link = (raw.slice(tab + 1).split('\t')[0] ?? '').trim()
    const type = head.slice(0, 1) || 'i'
    const display = head.slice(1)
    if (type === 'i' || link === '') return { type: 'i', display }
    return { type, display, link }
  })
}
