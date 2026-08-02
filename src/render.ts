import * as nip19 from 'nostr-tools/nip19'
import type { MapLine } from './linemap.ts'
import { BURROW_KIND } from './protocol.ts'

export interface BridgeAddr {
  host: string
  port: number
}

const INFO_TAIL = '\t-\terror.host\t1'

function clean(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ')
}

export function gopherLine(
  type: string,
  display: string,
  selector: string,
  host: string,
  port: number,
): string {
  return `${type}${clean(display)}\t${selector}\t${host}\t${port}\r\n`
}

export function infoLine(display: string): string {
  return `i${clean(display)}${INFO_TAIL}\r\n`
}

function resolveLink(line: MapLine, ownerNpub: string, bridge: BridgeAddr): string {
  const { type, display } = line
  const link = line.link ?? ''

  // Same-hole absolute path.
  if (link.startsWith('/')) {
    const suffix = link === '/' ? '' : link
    return gopherLine(type, display, `/${ownerNpub}${suffix}`, bridge.host, bridge.port)
  }

  // Another hole, by naddr.
  const naddr = link.startsWith('nostr:') ? link.slice(6) : link
  if (naddr.startsWith('naddr1')) {
    try {
      const decoded = nip19.decode(naddr)
      if (decoded.type !== 'naddr' || decoded.data.kind !== BURROW_KIND) {
        throw new Error('wrong kind')
      }
      const npub = nip19.npubEncode(decoded.data.pubkey)
      const id = decoded.data.identifier
      const path = id.startsWith('/') ? id : `/${id}`
      const suffix = path === '/' ? '' : path
      return gopherLine(type, display, `/${npub}${suffix}`, bridge.host, bridge.port)
    } catch {
      return infoLine(`${display} (unresolvable link)`)
    }
  }

  // Legacy gopherspace.
  if (link.startsWith('gopher://')) {
    try {
      const url = new URL(link)
      const port = url.port === '' ? 70 : Number(url.port)
      const t = url.pathname.length > 1 ? url.pathname[1]! : '1'
      const selector = url.pathname.length > 2 ? decodeURIComponent(url.pathname.slice(2)) : ''
      return gopherLine(t, display, selector, url.hostname, port)
    } catch {
      return infoLine(`${display} (bad gopher url)`)
    }
  }

  // Web, as a standard hURL item.
  if (/^https?:\/\//.test(link)) {
    return gopherLine('h', display, `URL:${link}`, bridge.host, bridge.port)
  }

  return infoLine(`${display} (unrecognised link)`)
}

export function renderMenu(lines: MapLine[], ownerNpub: string, bridge: BridgeAddr): string {
  let out = ''
  for (const line of lines) {
    out +=
      line.type === 'i' || line.link === undefined
        ? infoLine(line.display)
        : resolveLink(line, ownerNpub, bridge)
  }
  return out + '.\r\n'
}

export function renderText(content: string): string {
  const lines = content.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const stuffed = lines.map((l) => (l.startsWith('.') ? `.${l}` : l))
  return stuffed.join('\r\n') + '\r\n.\r\n'
}

export function renderError(message: string): string {
  return `3${clean(message)}${INFO_TAIL}\r\n.\r\n`
}
