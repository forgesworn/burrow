import { SimplePool } from 'nostr-tools/pool'
import type { Event, Filter } from 'nostr-tools'
import { TtlLru } from './lru.ts'
import {
  BURROW_KIND,
  PROFILE_KIND,
  NOTE_KIND,
  CONTACTS_KIND,
  RELAY_LIST_KIND,
  LONG_FORM_KIND,
  docPath,
  isExpired,
  tagValue,
  writeRelays,
} from './protocol.ts'
import { PAGE } from './virtual.ts'

const MINUTE = 60_000

// Relay hints come from other people's documents; a hole cannot make the
// bridge fan a query out across an unbounded relay set.
const MAX_HINTS = 4

// The subset of SimplePool the store uses, so tests can inject a fake and
// exercise the fetch/dedupe/expiry logic without a network.
export interface PoolLike {
  querySync(relays: string[], filter: Filter, opts: { maxWait: number }): Promise<Event[]>
  publish(relays: string[], event: Event): Promise<string>[]
  ensureRelay(url: string): Promise<{ onnotice: (() => void) | ((msg: string) => void) }>
  destroy(): void
}

// Fetches events from relays with bounded TTL caches so gopher clients
// hammering menus don't hammer relays. One-shot queries only; no live
// subscriptions.
export class HoleStore {
  private pool: PoolLike
  private relays: string[]
  private docsCache = new TtlLru<Event | null>(500, MINUTE)
  private holeCache = new TtlLru<Event[]>(100, MINUTE)
  private profileCache = new TtlLru<Event | null>(200, 5 * MINUTE)
  private notesCache = new TtlLru<Event[]>(100, 2 * MINUTE)
  private articlesCache = new TtlLru<Event[]>(100, 2 * MINUTE)
  private articleCache = new TtlLru<Event | null>(500, 2 * MINUTE)
  private eventCache = new TtlLru<Event | null>(500, 10 * MINUTE)
  private searchCache = new TtlLru<Event[]>(200, MINUTE)
  private contactsCache = new TtlLru<string[]>(100, 5 * MINUTE)
  private followersCache = new TtlLru<string[]>(100, 5 * MINUTE)
  private feedCache = new TtlLru<Event[]>(50, MINUTE)
  private relayListCache = new TtlLru<string[]>(200, 10 * MINUTE)
  private hintCache = new TtlLru<string[]>(200, 30 * MINUTE)
  private noticesSilenced = false

  constructor(relays: string[], pool: PoolLike = new SimplePool()) {
    this.relays = relays
    this.pool = pool
  }

  private async query(filter: Filter, maxWait: number, relays = this.relays): Promise<Event[]> {
    try {
      await this.silenceNotices()
      const events = await this.pool.querySync(relays, filter, { maxWait })
      // Expired events (NIP-40) must never be served; drop them at the one
      // choke point every read path goes through.
      const now = Math.floor(Date.now() / 1000)
      return events.filter((ev) => !isExpired(ev, now))
    } catch {
      return []
    }
  }

  // NIP-19 relay hints from an nprofile/naddr link. A gopher selector has
  // nowhere to carry them, so a hint seen while rendering a menu is
  // remembered here and widens the read set when the visitor follows the
  // link. Untrusted input: callers pass them through safeRelayUrls first,
  // and only a bounded number per author is kept.
  addRelayHints(pubkey: string, relays: string[]): void {
    if (relays.length === 0) return
    const merged = union(this.hintCache.get(pubkey) ?? [], relays).slice(0, MAX_HINTS)
    this.hintCache.set(pubkey, merged)
  }

  // NIP-65 outbox: an author's events live on their own write relays, which
  // the bridge may not carry. Resolve the author's kind 10002 list from the
  // bridge relays, then read that author from the bridge relays UNION their
  // write relays UNION any relay hints seen for them, so a hole is found
  // wherever it was actually published. Falls back to the bridge relays
  // alone when no list is found.
  private async authorRelays(pubkey: string): Promise<string[]> {
    const hinted = this.hintCache.get(pubkey) ?? []
    const hit = this.relayListCache.get(pubkey)
    if (hit !== undefined) return union(this.relays, union(hit, hinted))
    const events = await this.query(
      { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 },
      3000,
      union(this.relays, hinted),
    )
    const newest = events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
    const write = newest ? writeRelays(newest) : []
    this.relayListCache.set(pubkey, write)
    return union(this.relays, union(write, hinted))
  }

