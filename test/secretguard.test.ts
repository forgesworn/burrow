import test from 'node:test'
import assert from 'node:assert/strict'
import { findSecret } from '../src/secretguard.ts'

test('catches a pasted bunker URI', () => {
  const uri =
    'bunker://' + 'a'.repeat(64) + '?relay=wss://nos.lol&secret=' + 'e'.repeat(64)
  assert.match(findSecret(uri) ?? '', /bunker/)
  assert.match(findSecret(`oops ${uri} oops`) ?? '', /bunker/)
})

test('catches nsec, ncryptsec and nostrconnect', () => {
  assert.match(findSecret('my key is nsec1' + 'q'.repeat(50)) ?? '', /private key/)
  assert.match(findSecret('ncryptsec1' + 'q'.repeat(50)) ?? '', /encrypted private key/)
  assert.match(findSecret('nostrconnect://abc?relay=wss://x') ?? '', /nostrconnect/)
})

test('catches a bare secret token', () => {
  assert.match(findSecret('secret=' + 'f'.repeat(64)) ?? '', /secret token/)
})

test('lets ordinary notes through', () => {
  assert.equal(findSecret('hello gopherspace, this is my first burrow note'), null)
  assert.equal(findSecret('my npub is npub1' + 'q'.repeat(50)), null)
  assert.equal(findSecret('event id ' + 'a'.repeat(64)), null)
  assert.equal(findSecret('reading about bunkers and gopherspace history'), null)
})
