import type { Event } from 'nostr-tools'

// Addressable event kind for gopherkind documents. 31436 after RFC 1436,
// the Gopher protocol specification.
export const DOC_KIND = 31436

export const PROFILE_KIND = 0
export const NOTE_KIND = 1
export const CONTACTS_KIND = 3
export const DELETE_KIND = 5
export const RELAY_LIST_KIND = 10002
export const LONG_FORM_KIND = 30023

// NIP-65: an author's write relays are where their events actually live.
// `r` tags are `["r", url]` (read+write) or `["r", url, "read"|"write"]`.
export function writeRelays(ev: Event, max = 4): string[] {
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'r' || !t[1]) continue
    const marker = t[2]
    if (marker === undefined || marker === 'write') out.push(t[1])
    if (out.length >= max) break
  }
  return out
}

export function isoDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10)
}

export function firstLine(text: string, max = 60): string {
  const line = (text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

export function tagValue(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

export function docPath(ev: Event): string {
  return tagValue(ev, 'd') ?? '/'
}

export function docType(ev: Event): '0' | '1' {
  return tagValue(ev, 'type') === '1' ? '1' : '0'
}

export function docTitle(ev: Event): string {
  return tagValue(ev, 'title') ?? docPath(ev)
}

export function isExpired(ev: Event, nowSeconds: number): boolean {
  const exp = tagValue(ev, 'expiration')
  return exp !== undefined && Number(exp) <= nowSeconds
}
