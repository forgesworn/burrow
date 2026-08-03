import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { createGopherServer } from '../src/server.ts'
import { article, makeStore, npub, note } from './helpers.ts'
import { articleLink } from '../src/virtual.ts'

const server = createGopherServer({
  relays: ['wss://stub.invalid'],
  bridge: { host: 'bridge.test', port: 7070 },
  pins: [npub],
  store: makeStore(),
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

  await t.test('welcome menu lists pinned holes by profile name', async () => {
    const out = await request(port, '')
    assert.match(out, /igopherkind\t/)
    assert.ok(out.includes(`1testdonkey\t/${npub}\tbridge.test\t7070\r\n`))
    assert.ok(out.endsWith('.\r\n'))
  })

  await t.test('hole root menu rewrites links', async () => {
    const out = await request(port, `/${npub}`)
    assert.ok(out.includes(`0About this hole\t/${npub}/about.txt\tbridge.test\t7070\r\n`))
    assert.ok(out.includes(`1Phlog\t/${npub}/phlog\tbridge.test\t7070\r\n`))
    assert.ok(out.includes('1Floodgap (legacy gopherspace)\t/\tgopher.floodgap.com\t70\r\n'))
    assert.ok(
      out.includes(
        'hgopherkind on the web\tURL:https://github.com/forgesworn\tbridge.test\t7070\r\n',
      ),
    )
  })

  await t.test('text document is dot-terminated', async () => {
    const out = await request(port, `/${npub}/about.txt`)
    assert.match(out, /kind 31436/)
    assert.ok(out.endsWith('\r\n.\r\n'))
  })

  await t.test('search finds authored docs and virtual notes', async () => {
    const out = await request(port, `/${npub}\tgopherspace`)
    assert.match(out, /^iResults for "gopherspace"/)
    assert.ok(out.includes(`/${npub}/phlog/2026-08-02-hello.txt\tbridge.test\t7070\r\n`))
    assert.ok(out.includes(`/${npub}/notes/${note.id}\tbridge.test\t7070\r\n`))
  })

  await t.test('virtual notes menu appears for unauthored paths', async () => {
    const out = await request(port, `/${npub}/notes`)
    assert.ok(out.includes(`\t/${npub}/notes/${note.id}\tbridge.test\t7070\r\n`))
  })

  await t.test('virtual note body is served as text', async () => {
    const out = await request(port, `/${npub}/notes/${note.id}`)
    assert.match(out, /braying about gopherspace/)
  })

  await t.test('Atom feed is readable as a gopher text item', async () => {
    const out = await request(port, `/${npub}/feed.xml`)
    assert.match(out, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/)
    assert.match(out, /nostr:nevent1/)
    assert.ok(out.endsWith('\r\n.\r\n'))
  })

  await t.test('virtual articles are served', async () => {
    const path = articleLink(article) as string
    const menu = await request(port, `/${npub}/articles`)
    assert.ok(menu.includes(`\t/${npub}${path}\tbridge.test\t7070\r\n`))
    const body = await request(port, `/${npub}${path}`)
    assert.match(body, /olivine crystals/)
  })

  await t.test('virtual profile text is served', async () => {
    const out = await request(port, `/${npub}/profile.txt`)
    assert.match(out, /Profile: testdonkey/)
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
