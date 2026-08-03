import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nip19 from 'nostr-tools/nip19'
import { nsecEncode } from 'nostr-tools/nip19'
import { cmdPost, cmdUnpair } from '../src/commands.ts'
import { PairingStore } from '../src/identity.ts'
import { renderForTerminal } from '../src/cliview.ts'
import { localSigner, resolveSigner, CLI_PAIRING_KEY } from '../src/signing.ts'
import { sk, npub } from './helpers.ts'

function tmpPairings(t: { after: (fn: () => void) => void }): PairingStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'burrow-cmd-'))
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

test('local signer signs with BURROW_NSEC', async () => {
  const signer = localSigner(nsecEncode(sk))
  assert.equal(nip19.npubEncode(await signer.pubkey()), npub)
  const ev = await signer.sign({ kind: 1, created_at: 1, tags: [], content: 'hi' })
  assert.equal(ev.content, 'hi')
  assert.match(ev.sig, /^[0-9a-f]{128}$/)
})

test('signer resolution prefers nsec, then errors helpfully', async (t) => {
  const pairings = tmpPairings(t)
  const resolved = await withEnv({ BURROW_NSEC: nsecEncode(sk), BURROW_BUNKER: undefined }, () =>
    resolveSigner(pairings),
  )
  assert.match(resolved.describe, /local key/)

  await assert.rejects(
    () =>
      withEnv({ BURROW_NSEC: undefined, BURROW_BUNKER: undefined }, () => resolveSigner(pairings)),
    /burrow pair/,
  )
})

test('post refuses credential-shaped notes before signing', async (t) => {
  const pairings = tmpPairings(t)
  await assert.rejects(
    () =>
      withEnv({ BURROW_NSEC: nsecEncode(sk) }, () =>
        cmdPost('bunker://abc?secret=' + 'f'.repeat(64), ['wss://stub.invalid'], pairings, true),
      ),
    /refusing to sign/,
  )
})

test('post dry run signs without publishing', async (t) => {
  const pairings = tmpPairings(t)
  const out = await withEnv({ BURROW_NSEC: nsecEncode(sk) }, () =>
    cmdPost('hello gopherspace', ['wss://stub.invalid'], pairings, true),
  )
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
  assert.match(menu, /  A post\n {6}\/[a-z0-9]+\/notes\/x/)
  assert.equal(renderForTerminal({ kind: 'text', title: 't', body: 'body\n\n' }), 'body\n')
  assert.equal(renderForTerminal({ kind: 'error', message: 'nope' }), 'error: nope\n')
})
