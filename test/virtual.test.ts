import test from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import {
  parseProfile,
  displayName,
  matchVirtualPath,
  wrap,
  notesMenuLines,
  articlesMenuLines,
  profileText,
  articleText,
  atomFeed,
} from '../src/virtual.ts'

const sk = generateSecretKey()
const npub = nip19.npubEncode(getPublicKey(sk))

function ev(kind: number, content: string, tags: string[][] = []) {
  return finalizeEvent({ kind, created_at: 1_754_000_000, tags, content }, sk)
}

test('parseProfile prefers display_name, tolerates junk', () => {
  const good = parseProfile(ev(0, '{"name":"don","display_name":"The Donkey","about":"hee haw"}'))
  assert.equal(good?.name, 'The Donkey')
  assert.equal(good?.about, 'hee haw')
  assert.equal(parseProfile(ev(0, 'not json')), null)
  assert.equal(parseProfile(null), null)
})

test('displayName falls back to a shortened npub', () => {
  assert.equal(displayName(null, npub), `${npub.slice(0, 16)}...`)
  assert.equal(displayName({ name: 'don' }, npub), 'don')
})

test('matchVirtualPath recognises the reserved paths', () => {
  assert.deepEqual(matchVirtualPath('/'), { kind: 'root' })
  assert.deepEqual(matchVirtualPath('/profile.txt'), { kind: 'profile' })
  assert.deepEqual(matchVirtualPath('/notes'), { kind: 'notes' })
  assert.deepEqual(matchVirtualPath('/replies'), { kind: 'replies' })
  assert.deepEqual(matchVirtualPath('/mentions'), { kind: 'mentions' })
  assert.deepEqual(matchVirtualPath('/feed.xml'), { kind: 'feed' })
  assert.deepEqual(matchVirtualPath(`/notes/${'a'.repeat(64)}`), {
    kind: 'note',
    id: 'a'.repeat(64),
  })
  assert.equal(matchVirtualPath('/notes/nonsense'), null)
  assert.deepEqual(matchVirtualPath(`/threads/${'b'.repeat(64)}`), {
    kind: 'thread',
    id: 'b'.repeat(64),
  })
  assert.equal(matchVirtualPath('/threads/nope'), null)
  assert.deepEqual(matchVirtualPath('/articles'), { kind: 'articles' })
  const article = nip19.naddrEncode({
    kind: 30023,
    pubkey: getPublicKey(sk),
    identifier: 'my-post',
  })
  assert.deepEqual(matchVirtualPath(`/articles/${article}`), {
    kind: 'article',
    pubkey: getPublicKey(sk),
    d: 'my-post',
  })
  const cursorShapedArticle = nip19.naddrEncode({
    kind: 30023,
    pubkey: getPublicKey(sk),
    identifier: 'before/42',
  })
  assert.deepEqual(matchVirtualPath(`/articles/${cursorShapedArticle}`), {
    kind: 'article',
    pubkey: getPublicKey(sk),
    d: 'before/42',
  })
  assert.equal(matchVirtualPath('/articles/my-post'), null)
  assert.equal(matchVirtualPath('/anything-else'), null)
})

test('wrap respects width and paragraphs', () => {
  const lines = wrap('one two three four five', 9)
  assert.deepEqual(lines, ['one two', 'three', 'four five'])
  assert.deepEqual(wrap('a\n\nb'), ['a', '', 'b'])
})

test('notesMenuLines links each note by id', () => {
  const note = ev(1, 'first line\nsecond line')
  const [line] = notesMenuLines([note])
  assert.equal(line?.type, '0')
  assert.equal(line?.link, `/notes/${note.id}`)
  assert.match(line?.display ?? '', /first line/)
  assert.equal(notesMenuLines([note])[1]?.link, `/threads/${note.id}`)
  assert.deepEqual(notesMenuLines([]), [{ type: 'i', display: 'No notes found.' }])
})

test('Atom feed has stable Nostr identifiers and escapes event content', () => {
  const note = ev(1, 'nuts & bolts <still text>')
  const article = ev(30023, 'long body', [
    ['d', 'long'],
    ['title', 'Long & useful'],
  ])
  const feed = atomFeed({ name: 'Don & Co' }, npub, [note], [article])
  assert.match(feed, /^<\?xml version="1\.0" encoding="utf-8"\?>/)
  assert.match(feed, new RegExp(`<id>nostr:${npub}</id>`))
  assert.match(feed, /<title>Don &amp; Co<\/title>/)
  assert.match(feed, /nuts &amp; bolts &lt;still text&gt;/)
  assert.match(feed, /href="nostr:nevent1/)
  assert.match(feed, /href="nostr:naddr1/)
})

test('articlesMenuLines uses title tag and an naddr permalink', () => {
  const article = ev(30023, 'body', [
    ['d', 'my-post'],
    ['title', 'My Post'],
  ])
  const [line] = articlesMenuLines([article])
  assert.match(line?.link ?? '', /^\/articles\/naddr1/)
  const encoded = (line?.link ?? '').slice('/articles/'.length)
  const decoded = nip19.decode(encoded)
  assert.equal(decoded.type, 'naddr')
  if (decoded.type === 'naddr') assert.equal(decoded.data.identifier, 'my-post')
  assert.match(line?.display ?? '', /My Post/)
})

test('profileText and articleText carry the useful fields', () => {
  const text = profileText({ name: 'don', nip05: 'don@example.com', about: 'hee haw' }, npub)
  assert.match(text, /Profile: don/)
  assert.match(text, /nip05: {3}don@example\.com/)
  assert.match(text, /hee haw/)
  const article = articleText(
    ev(30023, 'body text', [
      ['d', 'p'],
      ['title', 'T'],
      ['summary', 'S'],
    ]),
  )
  assert.match(article, /^T\n/)
  assert.match(article, /S/)
  assert.match(article, /body text/)
})
