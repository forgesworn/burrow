import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import tls from 'node:tls'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { respondGemini, createGeminiServer } from '../src/gemini.ts'
import { ensureSelfSignedCert } from '../src/certs.ts'
import { makeStore, npub, note } from './helpers.ts'

const ctx = { relays: ['wss://stub.invalid'], pins: [npub], virtual: true }
const store = makeStore()

test('welcome page is gemtext with pinned holes', async () => {
  const out = await respondGemini('gemini://localhost/', ctx, store)
  assert.match(out, /^20 text\/gemini/)
  assert.match(out, /# gopherkind/)
  assert.ok(out.includes(`=> /${npub} testdonkey`))
})

test('hole root menu renders as gemtext links', async () => {
  const out = await respondGemini(`gemini://localhost/${npub}`, ctx, store)
  assert.match(out, /^20 text\/gemini/)
  assert.ok(out.includes(`=> /${npub}/about.txt About this hole`))
  assert.ok(out.includes('=> gopher://gopher.floodgap.com/1/ Floodgap (legacy gopherspace)'))
})

test('text documents are text/plain', async () => {
  const out = await respondGemini(`gemini://localhost/${npub}/about.txt`, ctx, store)
  assert.match(out, /^20 text\/plain/)
  assert.match(out, /kind 31436/)
})

test('URL decoding keeps spaces distinct from literal percent escapes', async () => {
  const space = await respondGemini(`gemini://localhost/${npub}/a%20b`, ctx, store)
  const percent = await respondGemini(`gemini://localhost/${npub}/a%2520b`, ctx, store)
  assert.match(space, /space path/)
  assert.doesNotMatch(space, /literal percent path/)
  assert.match(percent, /literal percent path/)
})

test('URL paths are validated before a URL parser can collapse dot segments', async () => {
  for (const path of [`/${npub}/a/../about.txt`, `/${npub}/a/%2e%2e/about.txt`]) {
    const out = await respondGemini(`gemini://localhost${path}`, ctx, store)
    assert.match(out, /^51 /)
    assert.doesNotMatch(out, /kind 31436/)
  }
})

test('bridge search asks for input, then serves results without shadowing /search', async () => {
  const ask = await respondGemini(`gemini://localhost/_gopherkind/search/${npub}`, ctx, store)
  assert.equal(ask, '10 Search this hole\r\n')
  const out = await respondGemini(
    `gemini://localhost/_gopherkind/search/${npub}?gopherspace`,
    ctx,
    store,
  )
  assert.match(out, /^20 text\/gemini/)
  assert.ok(out.includes(`=> /${npub}/notes/${note.id}`))
  const authored = await respondGemini(`gemini://localhost/${npub}/search`, ctx, store)
  assert.match(authored, /^20 text\/plain/)
  assert.match(authored, /not an endpoint/)
})

test('virtual note is served over gemini', async () => {
  const out = await respondGemini(`gemini://localhost/${npub}/notes/${note.id}`, ctx, store)
  assert.match(out, /^20 text\/plain/)
  assert.match(out, /braying about gopherspace/)
})

test('Atom feed keeps its media type over Gemini', async () => {
  const out = await respondGemini(`gemini://localhost/${npub}/feed.xml`, ctx, store)
  assert.match(out, /^20 application\/atom\+xml; charset=utf-8\r\n<\?xml/)
  assert.match(out, /nostr:nevent1/)
})

test('errors use gemini status codes', async () => {
  assert.match(await respondGemini('gemini://localhost/nonsense', ctx, store), /^51 /)
  assert.match(await respondGemini(`gemini://localhost/${npub}/missing.txt`, ctx, store), /^51 /)
  assert.match(await respondGemini('https://localhost/', ctx, store), /^59 /)
  assert.match(await respondGemini('not a url at all', ctx, store), /^59 /)
})

const hasOpenssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0

test('generated certificates use an IP SAN when the advertised host is an IP', {
  skip: !hasOpenssl,
}, (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-ip-cert-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const certs = ensureSelfSignedCert(dir, '192.0.2.10')
  const details = spawnSync('openssl', ['x509', '-in', certs.cert, '-noout', '-text'], {
    encoding: 'utf8',
  })
  assert.equal(details.status, 0)
  assert.match(details.stdout, /IP Address:192\.0\.2\.10/)
})

test('tls round trip with a generated certificate', { skip: !hasOpenssl }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-cert-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const certs = ensureSelfSignedCert(dir, 'localhost')
  const clientDir = mkdtempSync(path.join(tmpdir(), 'gopherkind-clientcert-'))
  t.after(() => rmSync(clientDir, { recursive: true, force: true }))
  const clientCerts = ensureSelfSignedCert(clientDir, 'lagrange-user')
  const { readFileSync } = await import('node:fs')
  const { PairingStore } = await import('../src/identity.ts')

  const server = createGeminiServer({
    ...ctx,
    identity: {
      pairings: new PairingStore(path.join(dir, 'pairings.json')),
      signer: {
        pair: async () => {
          throw new Error('unused')
        },
        startConnect: () => ({ uri: 'x', finish: new Promise(() => {}) }),
        sign: async () => {
          throw new Error('unused')
        },
      },
      appName: 'test',
    },
    certFile: certs.cert,
    keyFile: certs.key,
    store: makeStore(),
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  t.after(() => server.close())
  const port = (server.address() as net.AddressInfo).port

  const fetchOne = (url: string, withClientCert: boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          port,
          host: '127.0.0.1',
          rejectUnauthorized: false,
          ...(withClientCert
            ? { cert: readFileSync(clientCerts.cert), key: readFileSync(clientCerts.key) }
            : {}),
        },
        () => socket.write(`${url}\r\n`),
      )
      let acc = ''
      socket.on('data', (chunk) => (acc += chunk.toString('utf8')))
      socket.on('end', () => resolve(acc))
      socket.on('error', reject)
    })

  const menu = await fetchOne(`gemini://localhost/${npub}`, false)
  assert.match(menu, /^20 text\/gemini/)
  assert.ok(menu.includes(`=> /${npub}/about.txt About this hole`))

  assert.match(await fetchOne('gemini://localhost/account', false), /^60 /)
  const account = await fetchOne('gemini://localhost/account', true)
  assert.match(account, /^20 text\/gemini/)
  assert.match(account, /not paired/)
})
