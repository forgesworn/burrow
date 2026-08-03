import test from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import {
  parseClientTarget,
  resolveClientTarget,
  refOf,
  describeTarget,
  upOf,
  holeFromSelector,
  TargetError,
} from '../src/target.ts'
import { pubkey, npub } from './helpers.ts'

test('npub forms parse to hole targets', () => {
  assert.deepEqual(parseClientTarget(npub), { kind: 'hole', pubkey, npub, path: '/' })
  assert.deepEqual(parseClientTarget(`${npub}/notes`), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/notes',
  })
  assert.deepEqual(parseClientTarget(`nostr:${npub}/notes/`), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/notes',
  })
  assert.deepEqual(parseClientTarget(`/${npub}`), { kind: 'hole', pubkey, npub, path: '/' })
  assert.throws(() => parseClientTarget(`${npub}/a/../b`), TargetError)
})

test('nprofile and naddr parse to hole targets', () => {
  const nprofile = nip19.nprofileEncode({ pubkey, relays: [] })
  assert.deepEqual(parseClientTarget(nprofile), { kind: 'hole', pubkey, npub, path: '/' })

  const doc = nip19.naddrEncode({ kind: 31436, pubkey, identifier: '/sub/page' })
  assert.deepEqual(parseClientTarget(doc), { kind: 'hole', pubkey, npub, path: '/sub/page' })

  const article = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'my-post' })
  assert.deepEqual(parseClientTarget(article), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/articles/my-post',
  })

  const other = nip19.naddrEncode({ kind: 30000, pubkey, identifier: 'x' })
  assert.throws(() => parseClientTarget(other), TargetError)
})

test('gopher urls and bare hostnames parse to gopher targets', () => {
  assert.deepEqual(parseClientTarget('gopher://gopher.floodgap.com'), {
    kind: 'gopher',
    host: 'gopher.floodgap.com',
    port: 70,
    type: '1',
    selector: '',
  })
  assert.deepEqual(parseClientTarget('gopher://gopher.floodgap.com/0/gopher/relevance.txt'), {
    kind: 'gopher',
    host: 'gopher.floodgap.com',
    port: 70,
    type: '0',
    selector: '/gopher/relevance.txt',
  })
  assert.deepEqual(parseClientTarget('example.org:7070/7/search'), {
    kind: 'gopher',
    host: 'example.org',
    port: 7070,
    type: '7',
    selector: '/search',
  })
  assert.deepEqual(parseClientTarget('gopher.floodgap.com'), {
    kind: 'gopher',
    host: 'gopher.floodgap.com',
    port: 70,
    type: '1',
    selector: '',
  })
  assert.throws(() => parseClientTarget('not a target'), TargetError)
  assert.throws(() => parseClientTarget(''), TargetError)
  assert.throws(() => parseClientTarget('word'), TargetError)
})

test('a bridge url with an npub selector goes native', () => {
  const bridged = parseClientTarget(`gopher://bridge.example:7070/1/${npub}/notes`)
  assert.deepEqual(bridged, { kind: 'hole', pubkey, npub, path: '/notes' })

  const proxied = parseClientTarget(`/gopher/bridge.example/1/${npub}`)
  assert.deepEqual(proxied, { kind: 'hole', pubkey, npub, path: '/' })

  assert.deepEqual(parseClientTarget('/gopher/example.org/0/file.txt'), {
    kind: 'gopher',
    host: 'example.org',
    port: 70,
    type: '0',
    selector: '/file.txt',
  })
})

test('holeFromSelector only matches leading npubs', () => {
  const hit = holeFromSelector(`/${npub}/sub`)
  assert.equal(hit?.kind, 'hole')
  if (hit?.kind === 'hole') assert.equal(hit.path, '/sub')
  assert.equal(holeFromSelector('/plain/path'), null)
  assert.equal(holeFromSelector('npub1notreal/sub'), null)
})

test('nip-05 names resolve to hole targets', async () => {
  const resolver = async (fullname: string): Promise<string | null> =>
    fullname === 'donkey@example.org' ? pubkey : null

  assert.deepEqual(await resolveClientTarget('donkey@example.org', resolver), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/',
  })
  assert.deepEqual(await resolveClientTarget('donkey@example.org/notes', resolver), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/notes',
  })
  await assert.rejects(() => resolveClientTarget('nobody@example.org', resolver), TargetError)

  // A throwing resolver reads as unresolvable, not a crash.
  await assert.rejects(
    () =>
      resolveClientTarget('donkey@example.org', async () => {
        throw new Error('offline')
      }),
    TargetError,
  )

  // Everything else falls through to the synchronous parser untouched.
  assert.deepEqual(await resolveClientTarget(npub, resolver), {
    kind: 'hole',
    pubkey,
    npub,
    path: '/',
  })
  assert.equal((await resolveClientTarget('gopher.floodgap.com', resolver)).kind, 'gopher')
})

test('refs round-trip through the parser', () => {
  for (const input of [
    npub,
    `${npub}/notes`,
    'gopher://gopher.floodgap.com/0/gopher/relevance.txt',
    'gopher://example.org:7070/7/search',
    'gopher.floodgap.com',
  ]) {
    const target = parseClientTarget(input)
    assert.deepEqual(parseClientTarget(refOf(target)), target)
  }
})

test('describeTarget is short and readable', () => {
  assert.equal(describeTarget(parseClientTarget(`${npub}/notes`)), `${npub.slice(0, 12)}.../notes`)
  assert.equal(
    describeTarget(parseClientTarget('gopher://gopher.floodgap.com/0/gopher/relevance.txt')),
    'gopher.floodgap.com/gopher/relevance.txt',
  )
})

test('upOf walks towards the root and stops there', () => {
  const deep = parseClientTarget(`${npub}/notes/abc`)
  const notes = upOf(deep)
  assert.deepEqual(notes, { kind: 'hole', pubkey, npub, path: '/notes' })
  const root = upOf(notes!)
  assert.deepEqual(root, { kind: 'hole', pubkey, npub, path: '/' })
  assert.equal(upOf(root!), null)

  const file = parseClientTarget('gopher://example.org/0/docs/file.txt')
  const dir = upOf(file)
  assert.deepEqual(dir, {
    kind: 'gopher',
    host: 'example.org',
    port: 70,
    type: '1',
    selector: '/docs',
  })
  const top = upOf(dir!)
  assert.deepEqual(top, { kind: 'gopher', host: 'example.org', port: 70, type: '1', selector: '' })
  assert.equal(upOf(top!), null)
})
