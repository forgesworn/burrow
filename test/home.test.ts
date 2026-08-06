import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { respond } from '../src/server.ts'
import { respondGemini } from '../src/gemini.ts'
import { createHttpServer } from '../src/http.ts'
import { PairingStore } from '../src/identity.ts'
import * as nip19 from 'nostr-tools/nip19'
import { makeStore, npub, testSigner } from './helpers.ts'

// A bridge may lead with one hole instead of a generic greeting, so its front
// door is content. The ways out must survive that: reading anyone else, and
// managing your own pages, both stay reachable from the same page.

const bridge = { host: 'bridge.test', port: 7070 }
// A well-formed npub whose hole is empty, which is the case that matters in
// production: relays are reachable and simply have nothing for this author.
// It has to decode, or this only re-tests the malformed path below.
const unreachable = nip19.npubEncode(`${'00'.repeat(31)}01`)

test('gopher serves the home hole in place of the welcome menu', async () => {
  const store = makeStore()
  const out = await respond(
    '',
    { relays: ['wss://stub.invalid'], bridge, pins: [], home: npub },
    store,
  )
  assert.ok(out.includes(`0About this hole\t/${npub}/about.txt\tbridge.test\t7070\r\n`))
  assert.match(out, /iAny npub is a hole on this bridge/)
  assert.ok(out.includes(`1Why gopher on Nostr\t/about\tbridge.test\t7070\r\n`))
  assert.ok(out.endsWith('.\r\n'))
})

test('a home npub with nothing published still renders as its virtual hole', async () => {
  // Not the generic welcome: every npub is a hole, so a well-formed one always
  // resolves to something. The fallback below is for input that cannot be an
  // npub at all. Asserted with a decodable npub on purpose, because an npub
  // with a bad checksum takes the malformed path and hides this entirely.
  const store = makeStore()
  const out = await respond(
    '',
    { relays: ['wss://stub.invalid'], bridge, pins: [], home: unreachable },
    store,
  )
  assert.match(out, /ia virtual hole generated from Nostr events/)
  assert.doesNotMatch(out, /iBrowse a hole by selector/)
})

test('a malformed home npub does not break the welcome menu', async () => {
  const store = makeStore()
  const out = await respond(
    '',
    { relays: ['wss://stub.invalid'], bridge, pins: [], home: 'not-an-npub' },
    store,
  )
  assert.match(out, /igopherkind\t/)
})

test('gemini serves the home hole and keeps the ways out', async () => {
  const ctx = { relays: ['wss://stub.invalid'], pins: [], virtual: true, home: npub }
  const out = await respondGemini('gemini://localhost/', ctx, makeStore())
  assert.match(out, /^20 text\/gemini/)
  assert.ok(out.includes(`=> /${npub}/about.txt About this hole`))
  assert.ok(out.includes('=> /about Why gopher on Nostr'))
  assert.match(out, /Any npub is a hole here/)
})

test('http serves the home hole with the opener and account links', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-home-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [],
    virtual: true,
    identity: true,
    home: npub,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    operatorSigner: testSigner,
    store: makeStore(),
    localTrust: false,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`

  const body = await (await fetch(base)).text()
  // The hole itself, not a greeting about holes.
  assert.ok(body.includes(`href="/${npub}/about.txt"`))
  // ...and every way out of it.
  assert.match(body, /Open a hole or a gopher site/)
  // The opener comes first: someone who did not come for this hole should not
  // have to scroll the whole front page to reach their own.
  assert.ok(body.indexOf('action="/go"') < body.indexOf(`href="/${npub}/about.txt"`))
  assert.ok(body.includes('action="/go"'))
  assert.ok(body.includes('href="/about"'))
  assert.ok(body.includes('href="/account"'))
  assert.ok(body.includes('/gopher/gopher.floodgap.com/1/'))
})

test('http without a home hole keeps the generic welcome', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-home-none-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [npub],
    virtual: true,
    identity: true,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    operatorSigner: testSigner,
    store: makeStore(),
    localTrust: false,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  const body = await (await fetch(base)).text()
  assert.match(body, /<h1>gopherkind<\/h1>/)
  assert.ok(body.includes('action="/go"'))
})

test('the opener says it takes gopher addresses, because it does', async (t) => {
  // resolveClientTarget accepts a bare gopher host, so the form accepts one
  // whether or not it admits to it. The label and the behaviour must agree.
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-opener-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [],
    virtual: true,
    identity: false,
    home: npub,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    store: makeStore(),
    localTrust: false,
    resolveTarget: async (input: string) => {
      assert.equal(input, 'baud.baby')
      return { kind: 'gopher', host: 'baud.baby', port: 70, type: '1', selector: '' }
    },
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`

  const body = await (await fetch(base)).text()
  assert.match(body, /Open a hole or a gopher site/)
  assert.match(body, /baud\.baby/)

  // and it really does resolve one
  const res = await fetch(`${base}/go?npub=baud.baby`, { redirect: 'manual' })
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/gopher/baud.baby/1')
})
