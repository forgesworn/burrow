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

export interface DocumentMeta {
  path: string
  type: '0' | '1'
  title: string
}

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

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

export function replaceControlCharacters(value: string, replacement = ' '): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) as number
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? replacement : character
    })
    .join('')
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

// Paths are identifiers, not filesystem paths or URLs. Never canonicalise a
// signed `d` before comparing it with another event.
export function isValidDocPath(path: string): boolean {
  if (path === '/') return true
  if (
    !path.startsWith('/') ||
    path.endsWith('/') ||
    !isWellFormedUnicode(path) ||
    hasControlCharacters(path)
  ) {
    return false
  }
  return path
    .slice(1)
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

// Strict receiver validation for kind 31436. Exactly one `d` and `type`
// avoids different readers choosing different coordinates or content types.
export function parseDocument(ev: Event): DocumentMeta | null {
  if (ev.kind !== DOC_KIND) return null
  const paths = ev.tags.filter((t) => t[0] === 'd')
  const types = ev.tags.filter((t) => t[0] === 'type')
  const titles = ev.tags.filter((t) => t[0] === 'title')
  if (paths.length !== 1 || types.length !== 1 || titles.length > 1) return null
  const path = paths[0]?.[1]
  const type = types[0]?.[1]
  const title = titles[0]?.[1] ?? path
  if (path === undefined || !isValidDocPath(path)) return null
  if (type !== '0' && type !== '1') return null
  if (title === undefined || !isWellFormedUnicode(title) || hasControlCharacters(title)) return null
  return { path, type, title }
}

function requireDocument(ev: Event): DocumentMeta {
  const doc = parseDocument(ev)
  if (!doc) throw new Error('invalid kind 31436 document')
  return doc
}

export function docPath(ev: Event): string {
  return requireDocument(ev).path
}

export function docType(ev: Event): '0' | '1' {
  return requireDocument(ev).type
}

export function docTitle(ev: Event): string {
  return requireDocument(ev).title
}

export function isExpired(ev: Event, nowSeconds: number): boolean {
  const timestamp = expirationTimestamp(ev)
  return timestamp !== null && timestamp <= nowSeconds
}

export function expirationTimestamp(ev: Event): number | null {
  const exp = tagValue(ev, 'expiration')
  if (exp === undefined || !/^\d+$/.test(exp)) return null
  const timestamp = Number(exp)
  return Number.isSafeInteger(timestamp) ? timestamp : null
}

// NIP-01 replacement order. Callers group addressable events by coordinate
// before using these helpers.
export function isNewerEvent(a: Event, b: Event): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at
  return a.id < b.id
}

export function replacementWinner(events: Event[]): Event | null {
  let winner: Event | null = null
  for (const event of events) {
    if (winner === null || isNewerEvent(event, winner)) winner = event
  }
  return winner
}

// Expiry is deliberately evaluated after replacement selection. Filtering
// first would resurrect an older revision of the same coordinate.
export function currentReplacement(events: Event[], nowSeconds: number): Event | null {
  const winner = replacementWinner(events)
  return winner !== null && !isExpired(winner, nowSeconds) ? winner : null
}

// Gopherkind validation also follows selection. A malformed newer event can
// make a coordinate absent, but must never expose a valid revision which a
// conforming relay was entitled to discard.
export function currentDocument(events: Event[], nowSeconds: number): Event | null {
  const winner = replacementWinner(events)
  return winner !== null && parseDocument(winner) !== null && !isExpired(winner, nowSeconds)
    ? winner
    : null
}
