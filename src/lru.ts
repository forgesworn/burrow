interface Entry<V> {
  at: number
  value: V
}

// TTL + LRU cache. `get` returns undefined for a miss or an expired entry,
// so cached values may themselves be null (a confirmed miss upstream).
export class TtlLru<V> {
  private map = new Map<string, Entry<V>>()
  private max: number
  private ttlMs: number

  constructor(max: number, ttlMs: number) {
    this.max = max
    this.ttlMs = ttlMs
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.at >= this.ttlMs) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, { at: Date.now(), value })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  get size(): number {
    return this.map.size
  }
}
