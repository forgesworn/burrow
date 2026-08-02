import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
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
  assert.match(out, /# burrow/)
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

test('search endpoint asks for input, then serves results', async () => {
  const ask = await respondGemini(`gemini://localhost/${npub}/search`, ctx, store)
  assert.equal(ask, '10 Search this hole\r\n')
  const out = await respondGemini(`gemini://localhost/${npub}/search?gopherspace`, ctx, store)
  assert.match(out, /^20 text\/gemini/)
  assert.ok(out.includes(`=> /${npub}/notes/${note.id}`))
})

test('virtual note is served over gemini', async () => {
  const out = await respondGemini(`gemini://localhost/${npub}/notes/${note.id}`, ctx, store)
  assert.match(out, /^20 text\/plain/)
  assert.match(out, /braying about gopherspace/)
})

test('errors use gemini status codes', async () => {
  assert.match(await respondGemini('gemini://localhost/nonsense', ctx, store), /^51 /)
  assert.match(await respondGemini(`gemini://localhost/${npub}/missing.txt`, ctx, store), /^51 /)
  assert.match(await respondGemini('https://localhost/', ctx, store), /^59 /)
  assert.match(await respondGemini('not a url at all', ctx, store), /^59 /)
})

const hasOpenssl = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0

test('tls round trip with a generated certificate', { skip: !hasOpenssl }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'burrow-cert-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const certs = ensureSelfSignedCert(dir, 'localhost')
  const server = createGeminiServer({
    ...ctx,
    certFile: certs.cert,
    keyFile: certs.key,
    store: makeStore(),
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  t.after(() => server.close())
  const port = (server.address() as net.AddressInfo).port
  const out = await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      socket.write(`gemini://localhost/${npub}\r\n`)
    })
    let acc = ''
    socket.on('data', (chunk) => (acc += chunk.toString('utf8')))
    socket.on('end', () => resolve(acc))
    socket.on('error', reject)
  })
  assert.match(out, /^20 text\/gemini/)
  assert.ok(out.includes(`=> /${npub}/about.txt About this hole`))
})
