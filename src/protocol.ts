import type { Event } from 'nostr-tools'

// Addressable event kind for burrow documents. 31436 after RFC 1436,
// the Gopher protocol specification.
export const BURROW_KIND = 31436

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
