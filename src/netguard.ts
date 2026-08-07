import { isIP, type LookupFunction } from 'node:net'
import { lookup as dnsLookup } from 'node:dns'
import { lookup } from 'node:dns/promises'
import process from 'node:process'
import WebSocket from 'ws'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { useWebSocketImplementation } from 'nostr-tools/pool'

// SSRF guard for the internet-exposed gopher proxy. A remote visitor names
// the host, so the bridge must refuse to connect to loopback, private,
// link-local (incl. 169.254.169.254 cloud metadata) or other internal
// ranges. Not applied to the CLI/terminal client, where the user connects
// to hosts on their own behalf, the same as curl.

export class BlockedHostError extends Error {}

const trustedRelayOrigins = new Set<string>()

// Optional SOCKS5 proxy (typically Tor's 127.0.0.1:9050) for all relay
// connections. Readers who do not want a relay to learn their network
// location set GOPHERKIND_PROXY=socks5h://127.0.0.1:9050 or pass --proxy.
// socks5h resolves DNS at the proxy, which is also what makes .onion relay
// URLs reachable. When a proxy is active the socket-time lookup guard below
// cannot run (the proxy, not us, resolves and dials), so untrusted URLs get
// only the hostname-level internal-address check.
let proxyAgent: SocksProxyAgent | null = null

export function configureProxy(raw: string | undefined | null): void {
  if (raw === undefined || raw === null || raw === '') {
    proxyAgent = null
    return
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`invalid proxy URL: ${raw}`)
  }
  if (url.protocol !== 'socks5:' && url.protocol !== 'socks5h:') {
    throw new Error('only socks5:// or socks5h:// proxies are supported (use socks5h for Tor)')
  }
  // Normalise to socks5h so DNS always resolves at the proxy. With socks5 the
  // client resolves first, which leaks the query locally and cannot resolve
  // .onion at all.
  proxyAgent = new SocksProxyAgent(`socks5h://${url.host}`)
}

export function proxyActive(): boolean {
  return proxyAgent !== null
}

function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
}

// Relay URLs supplied by the bridge operator are allowed to point at a local
// development relay. Author relay lists, kindmap hints and bunker URIs are not
// trusted and always go through the public-address lookup below.
export function trustRelayUrls(urls: readonly string[]): void {
  for (const raw of urls) {
    const origin = originOf(raw)
    if (origin !== null) trustedRelayOrigins.add(origin)
  }
}

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return true // this-network, private, loopback
  if (a === 169 && b === 254) return true // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0 && parts[2] === 0) return true // IETF protocol
  if (a === 192 && b === 0 && parts[2] === 2) return true // documentation
  if (a === 192 && b === 88 && parts[2] === 99) return true // deprecated 6to4 relay
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true // documentation
  if (a === 203 && b === 0 && parts[2] === 113) return true // documentation
  if (a >= 224) return true // multicast and reserved, incl. 255.255.255.255
  return false
}

