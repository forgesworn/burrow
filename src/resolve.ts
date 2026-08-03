import * as nip19 from 'nostr-tools/nip19'
import type { MapLine } from './linemap.ts'
import { DOC_KIND, LONG_FORM_KIND } from './protocol.ts'
import { safeRelayUrls } from './netguard.ts'

// Protocol-neutral link resolution: kindmap lines become MenuItems with
// abstract targets, which the gopher and gemini renderers turn into wire
// formats.

export type LinkTarget =
  | { scheme: 'none' }
  // `relays` carries the NIP-19 hints from an nprofile/naddr link, so a
  // bridge can find the linked hole on relays it does not itself carry.
  // It never reaches the wire: a gopher selector has nowhere to put it.
  | { scheme: 'hole'; npub: string; path: string; relays?: string[] }
  // A bare selector on this bridge, not prefixed with an npub. Used by the
  // loopback /me menu, whose paths are the selectors themselves.
  | { scheme: 'self'; path: string }
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

// Only these schemes may become a rendered link. Blocks javascript: and
// data: URLs, which a hostile gopher server could otherwise plant in an
// h/URL: line and have the HTML frontend emit as a live href.
const SAFE_URL = /^(?:https?|gopher|gemini|nostr):/i

export function isSafeWebUrl(url: string): boolean {
  return SAFE_URL.test(url.trim())
}

// Spread form, so a target with no usable hint is byte-identical to one
// built before hints existed.
function hints(relays: string[]): { relays?: string[] } {
  return relays.length > 0 ? { relays } : {}
}

// Every relay hint a rendered menu carries, keyed by npub. A gopher
// selector cannot carry the hint to the next request, so the bridge
// remembers it instead: see HoleStore.addRelayHints.
export function relayHints(items: MenuItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const item of items) {
    const t = item.target
    if (t.scheme !== 'hole' || !t.relays || t.relays.length === 0) continue
    const prev = out.get(t.npub)
    out.set(t.npub, prev ? [...new Set([...prev, ...t.relays])] : t.relays)
  }
  return out
}

function normalisePath(p: string): string {
  const cleaned = `/${p.replace(/^\/+/, '')}`.replace(/\/+$/, '')
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
        const relays = safeRelayUrls(decoded.data.relays)
        return { type, display, target: { scheme: 'hole', npub, path: '/', ...hints(relays) } }
      }
      if (decoded.type === 'naddr') {
        const { kind, pubkey, identifier } = decoded.data
        const npub = nip19.npubEncode(pubkey)
        const relays = safeRelayUrls(decoded.data.relays)
        if (kind === DOC_KIND) {
          return {
            type,
            display,
            target: { scheme: 'hole', npub, path: normalisePath(identifier), ...hints(relays) },
          }
        }
        if (kind === LONG_FORM_KIND) {
          return {
            type: '0',
            display,
            target: {
              scheme: 'hole',
              npub,
              path: `/articles/${identifier}`,
              ...hints(relays),
            },
          }
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
      return {
        type,
        display,
        target: { scheme: 'gopher', host: url.hostname, port, itemType, selector },
      }
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
