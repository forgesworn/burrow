import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BrowseSession,
  parseBrowseCommand,
  homeContent,
  feedContent,
  fetchLocation,
  locationOfLink,
  describeLocation,
  type BrowseDeps,
} from '../src/browse.ts'
import { BookmarkStore } from '../src/bookmarks.ts'
import { PairingStore } from '../src/identity.ts'
import { renderNumbered, pageLinks } from '../src/cliview.ts'
import { makeStore, npub, pubkey, sk, note } from './helpers.ts'
import type { Content } from '../src/router.ts'

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gopherkind-test-'))
  return path.join(dir, name)
}

function makeDeps(overrides: Partial<BrowseDeps> = {}): BrowseDeps {
  return {
    store: makeStore(),
    pairings: new PairingStore(tmpFile('pairings.json')),
    bookmarks: new BookmarkStore(tmpFile('bookmarks.json')),
    relays: ['wss://example.invalid'],
    virtual: true,
    gopher: async (t, query) => ({
      kind: 'menu',
      title: `gopher://${t.host}/${t.type}${t.selector}${query === undefined ? '' : `?${query}`}`,
      items: [],
    }),
    ...overrides,
  }
}

test('command parsing covers the whole surface', () => {
  assert.deepEqual(parseBrowseCommand('3'), { cmd: 'follow', n: 3 })
  assert.deepEqual(parseBrowseCommand('go gopher.floodgap.com'), {
    cmd: 'go',
    target: 'gopher.floodgap.com',
  })
  assert.deepEqual(parseBrowseCommand('g x'), { cmd: 'go', target: 'x' })
  assert.deepEqual(parseBrowseCommand('search hay bales'), { cmd: 'search', query: 'hay bales' })
  assert.deepEqual(parseBrowseCommand('post hello world'), { cmd: 'post', text: 'hello world' })
  assert.deepEqual(parseBrowseCommand('b'), { cmd: 'back' })
  assert.deepEqual(parseBrowseCommand('u'), { cmd: 'up' })
  assert.deepEqual(parseBrowseCommand('r'), { cmd: 'reload' })
  assert.deepEqual(parseBrowseCommand('f'), { cmd: 'feed' })
  assert.deepEqual(parseBrowseCommand('mark'), { cmd: 'mark' })
  assert.deepEqual(parseBrowseCommand('marks'), { cmd: 'marks' })
  assert.deepEqual(parseBrowseCommand('unmark 2'), { cmd: 'unmark', n: 2 })
  assert.deepEqual(parseBrowseCommand('?'), { cmd: 'help' })
  assert.deepEqual(parseBrowseCommand('q'), { cmd: 'quit' })
  assert.deepEqual(parseBrowseCommand(''), { cmd: 'empty' })
  assert.equal(parseBrowseCommand('go').cmd, 'unknown')
  assert.equal(parseBrowseCommand('gibberish').cmd, 'unknown')
})

test('session visits, follows numbered links, goes back and up', async () => {
  const session = new BrowseSession(makeDeps())
  const root = await session.visit({ kind: 'hole', pubkey, npub, path: '/' })
  // Authored root shadows the virtual one; helpers publish the example hole.
  assert.equal(root.content.kind, 'menu')
  assert.ok(root.links.length > 0)

  const first = session.link(1)
  assert.ok(first !== null)
  const loc = locationOfLink(first!.target)
  assert.ok(loc !== null)
  await session.visit(loc!)
  assert.notEqual(describeLocation(session.current!.location), describeLocation(root.location))

  const prev = session.back()
  assert.equal(prev, session.current)
  assert.equal(describeLocation(session.current!.location), describeLocation(root.location))

  await session.visit({ kind: 'hole', pubkey, npub, path: '/phlog' })
  const up = session.up()
  assert.deepEqual(up, { kind: 'hole', pubkey, npub, path: '/' })
})

