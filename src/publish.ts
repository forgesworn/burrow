import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { Event, EventTemplate } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { SimplePool } from 'nostr-tools/pool'
import {
  DOC_KIND,
  DELETE_KIND,
  docPath,
  hasControlCharacters,
  isExpired,
  isValidDocPath,
  isWellFormedUnicode,
  parseDocument,
} from './protocol.ts'
import { findSecret } from './secretguard.ts'

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
    const posix = rel.split(path.sep).join('/').normalize('NFC')
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

export function docToTemplate(
  doc: PlannedDoc,
  createdAt: number,
  expireSeconds?: number,
): EventTemplate {
  if (!isValidDocPath(doc.path)) throw new Error(`invalid document path: ${doc.path}`)
  if (!isWellFormedUnicode(doc.title) || hasControlCharacters(doc.title)) {
    throw new Error(`invalid document title at ${doc.path}`)
  }
  const tags = [
    ['d', doc.path],
    ['type', doc.type],
    ['title', doc.title],
  ]
  if (expireSeconds !== undefined) tags.push(['expiration', String(createdAt + expireSeconds)])
  return { kind: DOC_KIND, created_at: createdAt, tags, content: doc.content }
}

export function parseDuration(s: string): number {
  const m = /^(\d+)([smhdw])$/.exec(s)
  if (!m) throw new Error(`bad duration: ${s} (use e.g. 90m, 12h, 30d, 2w)`)
  const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2] as 's' | 'm' | 'h' | 'd' | 'w']
  return Number(m[1]) * mult
}

export function decodeSecret(secret: string): Uint8Array {
  if (secret.startsWith('nsec1')) {
    const decoded = nip19.decode(secret)
    if (decoded.type !== 'nsec') throw new Error('not an nsec')
    return decoded.data
  }
  if (/^[0-9a-f]{64}$/i.test(secret)) return Uint8Array.from(Buffer.from(secret, 'hex'))
  throw new Error('GOPHERKIND_NSEC must be nsec1... or 64 hex chars')
}

export interface PublishOptions {
  dryRun?: boolean
  expireSeconds?: number
}

export async function publishHole(
  dir: string,
  relays: string[],
  secret: Uint8Array,
  opts: PublishOptions = {},
): Promise<void> {
  const docs = planDirectory(dir)
  if (docs.length === 0) throw new Error(`no documents found in ${dir}`)
  for (const doc of docs) {
    const leak = findSecret(doc.content)
    if (leak) {
      throw new Error(
        `${doc.path} contains what looks like ${leak}; refusing to publish. ` +
          'Remove it, or move the file out of the hole directory.',
      )
    }
  }
  // Most relays cap event size (commonly 64-256 KB) and will silently reject
  // an oversized document. Warn rather than fail, so a big page still tries.
  const SIZE_WARN = 60 * 1024
  for (const doc of docs) {
    if (Buffer.byteLength(doc.path, 'utf8') > 190) {
      console.error(
        `warning: ${doc.path} is longer than 190 UTF-8 bytes; ` +
          'some RFC 1436 clients may reject its selector.',
      )
    }
    if (Buffer.byteLength(doc.content, 'utf8') > SIZE_WARN) {
      console.error(
        `warning: ${doc.path} is ${Math.round(Buffer.byteLength(doc.content, 'utf8') / 1024)} KB; ` +
          'some relays may reject it.',
      )
    }
  }
  const createdAt = Math.floor(Date.now() / 1000)
  const events = docs.map((d) =>
    finalizeEvent(docToTemplate(d, createdAt, opts.expireSeconds), secret),
  )
  const npub = nip19.npubEncode(getPublicKey(secret))

  if (opts.dryRun) {
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
  if (opts.expireSeconds !== undefined) {
    console.log(
      `Documents expire at ${new Date((createdAt + opts.expireSeconds) * 1000).toISOString()} (NIP-40).`,
    )
  }
  console.log(`Hole root selector: /${npub}`)
  console.log(`Try it: lynx gopher://127.0.0.1:7070/1/${npub}`)
}

// NIP-09 deletion request covering the given documents.
export function planDeletion(events: Event[], createdAt: number): EventTemplate {
  const tags: string[][] = [['k', String(DOC_KIND)]]
  for (const ev of events) {
    tags.push(['e', ev.id])
    tags.push(['a', `${DOC_KIND}:${ev.pubkey}:${docPath(ev)}`])
  }
  return { kind: DELETE_KIND, created_at: createdAt, tags, content: 'gopherkind unpublish' }
}

export async function unpublishHole(
  paths: string[] | 'all',
  relays: string[],
  secret: Uint8Array,
  dryRun: boolean,
): Promise<void> {
  const pubkey = getPublicKey(secret)
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      relays,
      { kinds: [DOC_KIND], authors: [pubkey], limit: 500 },
      { maxWait: 6000 },
    )
    const now = Math.floor(Date.now() / 1000)
    const byPath = new Map<string, Event>()
    for (const ev of events) {
      const doc = parseDocument(ev)
      if (!doc) continue
      const prev = byPath.get(doc.path)
      if (
        !prev ||
        prev.created_at < ev.created_at ||
        (prev.created_at === ev.created_at && ev.id < prev.id)
      ) {
        byPath.set(doc.path, ev)
      }
    }
    for (const [path, ev] of byPath) if (isExpired(ev, now)) byPath.delete(path)
    let targets: Event[]
    if (paths === 'all') {
      targets = [...byPath.values()]
    } else {
      targets = []
      for (const p of paths) {
        const ev = byPath.get(p)
        if (ev) targets.push(ev)
        else console.error(`no document at ${p}, skipping`)
      }
    }
    if (targets.length === 0) {
      console.log('Nothing to unpublish.')
      return
    }
    const del = finalizeEvent(planDeletion(targets, now), secret)
    if (dryRun) {
      console.log(JSON.stringify(del, null, 2))
      console.log(`\nWould request deletion of ${targets.length} document(s) (dry run).`)
      return
    }
    const results = await Promise.allSettled(pool.publish(relays, del))
    const accepted = results.filter((r) => r.status === 'fulfilled').length
    console.log(
      `Deletion request for ${targets.length} document(s) accepted by ${accepted}/${relays.length} relays.`,
    )
    console.log('Relays are free to ignore NIP-09; deletion is a request, not a guarantee.')
  } finally {
    pool.destroy()
  }
}
