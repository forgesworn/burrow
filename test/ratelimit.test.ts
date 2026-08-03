import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter, limitKey } from '../src/ratelimit.ts'

test('allows a burst up to capacity then denies', () => {
  const limiter = new RateLimiter(3, 0)
  assert.equal(limiter.allow('1.2.3.4'), true)
  assert.equal(limiter.allow('1.2.3.4'), true)
  assert.equal(limiter.allow('1.2.3.4'), true)
  assert.equal(limiter.allow('1.2.3.4'), false)
})

test('addresses are limited independently', () => {
  const limiter = new RateLimiter(1, 0)
  assert.equal(limiter.allow('1.2.3.4'), true)
  assert.equal(limiter.allow('5.6.7.8'), true)
  assert.equal(limiter.allow('1.2.3.4'), false)
})

test('an ipv6 /64 shares one bucket, so it cannot cycle addresses', () => {
  const limiter = new RateLimiter(1, 0)
  assert.equal(limiter.allow('2001:db8:1:2::1'), true)
  // a different interface id in the same /64 must not get a fresh bucket
  assert.equal(limiter.allow('2001:db8:1:2::dead:beef'), false)
  // a different /64 is independent
  assert.equal(limiter.allow('2001:db8:1:3::1'), true)
})

test('limitKey folds ipv4-mapped onto the embedded v4 and keys ipv6 by /64', () => {
  assert.equal(limitKey('::ffff:127.0.0.1'), '127.0.0.1')
  assert.equal(limitKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64')
  assert.equal(limitKey('2001:db8:1:2::9'), '2001:db8:1:2::/64')
  assert.equal(limitKey('9.9.9.9'), '9.9.9.9')
})
