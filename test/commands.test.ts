import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cmdPost, cmdUnpair } from '../src/commands.ts'
import { PairingStore } from '../src/identity.ts'
import { renderForTerminal } from '../src/cliview.ts'
import { resolveSigner, requireSignerIdentity, CLI_PAIRING_KEY } from '../src/signing.ts'
import * as nip19 from 'nostr-tools/nip19'
import { npub, testSigner } from './helpers.ts'

function tmpPairings(t: { after: (fn: () => void) => void }): PairingStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-cmd-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return new PairingStore(path.join(dir, 'pairings.json'))
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('signer resolution ignores local key environment variables and errors helpfully', async (t) => {
  const pairings = tmpPairings(t)
  await assert.rejects(
    () =>
      withEnv({ GOPHERKIND_NSEC: 'nsec1mustneverload', GOPHERKIND_BUNKER: undefined }, () =>
        resolveSigner(pairings),
      ),
    /gopherkind pair/,
  )
})

test('post refuses credential-shaped notes before signing', async (t) => {
  const pairings = tmpPairings(t)
  await assert.rejects(
    () =>
      cmdPost(
        `bunker://abc?secret=${'f'.repeat(64)}`,
        ['wss://stub.invalid'],
        pairings,
        true,
        testSigner,
      ),
    /refusing to sign/,
  )
})

test('post dry run signs without publishing', async (t) => {
  const pairings = tmpPairings(t)
  const out = await cmdPost('hello gopherspace', ['wss://stub.invalid'], pairings, true, testSigner)
  assert.match(out, /not published \(dry run\)/)
  const ev = JSON.parse(out.slice(0, out.lastIndexOf('}') + 1)) as { content: string; kind: number }
  assert.equal(ev.kind, 1)
  assert.equal(ev.content, 'hello gopherspace')
})

test('post rejects empty text', async (t) => {
  const pairings = tmpPairings(t)
  await assert.rejects(() => cmdPost('   ', [], pairings, true), /nothing to post/)
})

test('unpair reports whether anything was stored', (t) => {
  const pairings = tmpPairings(t)
  assert.match(cmdUnpair(pairings), /no stored pairing/)
  pairings.set({
    fingerprint: CLI_PAIRING_KEY,
    userPubkey: 'a'.repeat(64),
    clientSecretKey: 'b'.repeat(64),
    bunker: { relays: [], pubkey: 'c'.repeat(64), secret: null },
    pairedAt: 1,
  })
  assert.match(cmdUnpair(pairings), /unpaired/)
})

test('terminal rendering shows menus, text and errors', () => {
  const menu = renderForTerminal({
    kind: 'menu',
    title: 'Notes',
    items: [
      { type: 'i', display: 'intro', target: { scheme: 'none' } },
      { type: '0', display: 'A post', target: { scheme: 'hole', npub, path: '/notes/x' } },
    ],
  })
  assert.match(menu, /^Notes\n=====\n/)
  assert.match(menu, / {2}A post\n {6}\/[a-z0-9]+\/notes\/x/)
  assert.equal(renderForTerminal({ kind: 'text', title: 't', body: 'body\n\n' }), 'body\n')
  assert.equal(renderForTerminal({ kind: 'error', message: 'nope' }), 'error: nope\n')
})

// One hardware signer can hold several identities, and picking the wrong slot
// is silent: a kind 31436 document is addressable, so publishing under the
// wrong key replaces whatever that author had at the path. `--as` is the
// difference between an accident and a refusal.
test('requireSignerIdentity passes through when the signer matches', async () => {
  const same = await requireSignerIdentity(testSigner, npub)
  assert.equal(same, testSigner)
})

test('requireSignerIdentity refuses a signer that is not the expected npub', async () => {
  // must be a decodable npub, or this tests the malformed branch instead
  const stranger = nip19.npubEncode(`${'00'.repeat(31)}01`)
  await assert.rejects(
    () => requireSignerIdentity(testSigner, stranger),
    (err: Error) => {
      // The message has to name both keys: "wrong signer" alone leaves the
      // reader guessing which slot they actually reached for.
      assert.match(err.message, new RegExp(`the signer is ${npub}`))
      assert.match(err.message, /Nothing was signed/)
      return true
    },
  )
})

test('requireSignerIdentity rejects a value that is not an npub', async () => {
  await assert.rejects(() => requireSignerIdentity(testSigner, 'gopherkind'), /--as needs an npub/)
  // an nsec-shaped or hex value must not be quietly accepted either
  await assert.rejects(
    () =>
      requireSignerIdentity(
        testSigner,
        '392ad2a348960f3d32c0681ee0def41097a14fa55ff2465dc273f510b0740d53',
      ),
    /--as needs an npub/,
  )
})

test('requireSignerIdentity is a no-op when no identity is demanded', async () => {
  assert.equal(await requireSignerIdentity(testSigner, undefined), testSigner)
})
