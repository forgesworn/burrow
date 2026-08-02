import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { createGopherServer } from '../src/server.ts'
import { planDirectory, docToTemplate } from '../src/publish.ts'
import { docPath } from '../src/protocol.ts'
import type { HoleStore } from '../src/fetch.ts'

const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const npub = nip19.npubEncode(pubkey)

const holeDir = path.join(import.meta.dirname, '..', 'examples', 'hole')
const events = planDirectory(holeDir).map((d) => finalizeEvent(docToTemplate(d, 1_754_000_000), sk))
const byPath = new Map(events.map((ev) => [docPath(ev), ev]))

const store = {
  doc: async (pk: string, p: string): Promise<Event | null> =>
    pk === pubkey ? (byPath.get(p) ?? null) : null,
  hole: async (pk: string): Promise<Event[]> => (pk === pubkey ? events : []),
  close: () => {},
} as unknown as HoleStore

const server = createGopherServer({
  relays: ['wss://stub.invalid'],
  bridge: { host: 'bridge.test', port: 7070 },
  pins: [npub],
  store,
})

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

function request(port: number, selector: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${selector}\r\n`)
    })
    let out = ''
    socket.on('data', (chunk) => (out += chunk.toString('utf8')))
    socket.on('end', () => resolve(out))
    socket.on('error', reject)
  })
}

test('gopher server end to end', async (t) => {
  const port = await listen()
  t.after(() => server.close())

  await t.test('welcome menu lists pinned holes', async () => {
    const out = await request(port, '')
    assert.match(out, /iburrow\t/)
    assert.ok(out.includes(`\t/${npub}\tbridge.test\t7070\r\n`))
    assert.ok(out.endsWith('.\r\n'))
  })

  await t.test('hole root menu rewrites links', async () => {
    const out = await request(port, `/${npub}`)
    assert.ok(out.includes(`0About this hole\t/${npub}/about.txt\tbridge.test\t7070\r\n`))
    assert.ok(out.includes(`1Phlog\t/${npub}/phlog\tbridge.test\t7070\r\n`))
    assert.ok(out.includes('1Floodgap (legacy gopherspace)\t/\tgopher.floodgap.com\t70\r\n'))
    assert.ok(out.includes('hburrow on the web\tURL:https://github.com/forgesworn\tbridge.test\t7070\r\n'))
  })

  await t.test('text document is dot-terminated', async () => {
    const out = await request(port, `/${npub}/about.txt`)
    assert.match(out, /kind 31436/)
    assert.ok(out.endsWith('\r\n.\r\n'))
  })

  await t.test('search finds phlog post', async () => {
    const out = await request(port, `/${npub}\tgopherspace`)
    assert.ok(out.includes(`/${npub}/phlog/2026-08-02-hello.txt\tbridge.test\t7070\r\n`))
  })

  await t.test('unknown path is a type 3 error', async () => {
    const out = await request(port, `/${npub}/missing.txt`)
    assert.match(out, /^3no document at \/missing\.txt/)
  })

  await t.test('garbage selector is a type 3 error', async () => {
    const out = await request(port, '/nonsense')
    assert.match(out, /^3not a gopherhole/)
  })
})