function ipv6Words(ip: string): number[] | null {
  let text =
    ip
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  const dotted = /((?:\d{1,3}\.){3}\d{1,3})$/.exec(text)?.[1]
  if (dotted !== undefined) {
    const octets = dotted.split('.').map(Number)
    if (octets.length !== 4 || octets.some((n) => n < 0 || n > 255)) return null
    const high = (((octets[0] as number) << 8) | (octets[1] as number)).toString(16)
    const low = (((octets[2] as number) << 8) | (octets[3] as number)).toString(16)
    text = `${text.slice(0, -dotted.length)}${high}:${low}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parseHalf = (half: string): number[] | null => {
    if (half === '') return []
    const words = half.split(':')
    if (words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null
    return words.map((word) => Number.parseInt(word, 16))
  }
  const left = parseHalf(halves[0] ?? '')
  const right = parseHalf(halves[1] ?? '')
  if (left === null || right === null) return null
  if (halves.length === 1) return left.length === 8 ? left : null
  const zeros = 8 - left.length - right.length
  return zeros > 0 ? [...left, ...Array<number>(zeros).fill(0), ...right] : null
}

function ipv6Blocked(ip: string): boolean {
  const words = ipv6Words(ip)
  if (words === null) return true
  const [first = 0] = words
  const allButLastZero = words.slice(0, 7).every((word) => word === 0)
  if (allButLastZero && (words[7] === 0 || words[7] === 1)) return true

  // IPv4-mapped and the older IPv4-compatible forms can be written with
  // hexadecimal hextets as well as dotted decimal. Judge their final 32 bits
  // as IPv4 so ::ffff:7f00:1 cannot bypass the loopback rule.
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
  const compatible = words.slice(0, 6).every((word) => word === 0)
  const translated =
    words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0
  if (mapped || compatible || translated) {
    const v4 = `${(words[6] as number) >> 8}.${(words[6] as number) & 0xff}.${
      (words[7] as number) >> 8
    }.${(words[7] as number) & 0xff}`
    return ipv4Blocked(v4)
  }

  if ((first & 0xfe00) === 0xfc00) return true // unique-local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true // deprecated site-local fec0::/10
  if ((first & 0xff00) === 0xff00) return true // multicast ff00::/8
  if ((first & 0xe000) !== 0x2000) return true // outside global-unicast 2000::/3
  if (first === 0x2002) return true // 6to4 transition addresses
  if (first === 0x2001 && words[1] === 0) return true // Teredo
  if (first === 0x2001 && words[1] === 0x0db8) return true // documentation
  if (
    first === 0x2001 &&
    (((words[1] as number) & 0xfff0) === 0x0010 || ((words[1] as number) & 0xfff0) === 0x0020)
  ) {
    return true // ORCHID, not globally routed
  }
  return false
}

export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return ipv4Blocked(ip)
  if (kind === 6) return ipv6Blocked(ip)
  return true // not an IP literal: caller must resolve first
}

// Cheap literal-IP check for a URL's host, used to keep the NIP-46 pairing
// flow from dialling an internal address given as a bare IP. Hostnames pass
// here (they are not resolved); the check catches the obvious internal case.
export function urlHostBlocked(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return true
  return isIP(host) !== 0 && isBlockedAddress(host)
}

// Relay hints arrive from content the bridge did not write (an `nprofile`
// or `naddr` inside someone else's kindmap), so they are untrusted input
// that would otherwise become an outbound connection. Keep only ws/wss
// URLs that are not bare internal addresses, and cap how many are taken.
export function safeRelayUrls(
  urls: readonly string[] | undefined,
  max = 4,
  allowLocal = false,
): string[] {
  if (!urls || max <= 0) return []
  const out: string[] = []
  for (const raw of urls) {
    if (typeof raw !== 'string' || raw.length > 200) continue
    let url: URL
    try {
      url = new URL(raw.trim())
    } catch {
      continue
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') continue
    if (!allowLocal && urlHostBlocked(url.href)) continue
    const normalised = url.href.replace(/\/$/, '')
    if (!out.includes(normalised)) out.push(normalised)
    if (out.length >= max) break
  }
  return out
}

// Validate a proxy target host and return the IP to connect to. Resolving
// here and connecting to the returned literal closes the DNS-rebinding
// window between check and connect.
export async function resolvePublicHost(host: string): Promise<string> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare) !== 0) {
    if (isBlockedAddress(bare)) throw new BlockedHostError(`refusing to proxy to ${host}`)
    return bare
  }
  let addrs: { address: string }[]
  try {
    addrs = await lookup(bare, { all: true })
  } catch {
    throw new BlockedHostError(`could not resolve ${host}`)
  }
  if (addrs.length === 0) throw new BlockedHostError(`could not resolve ${host}`)
  for (const { address } of addrs) {
    if (isBlockedAddress(address))
      throw new BlockedHostError(`refusing to proxy to ${host} (${address})`)
  }
  return (addrs[0] as { address: string }).address
}

// Resolve untrusted relay URLs before handing them to nostr-tools. This gives
// callers a useful early rejection; the WebSocket lookup below repeats the
// check at connection time and pins the selected address, closing DNS rebinding
// between validation and dial.
export async function publicRelayUrls(urls: readonly string[]): Promise<string[]> {
  const out: string[] = []
  for (const raw of safeRelayUrls(urls)) {
    let url: URL
    try {
      url = new URL(raw)
      if (url.hostname.toLowerCase().endsWith('.onion')) {
        // Onion services are only reachable through a proxy that resolves
        // remotely; without one the URL is useless and dropped.
        if (proxyActive()) out.push(raw)
        continue
      }
      // With a proxy the remote side resolves and dials, so a local
      // resolution check adds nothing.
      if (!proxyActive()) await resolvePublicHost(url.hostname)
    } catch {
      continue
    }
    out.push(raw)
  }
  return out
}

function accessDenied(hostname: string, detail?: string): NodeJS.ErrnoException {
  const err = new Error(
    detail === undefined
      ? `refusing to connect to ${hostname}`
      : `refusing to connect to ${hostname} (${detail})`,
  ) as NodeJS.ErrnoException
  err.code = 'EACCES'
  return err
}

// `ws` calls this at the point where it opens the TCP socket. All answers are
// checked and a validated literal is returned, so a second DNS lookup cannot
// redirect the connection into loopback or a private network.
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, '', 0)
      return
    }
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (list.length === 0) {
      callback(accessDenied(hostname), '', 0)
      return
    }
    const blocked = list.find(({ address }) => isBlockedAddress(address))
    if (blocked !== undefined) {
      callback(accessDenied(hostname, blocked.address), '', 0)
      return
    }
    if (options.all) {
      callback(null, list)
      return
    }
    const wanted = options.family === 4 || options.family === 6 ? options.family : 0
    const selected = list.find(({ family }) => wanted === 0 || family === wanted)
    if (selected === undefined) {
      callback(accessDenied(hostname, `no IPv${wanted} address`), '', 0)
      return
    }
    callback(null, selected.address, selected.family)
  })
}

class GuardedWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    const raw = String(address)
    const origin = originOf(raw)
    const trusted = origin !== null && trustedRelayOrigins.has(origin)
    if (proxyAgent !== null) {
      // A trusted relay that is also a local address is a development relay;
      // dial it directly, Tor cannot reach it. Everything else goes through
      // the proxy. Untrusted URLs still get the hostname-level internal
      // check, since the socket-time lookup guard cannot run through a proxy.
      if (trusted && urlHostBlocked(raw)) {
        super(address, protocols ?? [])
        return
      }
      if (urlHostBlocked(raw)) throw new BlockedHostError(`refusing ${raw}`)
      super(address, protocols ?? [], { agent: proxyAgent })
      return
    }
    if (trusted) {
      super(address, protocols ?? [])
      return
    }
    super(address, protocols ?? [], { lookup: publicLookup })
  }
}

// nostr-tools centralises relay construction behind this hook. Install the
// guarded implementation once so HoleStore, publishers and NIP-46 all use the
// same connection-time network boundary.
useWebSocketImplementation(GuardedWebSocket)

// Env-var configuration applies to every flow (readers, publishers, NIP-46,
// the bridge) without each call site threading the option through.
configureProxy(process.env['GOPHERKIND_PROXY'])
