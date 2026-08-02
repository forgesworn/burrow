import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from '../src/ratelimit.ts'

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
