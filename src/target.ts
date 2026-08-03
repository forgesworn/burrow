import * as nip19 from 'nostr-tools/nip19'
import { queryProfile } from 'nostr-tools/nip05'
import { BURROW_KIND, LONG_FORM_KIND } from './protocol.ts'

// One parser for everything a client can point at: a Nostr hole (npub,
// nprofile, naddr, with or without a path) or a traditional gopher server.
// A gopher:// URL whose selector starts with an npub is another burrow
// bridge; the client goes native instead of proxying through it, so the
// same document is read from your own relays.

export interface GopherTarget {
  host: string
  port: number
  type: string
  selector: string
}

export type ClientTarget =
  | { kind: 'hole'; pubkey: string; npub: string; path: string }
  | ({ kind: 'gopher' } & GopherTarget)

export class TargetError extends Error {}

const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{58}$/

export function parseProxyPath(path: string): GopherTarget | null {
  // /gopher/<host>[:port]/<type><selector...>, where the selector keeps its
  // own leading slash so it round-trips to the origin server byte for byte.
  const m = /^\/gopher\/([^/]+)(?:\/([0-9a-zA-Z+]))?(\/.*)?$/.exec(path)
  if (!m) return null
  const hostPart = m[1] as string
  const [host, portRaw] = hostPart.split(':')
  if (!host) return null
  const port = portRaw ? Number(portRaw) : 70
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  // A bare "/" is the root selector, i.e. empty.
  const raw = m[3] ?? ''
  return { host, port, type: m[2] ?? '1', selector: raw === '/' ? '' : raw }
}

export function proxyPath(t: GopherTarget): string {
  const hostPart = t.port === 70 ? t.host : `${t.host}:${t.port}`
  // Preserve the selector's leading slash; many gopher servers treat /world
  // and world as different selectors and 404 on the wrong one. A lone "/" is
  // the root, same as empty.
  const selector =
    t.selector === '' || t.selector === '/'
      ? ''
      : t.selector.startsWith('/')
        ? t.selector
        : `/${t.selector}`
  return `/gopher/${hostPart}/${t.type}${selector}`
}

function normalisePath(p: string): string {
  const cleaned = ('/' + p.replace(/^\/+/, '')).replace(/\/+$/, '')
  if (cleaned.split('/').some((s) => s === '..')) throw new TargetError('bad path')
  return cleaned === '' ? '/' : cleaned
}

function holeFromBech(bech: string, path: string): ClientTarget {
  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(bech)
  } catch {
    throw new TargetError(`not a nostr entity: ${bech}`)
  }
  if (decoded.type === 'npub') {
    return { kind: 'hole', pubkey: decoded.data, npub: bech, path: normalisePath(path) }
  }
  if (decoded.type === 'nprofile') {
    const npub = nip19.npubEncode(decoded.data.pubkey)
    return { kind: 'hole', pubkey: decoded.data.pubkey, npub, path: normalisePath(path) }
  }
  if (decoded.type === 'naddr') {
    const { kind, pubkey, identifier } = decoded.data
    const npub = nip19.npubEncode(pubkey)
    if (kind === BURROW_KIND) {
      return { kind: 'hole', pubkey, npub, path: normalisePath(identifier) }
    }
    if (kind === LONG_FORM_KIND) {
      return { kind: 'hole', pubkey, npub, path: `/articles/${identifier}` }
    }
    throw new TargetError(`naddr kind ${kind} is not browsable`)
  }
  throw new TargetError(`cannot browse a ${decoded.type}`)
}

// A selector that leads with an npub is a burrow hole wherever it is
// found, including inside a traditional gophermap pointing at a bridge.
export function holeFromSelector(selector: string): ClientTarget | null {
  const trimmed = selector.replace(/^\/+/, '')
  const [head, ...rest] = trimmed.split('/')
  if (head === undefined || !NPUB_RE.test(head)) return null
  try {
    return holeFromBech(head, '/' + rest.join('/'))
  } catch {
    return null
  }
}

function gopherFromUrl(raw: string): ClientTarget {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TargetError(`bad gopher url: ${raw}`)
  }
  const port = url.port === '' ? 70 : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TargetError(`bad port in ${raw}`)
  }
  const type = url.pathname.length > 1 ? (url.pathname[1] as string) : '1'
  const selector = url.pathname.length > 2 ? decodeURIComponent(url.pathname.slice(2)) : ''
  const native = holeFromSelector(selector)
  if (native) return native
  return { kind: 'gopher', host: url.hostname, port, type, selector }
}