test('a failed fetch leaves the current page in place', async () => {
  const deps = makeDeps({
    gopher: async () => ({ kind: 'error', message: 'nope' }) as Content,
  })
  const session = new BrowseSession(deps)
  await session.visit({ kind: 'home' })
  const before = session.current
  const errPage = await session.visit({
    kind: 'gopher',
    host: 'x',
    port: 70,
    type: '1',
    selector: '',
  })
  assert.equal(errPage.content.kind, 'error')
  assert.equal(session.current, before)
  assert.equal(session.back(), null)
})

test('home page lists bookmarks then starters, and unmark trims it', async () => {
  const deps = makeDeps()
  deps.bookmarks.add('My hole', npub)
  deps.bookmarks.add('Floodgap files', 'gopher://gopher.floodgap.com/1/goodies')
  const content = homeContent(deps.bookmarks)
  const links = pageLinks(content)
  assert.equal(links[0]?.display, 'My hole')
  assert.equal(links[1]?.display, 'Floodgap files')
  assert.ok(links.length >= 5) // two bookmarks + three starters
  assert.equal(links[0]?.target.scheme, 'hole')
  assert.equal(links[1]?.target.scheme, 'gopher')

  deps.bookmarks.remove(1)
  const after = pageLinks(homeContent(deps.bookmarks))
  assert.equal(after[0]?.display, 'Floodgap files')
})

test('bookmark store dedupes by ref and survives junk on disk', () => {
  const file = tmpFile('bookmarks.json')
  const store = new BookmarkStore(file)
  assert.equal(store.add('One', npub), true)
  assert.equal(store.add('One again', npub), false)
  assert.equal(store.list().length, 1)
  fs.writeFileSync(file, 'not json')
  assert.deepEqual(store.list(), [])
})

test('feed renders as a navigable menu through a local signer', async (t) => {
  process.env['GOPHERKIND_NSEC'] = Buffer.from(sk).toString('hex')
  t.after(() => {
    delete process.env['GOPHERKIND_NSEC']
  })
  const deps = makeDeps()
  const content = await feedContent(deps)
  assert.equal(content.kind, 'menu')
  if (content.kind === 'menu') {
    assert.match(content.title, /^feed /)
    const links = pageLinks(content)
    assert.equal(links.length, 1)
    assert.deepEqual(links[0]?.target, {
      scheme: 'hole',
      npub,
      path: `/notes/${note.id}`,
    })
    assert.match(links[0]?.display ?? '', /testdonkey/)
  }
})

test('feed without a signer is a helpful error, not a throw', async () => {
  const deps = makeDeps()
  const content = await feedContent(deps)
  assert.equal(content.kind, 'error')
  if (content.kind === 'error') assert.match(content.message, /no signer/)
})

test('gopher search goes through fetchLocation with the query', async () => {
  const deps = makeDeps()
  const content = await fetchLocation(
    { kind: 'gopher', host: 'v.example', port: 70, type: '7', selector: '/vs' },
    deps,
    'donkeys',
  )
  assert.equal(content.kind, 'menu')
  if (content.kind === 'menu') assert.match(content.title, /\?donkeys$/)
})

test('numbered rendering keeps info columns aligned and marks searches', () => {
  const content: Content = {
    kind: 'menu',
    title: 'Test',
    items: [
      { type: 'i', display: ' /\\_/\\', target: { scheme: 'none' } },
      { type: 'i', display: '( o.o )', target: { scheme: 'none' } },
      { type: '1', display: 'A dir', target: { scheme: 'hole', npub, path: '/dir' } },
      { type: '7', display: 'Find', target: { scheme: 'hole', npub, path: '/' } },
      { type: 'h', display: 'Web', target: { scheme: 'web', url: 'https://example.com' } },
    ],
  }
  const text = renderNumbered(content)
  const lines = text.split('\n')
  // Three links: width 1, so the info gutter is four spaces and every
  // display starts in the same column.
  assert.ok(lines.includes('     /\\_/\\'))
  assert.ok(lines.includes('    ( o.o )'))
  assert.match(text, /\[1\] A dir/)
  assert.match(text, /\[2\] Find \(\?\)/)
  assert.match(text, /\[3\] Web \(w\)/)
})
