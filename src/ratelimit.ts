interface Bucket {
  tokens: number
  at: number
}

// Per-IP token bucket. Bounded so a scan of the IPv6 space can't eat the
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

  allow(ip: string): boolean {
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
