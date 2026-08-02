import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { EventTemplate } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { SimplePool } from 'nostr-tools/pool'
import { BURROW_KIND, docPath } from './protocol.ts'

export interface PlannedDoc {
  path: string
  type: '0' | '1'
  title: string
  content: string
}

// `index.map` (or classic `gophermap`) becomes the menu for its directory;
// any other `*.map` file becomes a menu at its own path; everything else is
// a type 0 text document. Dotfiles are skipped.
const MENU_NAMES = new Set(['index.map', 'gophermap'])

export function planDirectory(root: string): PlannedDoc[] {
  const abs = path.resolve(root)
  const docs: PlannedDoc[] = []
  const entries = readdirSync(abs, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const rel = path.relative(abs, path.join(entry.parentPath, entry.name))
    const posix = rel.split(path.sep).join('/')
    if (posix.split('/').some((seg) => seg.startsWith('.'))) continue
    const content = readFileSync(path.join(abs, rel), 'utf8')
    const base = posix.split('/').pop() ?? ''
    if (MENU_NAMES.has(base)) {
      const dir = posix.split('/').slice(0, -1).join('/')
      docs.push({
        path: dir === '' ? '/' : `/${dir}`,
        type: '1',
        title: dir === '' ? 'root' : dir,
        content,
      })
    } else if (base.endsWith('.map')) {
      docs.push({ path: `/${posix.slice(0, -4)}`, type: '1', title: base.slice(0, -4), content })
    } else {
      docs.push({ path: `/${posix}`, type: '0', title: base, content })
    }
  }
  docs.sort((a, b) => a.path.localeCompare(b.path))
  const seen = new Set<string>()
  for (const d of docs) {
    if (seen.has(d.path)) throw new Error(`duplicate document path: ${d.path}`)
    seen.add(d.path)
  }
  return docs
}

export function docToTemplate(doc: PlannedDoc, createdAt: number): EventTemplate {
  return {
    kind: BURROW_KIND,
    created_at: createdAt,
    tags: [
      ['d', doc.path],
      ['type', doc.type],
      ['title', doc.title],
    ],
    content: doc.content,
  }
}

export function decodeSecret(secret: string): Uint8Array {
  if (secret.startsWith('nsec1')) {
    const decoded = nip19.decode(secret)
    if (decoded.type !== 'nsec') throw new Error('not an nsec')
    return decoded.data
  }
  if (/^[0-9a-f]{64}$/i.test(secret)) return Uint8Array.from(Buffer.from(secret, 'hex'))
  throw new Error('BURROW_NSEC must be nsec1... or 64 hex chars')
}

export async function publishHole(
  dir: string,
  relays: string[],
  secret: Uint8Array,
  dryRun: boolean,
): Promise<void> {
  const docs = planDirectory(dir)
  if (docs.length === 0) throw new Error(`no documents found in ${dir}`)
  const createdAt = Math.floor(Date.now() / 1000)
  const events = docs.map((d) => finalizeEvent(docToTemplate(d, createdAt), secret))
  const npub = nip19.npubEncode(getPublicKey(secret))

  if (dryRun) {
    console.log(JSON.stringify(events, null, 2))
    console.log(`\n${docs.length} document(s), not published (dry run). Hole: /${npub}`)
    return
  }

  const pool = new SimplePool()
  let ok = 0
  let failed = 0
  for (const ev of events) {
    const results = await Promise.allSettled(pool.publish(relays, ev))
    const accepted = results.filter((r) => r.status === 'fulfilled').length
    if (accepted > 0) ok++
    else failed++
    console.log(`${docPath(ev)}  ->  ${accepted}/${relays.length} relays`)
  }
  pool.destroy()
  console.log(`\nPublished ${ok}/${docs.length} document(s)${failed ? `, ${failed} failed` : ''}.`)
  console.log(`Hole root selector: /${npub}`)
  console.log(`Try it: lynx gopher://127.0.0.1:7070/1/${npub}`)
}
