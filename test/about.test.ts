import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { aboutContent, ABOUT_PATH } from '../src/about.ts'
import { respond } from '../src/server.ts'
import { respondGemini } from '../src/gemini.ts'
import { createHttpServer } from '../src/http.ts'
import { PairingStore } from '../src/identity.ts'
import { renderForTerminal } from '../src/cliview.ts'
import { isSafeWebUrl } from '../src/resolve.ts'
import { parseBrowseCommand } from '../src/browse.ts'
import { robotsTxt, geminiRobotsTxt } from '../src/robots.ts'
import { makeStore, npub, testSigner } from './helpers.ts'

// The pitch is one Content served by every frontend. These tests keep it
// reachable without identity on all of them, because a page arguing that
// the reader should not need an account is a poor place to demand one.

const serveOpts = {
  relays: ['wss://stub.invalid'],
  bridge: { host: 'bridge.test', port: 7070 },
  pins: [npub],
}

test('the about page carries the argument and safe links only', () => {
  const content = aboutContent('gopher')
  assert.equal(content.kind, 'menu')
  if (content.kind !== 'menu') return
  assert.equal(content.title, 'Why gopher on Nostr')
  const text = content.items.map((i) => i.display).join('\n')
  assert.match(text, /kind 31436/)
  assert.match(text, /You are reading this over gopher\./)
  assert.match(text, /Zap: npub1/)
  for (const item of content.items) {
    if (item.target.scheme === 'web') assert.ok(isSafeWebUrl(item.target.url))
  }
  assert.ok(content.items.some((i) => i.target.scheme === 'web'))
  assert.ok(content.items.some((i) => i.target.scheme === 'hole'))
})

test('the project bridge is offered as one option, not the option', () => {
  // The argument on this page is that a hole outlives any one host. Calling
  // the project's own bridge "the" bridge would quietly contradict it, and
  // that is an easy thing to reintroduce while editing copy, so pin it: the
  // reader is always told they can run their own instead.
  const text = renderForTerminal(aboutContent('the web'))
  assert.match(text, /gopherkind\.com, a public bridge/)
  assert.doesNotMatch(text, /the public bridge/)
  assert.match(text, /Run your own bridge/)
  assert.match(text, /No bridge is load-bearing/)
})

test('each frontend names the surface it was read on', () => {
  const said = (surface: Parameters<typeof aboutContent>[0]): string =>
    renderForTerminal(aboutContent(surface))
  assert.match(said('gemini'), /reading this over gemini/)
  assert.match(said('the web'), /reading this over the web/)
  assert.match(said('your terminal'), /reading this in your terminal/)
})

test('gopher serves the pitch and links to it from the welcome menu', async () => {
  const store = makeStore()
  const welcome = await respond('', serveOpts, store)
  assert.ok(welcome.includes(`1Why gopher on Nostr\t${ABOUT_PATH}\tbridge.test\t7070\r\n`))

  const out = await respond(ABOUT_PATH, serveOpts, store)
  assert.match(out, /^iWhy gopher on Nostr\t/)
  assert.match(out, /iGopherspace has one endemic disease/)
  assert.ok(
    out.includes('hSource, docs and issues\tURL:https://github.com/forgesworn/gopherkind\t'),
  )
  assert.ok(out.endsWith('.\r\n'))
})

test('gemini serves the pitch without a client certificate', async () => {
  const ctx = { relays: ['wss://stub.invalid'], pins: [npub], virtual: true }
  const store = makeStore()
  const welcome = await respondGemini('gemini://localhost/', ctx, store)
  assert.ok(welcome.includes('=> /about Why gopher on Nostr'))

  const out = await respondGemini('gemini://localhost/about', ctx, store, null)
  assert.match(out, /^20 text\/gemini/)
  assert.match(out, /# Why gopher on Nostr/)
  assert.ok(out.includes('=> https://ko-fi.com/brays Support the work (Ko-fi)'))
})

test('http serves the pitch to a signed-out visitor', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-about-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [npub],
    virtual: true,
    identity: true,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    operatorSigner: testSigner,
    store: makeStore(),
    publicUrl: 'https://bridge.example',
    localTrust: false,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`

  const home = await (await fetch(base)).text()
  assert.ok(home.includes('<a href="/about">Why gopher on Nostr</a>'))

  const res = await fetch(`${base}/about`)
  assert.equal(res.status, 200)
  const body = await res.text()
  assert.match(body, /Why gopher on Nostr/)
  assert.match(body, /endemic disease/)
  assert.ok(body.includes('<link rel="canonical" href="https://bridge.example/about">'))
  assert.ok(body.includes('href="https://geyser.fund/project/forgesworn"'))
  assert.doesNotMatch(body, /javascript:/)
})

test('the terminal client has the same page behind why and about', () => {
  assert.deepEqual(parseBrowseCommand('why'), { cmd: 'why' })
  assert.deepEqual(parseBrowseCommand('about'), { cmd: 'why' })
})

// The pitch is a static document, so a crawler reading it costs no relay
// traffic: it stays out of the disallow list on purpose.
test('the crawl policy leaves the pitch indexable', () => {
  assert.doesNotMatch(robotsTxt(), /Disallow: \/about/)
  assert.doesNotMatch(geminiRobotsTxt(), /Disallow: \/about/)
})
