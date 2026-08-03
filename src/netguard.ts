import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

// SSRF guard for the internet-exposed gopher proxy. A remote visitor names
// the host, so the bridge must refuse to connect to loopback, private,
// link-local (incl. 169.254.169.254 cloud metadata) or other internal
// ranges. Not applied to the CLI/terminal client, where the user connects
// to hosts on their own behalf, the same as curl.

export class BlockedHostError extends Error {}

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
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast and reserved, incl. 255.255.255.255
  return false
}

function ipv6Blocked(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '')
  // IPv4-mapped / -compatible: judge by the embedded v4 address.
  const mapped = /(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(lower)
  if (mapped) return ipv4Blocked(mapped[1] as string)
  if (lower === '::1' || lower === '::') return true
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true // link-local fe80::/10
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  if (lower.startsWith('ff')) return true // multicast ff00::/8
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
  return isIP(host) !== 0 && isBlockedAddress(host)
}

// Relay hints arrive from content the bridge did not write (an `nprofile`
// or `naddr` inside someone else's kindmap), so they are untrusted input
// that would otherwise become an outbound connection. Keep only ws/wss
// URLs that are not bare internal addresses, and cap how many are taken.
export function safeRelayUrls(urls: readonly string[] | undefined, max = 4): string[] {
  if (!urls) return []
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
    if (urlHostBlocked(url.href)) continue
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
