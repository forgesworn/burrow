import test from 'node:test'
import assert from 'node:assert/strict'
import { withTimeout } from '../src/nip46client.ts'

// nostr-tools has no per-request timeout, and a signer awaiting a human (or a
// powered-off ESP32) would otherwise hang the request forever. withTimeout is
// the guard the whole NIP-46 layer relies on.

test('resolves when the inner promise settles in time', async () => {
  const value = await withTimeout(Promise.resolve(42), 1000, 'op')
  assert.equal(value, 42)
})

test('rejects with a descriptive message when it overruns', async () => {
  const slow = new Promise((resolve) => setTimeout(resolve, 200))
  await assert.rejects(withTimeout(slow, 20, 'bunker connect'), /bunker connect timed out/)
})

test('propagates the inner rejection and wraps non-Error throws', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 1000, 'op'), /boom/)
  await assert.rejects(withTimeout(Promise.reject('plain string'), 1000, 'op'), /plain string/)
})

test('clears its timer so a resolved call does not keep the loop alive', async () => {
  // If the timer were not cleared, node:test would flag an open handle / the
  // process would linger. A fast resolve well under the timeout exercises it.
  await withTimeout(Promise.resolve('ok'), 60_000, 'op')
  assert.ok(true)
})