// name@domain, optionally followed by a hole path. The name part is the
// NIP-05 local-part grammar; the domain needs at least one dot.
const NIP05_TARGET_RE = /^([\w.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+)(\/.*)?$/

export type Nip05Resolver = (fullname: string) => Promise<string | null>

async function defaultNip05Resolver(fullname: string): Promise<string | null> {
  const profile = await queryProfile(fullname)
  return profile?.pubkey ?? null
}

// Async form: everything parseClientTarget accepts, plus NIP-05 names
// like someone@example.org[/path], resolved over HTTPS.
export async function resolveClientTarget(
  input: string,
  resolver: Nip05Resolver = defaultNip05Resolver,
): Promise<ClientTarget> {
  const t = input.trim().replace(/^nostr:/, '')
  const m = NIP05_TARGET_RE.exec(t)
  if (m) {
    const fullname = m[1] as string
    let pubkey: string | null
    try {
      pubkey = await resolver(fullname)
    } catch {
      pubkey = null
    }
    if (pubkey === null) throw new TargetError(`could not resolve ${fullname} (NIP-05)`)
    const npub = nip19.npubEncode(pubkey)
    return { kind: 'hole', pubkey, npub, path: normalisePath(m[2] ?? '/') }
  }
  return parseClientTarget(input)
}

export function parseClientTarget(input: string): ClientTarget {
  let t = input.trim()
  if (t === '') throw new TargetError('empty target')
  if (t.startsWith('nostr:')) t = t.slice(6)

  if (/^(npub|nprofile|naddr)1/.test(t.replace(/^\/+/, '').split('/')[0] ?? '')) {
    const trimmed = t.replace(/^\/+/, '')
    const [head, ...rest] = trimmed.split('/')
    return holeFromBech(head as string, '/' + rest.join('/'))
  }

  if (t.startsWith('gopher://')) return gopherFromUrl(t)

  if (t.startsWith('/gopher/')) {
    const target = parseProxyPath(t)
    if (!target) throw new TargetError(`bad proxy path: ${t}`)
    return holeFromSelector(target.selector) ?? { kind: 'gopher', ...target }
  }

  // A hostname has a dot (or a :port); anything else is a typo, not a hole.
  const hostPart = t.split('/')[0] ?? ''
  if (/^[a-zA-Z0-9.-]+(:\d+)?$/.test(hostPart) && /[.:]/.test(hostPart)) {
    return gopherFromUrl(`gopher://${t}`)
  }

  throw new TargetError(
    `cannot make sense of ${input}; give an npub, a nostr: entity or a gopher:// url`,
  )
}

// Canonical string form; parseClientTarget round-trips it. Used for
// bookmarks and history.
export function refOf(target: ClientTarget): string {
  if (target.kind === 'hole') {
    return target.path === '/' ? target.npub : `${target.npub}${target.path}`
  }
  const port = target.port === 70 ? '' : `:${target.port}`
  const selector = target.selector.replace(/^\//, '')
  return `gopher://${target.host}${port}/${target.type}${selector === '' ? '' : `/${selector}`}`
}

// Short human form for prompts and history listings.
export function describeTarget(target: ClientTarget): string {
  if (target.kind === 'hole') {
    const who = `${target.npub.slice(0, 12)}...`
    return target.path === '/' ? who : `${who}${target.path}`
  }
  const port = target.port === 70 ? '' : `:${target.port}`
  const sel = target.selector.replace(/^\//, '')
  return `${target.host}${port}${sel === '' ? '' : `/${sel}`}`
}

// One level towards the root; null when already there.
export function upOf(target: ClientTarget): ClientTarget | null {
  if (target.kind === 'hole') {
    if (target.path === '/') return null
    const parent = target.path.replace(/\/[^/]+$/, '')
    return { ...target, path: parent === '' ? '/' : parent }
  }
  const sel = target.selector.replace(/^\/+/, '').replace(/\/+$/, '')
  if (sel === '') return null
  const parent = sel.split('/').slice(0, -1).join('/')
  return {
    kind: 'gopher',
    host: target.host,
    port: target.port,
    type: '1',
    selector: parent === '' ? '' : `/${parent}`,
  }
}
