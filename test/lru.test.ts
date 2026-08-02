import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { TtlLru } from '../src/lru.ts'

test('stores and returns values, including null', () => {
  const lru = new TtlLru<string | null>(10, 1000)
  lru.set('a', 'x')
  lru.set('b', null)
  assert.equal(lru.get('a'), 'x')
  assert.equal(lru.get('b'), null)
  assert.equal(lru.get('missing'), undefined)
})

test('expires entries after the ttl', async () => {
  const lru = new TtlLru<string>(10, 20)
  lru.set('a', 'x')
  await sleep(30)
  assert.equal(lru.get('a'), undefined)
})

test('evicts least recently used first', () => {
  const lru = new TtlLru<number>(2, 60_000)
  lru.set('a', 1)
  lru.set('b', 2)
  lru.get('a')
  lru.set('c', 3)
  assert.equal(lru.get('b'), undefined)
  assert.equal(lru.get('a'), 1)
  assert.equal(lru.get('c'), 3)
})
