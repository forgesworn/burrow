import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { robotsTxt, geminiRobotsTxt } from '../src/robots.ts'
import { createHttpServer } from '../src/http.ts'
import { respondGemini } from '../src/gemini.ts'
import { PairingStore } from '../src/identity.ts'
import { makeStore, npub } from './helpers.ts'

test('the crawl policy names the proxy and the account paths', () => {
  const body = robotsTxt()
  assert.match(body, /^User-agent: \*$/m)
  for (const p of ['/gopher/', '/account', '/pair', '/post', '/feed', '/delete']) {
    assert.match(body, new RegExp(`^Disallow: ${p.replace('/', '\\/')}`, 'm'))
  }
  // a hole itself stays crawlable; that is the point of a bridge
  assert.doesNotMatch(body, /^Disallow: \/$/m)
})

test('the gemini policy repeats itself for each virtual agent', () => {
  const body = geminiRobotsTxt()
  for (const agent of ['*', 'indexer', 'archiver', 'researcher', 'webproxy']) {
    assert.ok(body.includes(`User-agent: ${agent}\n`), `${agent} should have its own stanza`)
  }
  assert.equal((body.match(/Disallow: \/gopher\//g) ?? []).length, 5)
})

test('the http frontend serves it as text/plain', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-robots-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [npub],
    virtual: true,
    identity: false,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    store: makeStore([]),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
  const res = await fetch(`${base}/robots.txt`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/)
  assert.match(await res.text(), /Disallow: \/gopher\//)
})

test('the gemini frontend serves it with a 20 status', async () => {
  const out = await respondGemini(
    'gemini://bridge.example/robots.txt',
    { relays: [], pins: [], virtual: true },
    makeStore([]),
  )
  assert.match(out, /^20 text\/plain\r\n/)
  assert.match(out, /User-agent: indexer/)
})
