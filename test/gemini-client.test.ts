import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { finalizeEvent } from 'nostr-tools/pure'
import type { EventTemplate } from 'nostr-tools'
import { respondGemini, type GeminiContext } from '../src/gemini.ts'
import { PairingStore, type Pairing } from '../src/identity.ts'
import type { RemoteSigner, PairResult } from '../src/nip46client.ts'
import { makeStore, sk, pubkey, npub, note } from './helpers.ts'

// The fake signer stands in for a bunker: pairing succeeds for one magic
// URI, and signing uses the test key directly (which a real bunker would
// never surrender).
function fakeSigner(): RemoteSigner {
  const result: PairResult = {
    userPubkey: pubkey,
    clientSecretKey: 'b'.repeat(64),
    bunker: { relays: ['wss://relay.example'], pubkey: 'c'.repeat(64), secret: null },
  }
  return {
    pair: async (input: string) => {
      if (input === 'bunker://good') return result
      throw new Error('bunker refused us')
    },
    startConnect: () => ({
      uri: 'nostrconnect://fake?relay=wss%3A%2F%2Frelay.example',
      finish: new Promise<PairResult>(() => {}),
    }),
    sign: async (_p: Pairing, tpl: EventTemplate) => finalizeEvent(tpl, sk),
  }
}

function makeCtx(dir: string): GeminiContext {
  return {
    relays: ['wss://stub.invalid'],
    pins: [],
    virtual: true,
    identity: {
      pairings: new PairingStore(path.join(dir, 'pairings.json')),
      signer: fakeSigner(),
      appName: 'gopherkind test',
    },
  }
}

const cert = { fingerprint: 'AA:BB:CC' }

test('gemini signed-in client', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-client-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ctx = makeCtx(dir)
  const published: unknown[] = []
  const store = makeStore(published)
  const ask = (line: string, withCert = true): Promise<string> =>
    respondGemini(line, ctx, store, withCert ? cert : null)

  await t.test('account routes demand a client certificate', async () => {
    assert.match(await ask('gemini://localhost/account', false), /^60 /)
    assert.match(await ask('gemini://localhost/post', false), /^60 /)
  })

  await t.test('identity off means routes are just absent', async () => {
    const bare: GeminiContext = { relays: [], pins: [], virtual: true }
    assert.match(await respondGemini('gemini://localhost/account', bare, store, cert), /^51 /)
  })

  await t.test('unpaired account offers pairing', async () => {
    const out = await ask('gemini://localhost/account')
    assert.match(out, /not paired/)
    assert.match(out, /=> \/pair /)
  })

  await t.test('post before pairing redirects to account', async () => {
    assert.equal(await ask('gemini://localhost/post'), '30 /account\r\n')
  })

  await t.test('pairing prompts, then binds cert to bunker', async () => {
    assert.match(await ask('gemini://localhost/pair'), /^10 /)
    assert.equal(await ask('gemini://localhost/pair?bunker%3A%2F%2Fgood'), '30 /account\r\n')
    assert.equal(ctx.identity?.pairings.get(cert.fingerprint)?.userPubkey, pubkey)
  })

  await t.test('paired account shows identity and actions', async () => {
    const out = await ask('gemini://localhost/account')
    assert.match(out, /Signed in as testdonkey/)
    assert.match(out, new RegExp(`=> /${npub} Your hole`))
  })

  await t.test('posting signs via the bunker and publishes', async () => {
    assert.match(await ask('gemini://localhost/post'), /^10 /)
    const out = await ask('gemini://localhost/post?hello%20gopherspace')
    assert.match(out, /Accepted by 3\/1 relays|Accepted by 3\/\d+ relays/)
    assert.equal(published.length, 1)
    const ev = published[0] as { kind: number; content: string; pubkey: string }
    assert.equal(ev.kind, 1)
    assert.equal(ev.content, 'hello gopherspace')
    assert.equal(ev.pubkey, pubkey)
    assert.match(out, new RegExp(`=> /${npub}/notes/`))
  })

  await t.test('pairing failure is a readable page, not a crash', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'gopherkind-client-'))
    t.after(() => rmSync(dir2, { recursive: true, force: true }))
    const ctx2 = makeCtx(dir2)
    const out = await respondGemini('gemini://localhost/pair?bunker%3A%2F%2Fbad', ctx2, store, cert)
    assert.match(out, /Pairing failed/)
    assert.match(out, /bunker refused us/)
  })

  await t.test('cross-device connect shows a nostrconnect URI', async () => {
    const dir3 = mkdtempSync(path.join(tmpdir(), 'gopherkind-client-'))
    t.after(() => rmSync(dir3, { recursive: true, force: true }))
    const ctx3 = makeCtx(dir3)
    const out = await respondGemini('gemini://localhost/pair/connect', ctx3, store, cert)
    assert.match(out, /nostrconnect:\/\/fake/)
    const status = await respondGemini('gemini://localhost/pair/status', ctx3, store, cert)
    assert.match(status, /No approval yet/)
  })

  await t.test('feed renders follows with profile names', async () => {
    const out = await ask('gemini://localhost/feed')
    assert.match(out, /# Your feed/)
    assert.match(out, /testdonkey: braying about gopherspace/)
    assert.match(out, new RegExp(`=> /${npub}/notes/${note.id}`))
  })

  await t.test('unpair removes the binding', async () => {
    const out = await ask('gemini://localhost/unpair')
    assert.match(out, /Unpaired/)
    assert.equal(ctx.identity?.pairings.get(cert.fingerprint), null)
    assert.equal(await ask('gemini://localhost/post'), '30 /account\r\n')
  })

  await t.test('welcome advertises sign-in when identity is on', async () => {
    const out = await ask('gemini://localhost/')
    assert.match(out, /=> \/account Sign in/)
  })
})
