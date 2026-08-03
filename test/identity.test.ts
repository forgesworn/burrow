import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PairingStore, type Pairing } from '../src/identity.ts'

function samplePairing(fp: string): Pairing {
  return {
    fingerprint: fp,
    userPubkey: 'a'.repeat(64),
    clientSecretKey: 'b'.repeat(64),
    bunker: { relays: ['wss://relay.example'], pubkey: 'c'.repeat(64), secret: null },
    pairedAt: 1_754_000_000,
  }
}

test('pairing store round-trips through disk', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-id-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'pairings.json')

  const store = new PairingStore(file)
  assert.equal(store.get('AA:BB'), null)
  store.set(samplePairing('AA:BB'))
  assert.equal(store.get('AA:BB')?.userPubkey, 'a'.repeat(64))

  const reloaded = new PairingStore(file)
  assert.equal(reloaded.get('AA:BB')?.bunker.pubkey, 'c'.repeat(64))

  assert.equal(reloaded.delete('AA:BB'), true)
  assert.equal(reloaded.delete('AA:BB'), false)
  assert.equal(new PairingStore(file).get('AA:BB'), null)
})

test('pairings file is written mode 600', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-id-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'pairings.json')
  new PairingStore(file).set(samplePairing('CC:DD'))
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.match(readFileSync(file, 'utf8'), /CC:DD/)
})

test('corrupt pairings file starts empty instead of crashing', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-id-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'pairings.json')
  writeFileSync(file, 'not json{{{')
  const store = new PairingStore(file)
  assert.equal(store.get('anything'), null)
})
