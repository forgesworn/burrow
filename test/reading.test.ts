import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import type { HoleStore } from '../src/fetch.ts'
import { resolveRoute } from '../src/router.ts'
import { makeStore, note, npub, pubkey } from './helpers.ts'

const strangerKey = generateSecretKey()
const reply = finalizeEvent(
  {
    kind: 1,
    created_at: note.created_at + 1,
    tags: [
      ['p', pubkey],
      ['e', note.id, '', 'reply'],
    ],
    content: 'A useful reply',
  },
  strangerKey,
)
const mention = finalizeEvent(
  {
    kind: 1,
    created_at: note.created_at + 2,
    tags: [['p', pubkey]],
    content: 'A top-level mention',
  },
  strangerKey,
)

function readingStore(): HoleStore {
  return Object.assign(makeStore(), {
    replies: async () => [reply],
    mentions: async () => [mention],
    thread: async () => ({ focus: note, ancestors: [], replies: [reply] }),
  })
}

test('generated replies and mentions link to the interacting author thread', async () => {
  const store = readingStore()
  const strangerNpub = nip19.npubEncode(reply.pubkey)
  for (const [path, text, id] of [
    ['/replies', 'A useful reply', reply.id],
    ['/mentions', 'A top-level mention', mention.id],
  ] as const) {
    const content = await resolveRoute({ kind: 'doc', pubkey, npub, path }, store, {
      virtual: true,
    })
    assert.equal(content.kind, 'menu')
    if (content.kind !== 'menu') continue
    assert.match(content.items[0]?.display ?? '', new RegExp(text))
    assert.deepEqual(content.items[0]?.target, {
      scheme: 'hole',
      npub: strangerNpub,
      path: `/threads/${id}`,
    })
  }
})

test('thread context shows the focus and available replies on every frontend', async () => {
  const content = await resolveRoute(
    { kind: 'doc', pubkey, npub, path: `/threads/${note.id}` },
    readingStore(),
    { virtual: false },
  )
  assert.equal(content.kind, 'menu')
  if (content.kind !== 'menu') return
  assert.ok(content.items.some((item) => item.display.includes('braying about gopherspace')))
  assert.ok(content.items.some((item) => item.display.includes('A useful reply')))
  assert.ok(
    content.items.some(
      (item) => item.target.scheme === 'hole' && item.target.path === `/notes/${note.id}`,
    ),
  )
})
