import * as nip19 from 'nostr-tools/nip19'
import type { MapLine } from './linemap.ts'
import { BURROW_KIND, LONG_FORM_KIND } from './protocol.ts'

// Protocol-neutral link resolution: burrowmap lines become MenuItems with
// abstract targets, which the gopher and gemini renderers turn into wire
// formats.

export type LinkTarget =
  | { scheme: 'none' }
  | { scheme: 'hole'; npub: string; path: string }
  | { scheme: 'gopher'; host: string; port: number; itemType: string; selector: string }
  | { scheme: 'web'; url: string }
  | { scheme: 'invalid'; reason: string }

export interface MenuItem {
  type: string
  display: string
  target: LinkTarget
}

export function info(display: string): MenuItem {
  return { type: 'i', display, target: { scheme: 'none' } }
}

function normalisePath(p: string): string {
  const cleaned = ('/' + p.replace(/^\/+/, '')).replace(/\/+$/, '')
  return cleaned === '' ? '/' : cleaned
}

export function resolveMapLine(line: MapLine, ownerNpub: string): MenuItem {
  const { type, display } = line
  if (line.link === undefined || type === 'i') return info(display)
  const link = line.link

  // Same-hole absolute path.
  if (link.startsWith('/')) {
    return { type, display, target: { scheme: 'hole', npub: ownerNpub, path: normalisePath(link) } }
  }

  // Nostr entities: another hole's document, an npub (their hole root), or
  // a long-form article (served from the virtual hole).
  const bech = link.startsWith('nostr:') ? link.slice(6) : link
  if (/^(naddr|npub|nprofile)1/.test(bech)) {
    try {
      const decoded = nip19.decode(bech)
      if (decoded.type === 'npub') {
        return { type, display, target: { scheme: 'hole', npub: bech, path: '/' } }
      }
      if (decoded.type === 'nprofile') {
        const npub = nip19.npubEncode(decoded.data.pubkey)
        return { type, display, target: { scheme: 'hole', npub, path: '/' } }
      }
      if (decoded.type === 'naddr') {
        const { kind, pubkey, identifier } = decoded.data
        const npub = nip19.npubEncode(pubkey)
        if (kind === BURROW_KIND) {
          return { type, display, target: { scheme: 'hole', npub, path: normalisePath(identifier) } }
        }
        if (kind === LONG_FORM_KIND) {
          return { type: '0', display, target: { scheme: 'hole', npub, path: `/articles/${identifier}` } }
        }
      }
      throw new Error('unsupported entity')
    } catch {
      return { type: 'i', display, target: { scheme: 'invalid', reason: 'unresolvable link' } }
    }
  }

  // Legacy gopherspace, served with its real host.
  if (link.startsWith('gopher://')) {
    try {
      const url = new URL(link)
      const port = url.port === '' ? 70 : Number(url.port)
      const itemType = url.pathname.length > 1 ? url.pathname[1]! : '1'
      const selector = url.pathname.length > 2 ? decodeURIComponent(url.pathname.slice(2)) : ''
      return { type, display, target: { scheme: 'gopher', host: url.hostname, port, itemType, selector } }
    } catch {
      return { type: 'i', display, target: { scheme: 'invalid', reason: 'bad gopher url' } }
    }
  }

  if (/^https?:\/\//.test(link)) {
    return { type, display, target: { scheme: 'web', url: link } }
  }

  return { type: 'i', display, target: { scheme: 'invalid', reason: 'unrecognised link' } }
}

export function resolveMapLines(lines: MapLine[], ownerNpub: string): MenuItem[] {
  return lines.map((l) => resolveMapLine(l, ownerNpub))
}
