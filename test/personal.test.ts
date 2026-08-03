import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent } from 'nostr-tools/pure'
import type { EventTemplate } from 'nostr-tools'
import { matchPersonal, resolvePersonal } from '../src/personal.ts'
import { respond, type ServeOptions } from '../src/server.ts'
import type { CliSigner } from '../src/signing.ts'
import { makeStore, sk, pubkey, npub, note } from './helpers.ts'

const signer: CliSigner = {
  describe: 'test key',
  pubkey: async () => pubkey,
  sign: async (tpl: EventTemplate) => finalizeEvent(tpl, sk),
}

test('personal selectors parse', () => {
  assert.deepEqual(matchPersonal('/me', ''), { kind: 'root' })
  assert.deepEqual(matchPersonal('/me/feed', ''), { kind: 'feed' })
  assert.deepEqual(matchPersonal('/me/follows', ''), { kind: 'follows' })
  assert.deepEqual(matchPersonal('/me/followers', ''), { kind: 'followers' })
  assert.deepEqual(matchPersonal('/me/post', 'hi there'), { kind: 'post', text: 'hi there' })
  assert.deepEqual(matchPersonal(`/me/delete/${'a'.repeat(64)}`, 'delete'), {
    kind: 'delete',
    id: 'a'.repeat(64),
    confirm: 'delete',
  })
  assert.equal(matchPersonal('/me/nonsense', ''), null)
  assert.equal(matchPersonal('/me/delete/short', ''), null)
  assert.equal(matchPersonal(`/${npub}`, ''), null)
})

test('personal root menu offers read and write actions', async () => {
  const store = makeStore()
  const content = await resolvePersonal({ kind: 'root' }, store, signer, 3)
  assert.equal(content.kind, 'menu')
  if (content.kind !== 'menu') return
  const displays = content.items.map((i) => i.display)
  assert.ok(displays.some((d) => d.includes('Post a note')))
  assert.ok(displays.includes('Your feed'))
  assert.ok(displays.includes('Who you follow'))
  assert.ok(displays.includes('Your followers'))
  assert.ok(content.items.some((i) => i.type === '7'))
})

test('posting through the personal menu signs and publishes', async () => {
  const published: unknown[] = []
  const store = makeStore(published)
  const content = await resolvePersonal({ kind: 'post', text: 'from gopher' }, store, signer, 3)
  assert.equal(content.kind, 'menu')
  if (content.kind === 'menu') assert.equal(content.title, 'Posted')
  const ev = published[0] as { kind: number; content: string }
  assert.equal(ev.kind, 1)
  assert.equal(ev.content, 'from gopher')
})

test('personal post refuses credential-shaped text', async () => {
  const published: unknown[] = []
  const store = makeStore(published)
  const content = await resolvePersonal(
    { kind: 'post', text: `bunker://x?secret=${'f'.repeat(64)}` },
    store,
    signer,
    3,
  )
  if (content.kind === 'menu') assert.equal(content.title, 'Not posting that')
  assert.equal(published.length, 0)
})

test('delete needs the confirmation word', async () => {
  const published: unknown[] = []
  const store = makeStore(published)
  const nope = await resolvePersonal({ kind: 'delete', id: note.id, confirm: '' }, store, signer, 3)
  if (nope.kind === 'menu') assert.equal(nope.title, 'Not deleted')
  assert.equal(published.length, 0)

  const yes = await resolvePersonal(
    { kind: 'delete', id: note.id, confirm: 'delete' },
    store,
    signer,
    3,
  )
  if (yes.kind === 'menu') assert.equal(yes.title, 'Deletion requested')
  const ev = published[0] as { kind: number; tags: string[][] }
  assert.equal(ev.kind, 5)
  assert.ok(ev.tags.some((t) => t[0] === 'e' && t[1] === note.id))
})

test('follows and followers list people as holes', async () => {
  const store = makeStore()
  for (const kind of ['follows', 'followers'] as const) {
    const content = await resolvePersonal({ kind }, store, signer, 3)
    assert.equal(content.kind, 'menu')
    if (content.kind !== 'menu') continue
    assert.ok(
      content.items.some(
        (i) => i.target.scheme === 'hole' && i.target.npub === npub && i.target.path === '/',
      ),
    )
  }
})

test('gopher refuses the personal menu to non-loopback clients', async () => {
  const store = makeStore()
  const opts: ServeOptions = {
    relays: ['wss://stub.invalid'],
    bridge: { host: 'b.test', port: 70 },
    pins: [],
    signerFactory: async () => signer,
    store,
  }
  const remote = await respond('/me', opts, store, false)
  assert.match(remote, /^3the personal menu is local-only/)

  const local = await respond('/me', opts, store, true)
  assert.match(local, /iburrow: you/)
})

test('gopher welcome advertises the personal menu only locally', async () => {
  const store = makeStore()
  const opts: ServeOptions = {
    relays: ['wss://stub.invalid'],
    bridge: { host: 'b.test', port: 70 },
    pins: [],
    signerFactory: async () => signer,
    store,
  }
  assert.match(await respond('', opts, store, true), /You: feed, follows, post, delete/)
  assert.doesNotMatch(await respond('', opts, store, false), /You: feed/)
})

test('without a signer the personal menu is unavailable even locally', async () => {
  const store = makeStore()
  const opts: ServeOptions = {
    relays: [],
    bridge: { host: 'b.test', port: 70 },
    pins: [],
    store,
  }
  assert.match(await respond('/me', opts, store, true), /^3no signer configured/)
})
