import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readdirSync } from 'node:fs'
import {
  planDirectory,
  docToTemplate,
  nip46SigningRequestBytes,
  NIP46_SIGNING_PLAINTEXT_LIMIT,
  RECOVERY_MANIFEST,
} from '../src/publish.ts'
import { parseKindmap } from '../src/linemap.ts'
import { resolveMapLine } from '../src/resolve.ts'
import { matchVirtualPath } from '../src/virtual.ts'
import { npub } from './helpers.ts'

// The project's own hole ships in the repository so it can be republished
// from a clone. These tests are the guard against publishing something
// broken: a dead same-hole link, a document too large for a hardware signer,
// or a file the manifest forgot, which would silently never be published.

const root = path.join(import.meta.dirname, '..', 'hole')
const docs = planDirectory(root)
const paths = new Set(docs.map((doc) => doc.path))

test('the project hole plans into signable documents', () => {
  assert.ok(docs.length >= 8)
  assert.ok(paths.has('/'))
  assert.equal(docs.find((doc) => doc.path === '/')?.type, '1')
  for (const doc of docs) {
    const template = docToTemplate(doc, 1_770_000_000)
    assert.ok(
      nip46SigningRequestBytes(template) <= NIP46_SIGNING_PLAINTEXT_LIMIT,
      `${doc.path} is too large to sign remotely`,
    )
    assert.ok(doc.title.length > 0, `${doc.path} has no title`)
  }
})

test('every same-hole link points at a document that exists', () => {
  for (const doc of docs) {
    if (doc.type !== '1') continue
    for (const line of parseKindmap(doc.content)) {
      const item = resolveMapLine(line, npub)
      assert.notEqual(
        item.target.scheme,
        'invalid',
        `${doc.path}: unresolvable link ${line.link ?? ''}`,
      )
      if (item.target.scheme !== 'hole' || item.target.npub !== npub) continue
      const target = item.target.path
      // A link either resolves to something published here, or to a path the
      // bridge generates from ordinary Nostr events. Anything else is a
      // dead link the moment it is signed.
      const generated = matchVirtualPath(target) !== null
      assert.ok(
        paths.has(target) || generated,
        `${doc.path}: link to ${target} matches no document and no generated path`,
      )
    }
  }
})

// A gophermap writes information records as `iText`, so a kindmap strips one
// leading `i` from a record with no tab. Prose that happens to begin with the
// letter loses it silently, which is easy to do and hard to spot in a signed
// document. Assert the rendered information text still says what the file says.
test('no information line quietly loses its first letter', () => {
  for (const doc of docs) {
    if (doc.type !== '1') continue
    const sourceLines = doc.content.split('\n')
    const parsed = parseKindmap(doc.content)
    parsed.forEach((line, index) => {
      const source = sourceLines[index] ?? ''
      if (line.link !== undefined || source.includes('\t')) return
      assert.equal(
        line.display,
        source,
        `${doc.path} line ${index + 1}: a leading "i" was stripped`,
      )
    })
  }
})

test('the manifest covers every file in the hole', () => {
  const onDisk = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .map((rel) => rel.split(path.sep).join('/'))
    .filter((rel) => !rel.split('/').some((segment) => segment.startsWith('.')))
    .sort()
  assert.ok(onDisk.length > 0)
  assert.equal(
    onDisk.length,
    docs.length,
    `${RECOVERY_MANIFEST} lists ${docs.length} documents for ${onDisk.length} files`,
  )
})
