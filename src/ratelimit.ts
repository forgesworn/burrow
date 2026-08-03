interface Bucket {
  tokens: number
  at: number
}

// Collapse an address to its rate-limit key. A single client is routinely
// handed a whole IPv6 /64, so keying on the full address would let it cycle
// through fresh buckets forever (and evict everyone else's); key on the /64
// instead, and fold IPv4-mapped forms onto the embedded v4 address so they
// don't get a second free bucket.
export function limitKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip)
  if (mapped) return mapped[1] as string
  if (ip.includes(':')) {
    // Expand a compressed address so "the first four hextets" really is the
    // /64 network, then key on that and drop the interface identifier.
    const [head, tail = ''] = ip.split('::')
    const headGroups = head === '' ? [] : head.split(':')
    const tailGroups = tail === '' ? [] : tail.split(':')
    const fill = ip.includes('::') ? Array(8 - headGroups.length - tailGroups.length).fill('0') : []
    const groups = [...headGroups, ...fill, ...tailGroups]
    return groups.slice(0, 4).join(':') + '::/64'
  }
  return ip
}

// Per-key token bucket. Bounded so a scan of the address space can't eat the
// heap; least-recently-seen buckets are dropped first.
export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private capacity: number
  private refillPerSec: number
  private maxBuckets = 10_000

  constructor(capacity = 20, refillPerSec = 1) {
    this.capacity = capacity
    this.refillPerSec = refillPerSec
  }

  allow(rawIp: string): boolean {
    const ip = limitKey(rawIp)
    const now = Date.now()
    let bucket = this.buckets.get(ip)
    if (bucket) {
      this.buckets.delete(ip)
      bucket.tokens = Math.min(
        this.capacity,
        bucket.tokens + ((now - bucket.at) / 1000) * this.refillPerSec,
      )
      bucket.at = now
    } else {
      bucket = { tokens: this.capacity, at: now }
    }
    const ok = bucket.tokens >= 1
    if (ok) bucket.tokens -= 1
    this.buckets.set(ip, bucket)
    while (this.buckets.size > this.maxBuckets) {
      const oldest = this.buckets.keys().next().value
      if (oldest === undefined) break
      this.buckets.delete(oldest)
    }
    return ok
  }
}