  // Relays without NIP-50 answer a `search` filter with a NOTICE, which
  // nostr-tools logs to the console by default. That is normal traffic,
  // not something a user needs to read.
  private async silenceNotices(): Promise<void> {
    if (this.noticesSilenced) return
    this.noticesSilenced = true
    await Promise.allSettled(
      this.relays.map(async (url) => {
        const relay = await this.pool.ensureRelay(url)
        relay.onnotice = () => {}
      }),
    )
  }

  async doc(pubkey: string, path: string): Promise<Event | null> {
    const key = `${pubkey}|${path}`
    const hit = this.docsCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [BURROW_KIND], authors: [pubkey], '#d': [path] },
      4000,
      await this.authorRelays(pubkey),
    )
    const value = latest(events)
    this.docsCache.set(key, value)
    return value
  }

  async hole(pubkey: string): Promise<Event[]> {
    const hit = this.holeCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [BURROW_KIND], authors: [pubkey], limit: 500 },
      6000,
      await this.authorRelays(pubkey),
    )
    const now = Math.floor(Date.now() / 1000)
    const byPath = new Map<string, Event>()
    for (const ev of events) {
      if (isExpired(ev, now)) continue
      const path = docPath(ev)
      const prev = byPath.get(path)
      if (!prev || isNewer(ev, prev)) byPath.set(path, ev)
    }
    const value = [...byPath.values()].sort((a, b) => docPath(a).localeCompare(docPath(b)))
    this.holeCache.set(pubkey, value)
    return value
  }

  async profile(pubkey: string): Promise<Event | null> {
    const hit = this.profileCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [PROFILE_KIND], authors: [pubkey], limit: 1 },
      4000,
      await this.authorRelays(pubkey),
    )
    const value = latest(events)
    this.profileCache.set(pubkey, value)
    return value
  }

  // `before` is a page cursor: the created_at of the oldest note already
  // shown. The boundary is exclusive, so a page never repeats a note; the
  // cost is that a second note sharing that exact timestamp is passed over,
  // which beats a cursor that can loop on a batch of same-second notes.
  async notes(pubkey: string, before?: number): Promise<Event[]> {
    const key = before === undefined ? pubkey : `${pubkey}|${before}`
    const hit = this.notesCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [NOTE_KIND], authors: [pubkey], limit: 100, ...(before ? { until: before } : {}) },
      6000,
      await this.authorRelays(pubkey),
    )
    const value = dedupeById(events)
      .filter((ev) => !ev.tags.some((t) => t[0] === 'e'))
      .filter((ev) => before === undefined || ev.created_at < before)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, PAGE)
    this.notesCache.set(key, value)
    return value
  }

  async articles(pubkey: string, before?: number): Promise<Event[]> {
    const key = before === undefined ? pubkey : `${pubkey}|${before}`
    const hit = this.articlesCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      {
        kinds: [LONG_FORM_KIND],
        authors: [pubkey],
        limit: 100,
        ...(before ? { until: before } : {}),
      },
      6000,
      await this.authorRelays(pubkey),
    )
    const now = Math.floor(Date.now() / 1000)
    const byD = new Map<string, Event>()
    for (const ev of events) {
      if (isExpired(ev, now)) continue
      const d = tagValue(ev, 'd') ?? ''
      const prev = byD.get(d)
      if (!prev || isNewer(ev, prev)) byD.set(d, ev)
    }
    const value = [...byD.values()]
      .filter((ev) => before === undefined || ev.created_at < before)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, PAGE)
    this.articlesCache.set(key, value)
    return value
  }

  async article(pubkey: string, d: string): Promise<Event | null> {
    const key = `${pubkey}|${d}`
    const hit = this.articleCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [LONG_FORM_KIND], authors: [pubkey], '#d': [d] },
      4000,
      await this.authorRelays(pubkey),
    )
    const value = latest(events)
    this.articleCache.set(key, value)
    return value
  }

  async event(id: string): Promise<Event | null> {
    const hit = this.eventCache.get(id)
    if (hit !== undefined) {
      // A cached event can expire within its TTL; re-check on every hit.
      if (hit && isExpired(hit, Math.floor(Date.now() / 1000))) return null
      return hit
    }
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
      await this.authorRelays(pubkey),
    )
    const value = dedupeById(events)
    this.searchCache.set(key, value)
    return value
  }

  async contacts(pubkey: string): Promise<string[]> {
    const hit = this.contactsCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query(
      { kinds: [CONTACTS_KIND], authors: [pubkey], limit: 1 },
      4000,
      await this.authorRelays(pubkey),
    )
    const newest = events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]
    const value = newest
      ? [...new Set(newest.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1] as string))]
      : []
    this.contactsCache.set(pubkey, value)
    return value
  }

  // Everyone whose contact list mentions this pubkey. Relays only know
  // what they carry, so this is a sample rather than a true count.
  async followers(pubkey: string): Promise<string[]> {
    const hit = this.followersCache.get(pubkey)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [CONTACTS_KIND], '#p': [pubkey], limit: 300 }, 6000)
    const value = [...new Set(events.map((ev) => ev.pubkey))]
    this.followersCache.set(pubkey, value)
    return value
  }

  async profilesBatch(pubkeys: string[]): Promise<Map<string, Event>> {
    const out = new Map<string, Event>()
    const missing: string[] = []
    for (const pk of new Set(pubkeys)) {
      const hit = this.profileCache.get(pk)
      if (hit === undefined) missing.push(pk)
      else if (hit !== null) out.set(pk, hit)
    }
    if (missing.length > 0) {
      const events = await this.query({ kinds: [PROFILE_KIND], authors: missing }, 4000)
      const byPk = new Map<string, Event>()
      for (const ev of events) {
        const prev = byPk.get(ev.pubkey)
        if (!prev || isNewer(ev, prev)) byPk.set(ev.pubkey, ev)
      }
      for (const pk of missing) {
        const ev = byPk.get(pk) ?? null
        this.profileCache.set(pk, ev)
        if (ev) out.set(pk, ev)
      }
    }
    return out
  }

  async feedNotes(pubkeys: string[]): Promise<Event[]> {
    if (pubkeys.length === 0) return []
    const key = pubkeySetKey(pubkeys)
    const hit = this.feedCache.get(key)
    if (hit !== undefined) return hit
    const events = await this.query({ kinds: [NOTE_KIND], authors: pubkeys, limit: 100 }, 6000)
    const value = dedupeById(events)
      .filter((ev) => !ev.tags.some((t) => t[0] === 'e'))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 30)
    this.feedCache.set(key, value)
    return value
  }

  async publish(ev: Event): Promise<number> {
    const results = await Promise.allSettled(this.pool.publish(this.relays, ev))
    return results.filter((r) => r.status === 'fulfilled').length
  }

  close(): void {
    this.pool.destroy()
  }
}

// NIP-01: the newest event wins; on a created_at tie the lowest id wins, so
// every bridge resolves a replaceable event to the same one.
function isNewer(a: Event, b: Event): boolean {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at
  return a.id < b.id
}

function latest(events: Event[]): Event | null {
  const now = Math.floor(Date.now() / 1000)
  let best: Event | null = null
  for (const ev of events) {
    if (isExpired(ev, now)) continue
    if (!best || isNewer(ev, best)) best = ev
  }
  return best
}

// Stable key for a set of follow pubkeys: order-independent, collision-free
// across different sets (the previous length+first-8 key aliased them).
function pubkeySetKey(pubkeys: string[]): string {
  let h = 5381
  for (const pk of [...pubkeys].sort()) {
    for (let i = 0; i < pk.length; i++) h = ((h << 5) + h + pk.charCodeAt(i)) | 0
  }
  return `${pubkeys.length}:${(h >>> 0).toString(36)}`
}

function dedupeById(events: Event[]): Event[] {
  const byId = new Map<string, Event>()
  for (const ev of events) byId.set(ev.id, ev)
  return [...byId.values()]
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])]
}
