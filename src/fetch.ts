import { SimplePool } from 'nostr-tools/pool'
import type { Event, Filter } from 'nostr-tools'
import { TtlLru } from './lru.ts'
import {
  BURROW_KIND,
  PROFILE_KIND,
  NOTE_KIND,
  LONG_FORM_KIND,
  docPath,
  isExpired,
  tagValue,
} from './protocol.ts'

const MINUTE = 60_000

// Fetches events from relays with bounded TTL caches so gopher clients
// hammering menus don't hammer relays. One-shot queries only; no live
// subscriptions.
export class HoleStore {
  private pool = new SimplePool()
  private relays: string[]
  private docsCache = new TtlLru<Event | null>(500, MINUTE)
  private holeCache = new TtlLru<Event[]>(100, MINUTE)
  private profileCache = new TtlLru<Event | null>(200, 5 * MINUTE)
  private notesCache = new TtlLru<Event[]>(100, 2 * MINUTE)
  private articlesCache = new TtlLru<Event[]>(100, 2 * MINUTE)
  private articleCache = new TtlLru<Event | null>(500, 2 * MINUTE)
  private eventCache = new TtlLru<Event | null>(500, 10 * MINUTE)
  private searchCache = new TtlLru<Event[]>(200, MINUTE)

  constructor(relays: string[]) {
    this.relays = relays
  }

  private async query(filter: Filter, maxWait: number): Promise<Event[]> {
    try {
      return await this.pool.querySync(this.relays, filter, { maxWait })
    } catch {
      return []
    }
  }

  async doc(pubkey: string, path: string): Promise<Event | null> {
    const key = `${pubkey}|${path}`
    const hit = this.docsCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [BURROW_KIND], authors: [pubkey], '#d': [path] }, 4000)
    const value = latest(events)
    this.docsCache.set(key, value)
    return value
  }

  async hole(pubkey: string): Promise<Event[]> {
    const hit = this.holeCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [BURROW_KIND], authors: [pubkey], limit: 500 }, 6000)
    const now = Math.floor(Date.now() / 1000)
    const byPath = new Map<string, Event>()
    for (const ev of events) {
      if (isExpired(ev, now)) continue
      const path = docPath(ev)
      const prev = byPath.get(path)
      if (!prev || prev.created_at < ev.created_at) byPath.set(path, ev)
    }
    const value = [...byPath.values()].sort((a, b) => docPath(a).localeCompare(docPath(b)))
    this.holeCache.set(pubkey, value)
    return value
  }

  async profile(pubkey: string): Promise<Event | null> {
    const hit = this.profileCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [PROFILE_KIND], authors: [pubkey], limit: 1 }, 4000)
    const value = latest(events)
    this.profileCache.set(pubkey, value)
    return value
  }

  async notes(pubkey: string): Promise<Event[]> {
    const hit = this.notesCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [NOTE_KIND], authors: [pubkey], limit: 100 }, 6000)
    const value = dedupeById(events)
      .filter((ev) => !ev.tags.some((t) => t[0] === 'e'))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 20)
    this.notesCache.set(pubkey, value)
    return value
  }

  async articles(pubkey: string): Promise<Event[]> {
    const hit = this.articlesCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [LONG_FORM_KIND], authors: [pubkey], limit: 100 }, 6000)
    const now = Math.floor(Date.now() / 1000)
    const byD = new Map<string, Event>()
    for (const ev of events) {
      if (isExpired(ev, now)) continue
      const d = tagValue(ev, 'd') ?? ''
      const prev = byD.get(d)
      if (!prev || prev.created_at < ev.created_at) byD.set(d, ev)
    }
    const value = [...byD.values()].sort((a, b) => b.created_at - a.created_at)
    this.articlesCache.set(pubkey, value)
    return value
  }

  async article(pubkey: string, d: string): Promise<Event | null> {
    const key = `${pubkey}|${d}`
    const hit = this.articleCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [LONG_FORM_KIND], authors: [pubkey], '#d': [d] },
      4000,
    )
    const value = latest(events)
    this.articleCache.set(key, value)
    return value
  }

  async event(id: string): Promise<Event | null> {
    const hit = this.eventCache.get(id)
    if (hit !== undefined) return hit
    const events = await this.query({ ids: [id] }, 4000)
    const value = events[0] ?? null
    this.eventCache.set(id, value)
    return value
  }

  // NIP-50. Relays without search support return nothing; the router
  // merges these results with its own client-side grep.
  async searchRelays(pubkey: string, q: string): Promise<Event[]> {
    const key = `${pubkey}|${q}`
    const hit = this.searchCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [BURROW_KIND, NOTE_KIND, LONG_FORM_KIND], authors: [pubkey], search: q, limit: 30 },
      4000,
    )
    const value = dedupeById(events)
    this.searchCache.set(key, value)
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

function dedupeById(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of events) byId.set(ev.id, ev)
  return [...byId.values()]
}
