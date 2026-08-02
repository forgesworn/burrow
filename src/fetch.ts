import { SimplePool } from 'nostr-tools/pool'
import type { Event } from 'nostr-tools'
import { BURROW_KIND, docPath, isExpired } from './protocol.ts'

interface CacheEntry<T> {
  at: number
  value: T
}

// Fetches burrow documents from relays with a small TTL cache so gopher
// clients hammering menus don't hammer relays.
export class HoleStore {
  private pool = new SimplePool()
  private docs = new Map<string, CacheEntry<Event | null>>()
  private holes = new Map<string, CacheEntry<Event[]>>()
  private relays: string[]
  private ttlMs: number

  constructor(relays: string[], ttlMs = 60_000) {
    this.relays = relays
    this.ttlMs = ttlMs
  }

  async doc(pubkey: string, path: string): Promise<Event | null> {
    const key = `${pubkey}|${path}`
    const hit = this.docs.get(key)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value
    const events = await this.pool.querySync(
      this.relays,
      { kinds: [BURROW_KIND], authors: [pubkey], '#d': [path] },
      { maxWait: 4000 },
    )
    const value = latest(events)
    this.docs.set(key, { at: Date.now(), value })
    return value
  }

  async hole(pubkey: string): Promise<Event[]> {
    const hit = this.holes.get(pubkey)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value
    const events = await this.pool.querySync(
      this.relays,
      { kinds: [BURROW_KIND], authors: [pubkey], limit: 500 },
      { maxWait: 6000 },
    )
    const now = Math.floor(Date.now() / 1000)
    const byPath = new Map<string, Event>()
    for (const ev of events) {
      if (isExpired(ev, now)) continue
      const path = docPath(ev)
      const prev = byPath.get(path)
      if (!prev || prev.created_at < ev.created_at) byPath.set(path, ev)
    }
    const value = [...byPath.values()].sort((a, b) => docPath(a).localeCompare(docPath(b)))
    this.holes.set(pubkey, { at: Date.now(), value })
    return value
  }

  close(): void {
    this.pool.destroy()
  }
}

function latest(events: Event[]): Event | null {
  const now = Math.floor(Date.now() / 1000)
  let best: Event | null = null
  for (const ev of events) {
    if (isExpired(ev, now)) continue
    if (!best || ev.created_at > best.created_at) best = ev
  }
  return best
}
