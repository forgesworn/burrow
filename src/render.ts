import type { MapLine } from './linemap.ts'
import { resolveMapLines, type MenuItem } from './resolve.ts'
import { replaceControlCharacters } from './protocol.ts'

// RFC 1436 wire rendering.

export interface BridgeAddr {
  host: string
  port: number
}

const INFO_TAIL = '\t-\terror.host\t1'

function clean(text: string): string {
  return replaceControlCharacters(text)
}

export function gopherLine(
  type: string,
  display: string,
  selector: string,
  host: string,
  port: number,
): string {
  // clean() every interpolated field, not just the display: a tab or CRLF
  // in a selector or host (e.g. from a percent-decoded proxied gophermap,
  // or a hostile event) would otherwise forge extra menu records.
  const safeType = /^[\x21-\x7e]$/.test(type) ? type : 'i'
  return `${safeType}${clean(display)}\t${clean(selector)}\t${clean(host)}\t${Number(port) || 70}\r\n`
}

export function infoLine(display: string): string {
  return `i${clean(display)}${INFO_TAIL}\r\n`
}

export function holeSelector(npub: string, path: string): string {
  return `/${npub}${path === '/' ? '' : path}`
}

export function renderItem(item: MenuItem, bridge: BridgeAddr): string {
  const t = item.target
  switch (t.scheme) {
    case 'none':
      return infoLine(item.display)
    case 'invalid':
      return infoLine(`${item.display} (${t.reason})`)
    case 'hole':
      return gopherLine(
        item.type,
        item.display,
        holeSelector(t.npub, t.path),
        bridge.host,
        bridge.port,
      )
    case 'self':
      return gopherLine(item.type, item.display, t.path, bridge.host, bridge.port)
    case 'gopher':
      return gopherLine(t.itemType, item.display, t.selector, t.host, t.port)
    case 'web':
      return gopherLine('h', item.display, `URL:${t.url}`, bridge.host, bridge.port)
  }
}

export function renderMenuItems(items: MenuItem[], bridge: BridgeAddr): string {
  return `${items.map((i) => renderItem(i, bridge)).join('')}.\r\n`
}

export function renderMenu(lines: MapLine[], ownerNpub: string, bridge: BridgeAddr): string {
  return renderMenuItems(resolveMapLines(lines, ownerNpub), bridge)
}

export function renderText(content: string): string {
  const lines = content.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const stuffed = lines.map((l) => (l.startsWith('.') ? `.${l}` : l))
  return `${stuffed.join('\r\n')}\r\n.\r\n`
}

export function renderError(message: string): string {
  return `3${clean(message)}${INFO_TAIL}\r\n.\r\n`
}
