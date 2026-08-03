import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cmdPost, cmdUnpair } from '../src/commands.ts'
import { PairingStore } from '../src/identity.ts'
import { renderForTerminal } from '../src/cliview.ts'
import { resolveSigner, CLI_PAIRING_KEY } from '../src/signing.ts'
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
