import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Event, EventTemplate, Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { npubEncode } from 'nostr-tools/nip19'
import {
  DOC_KIND,
  DELETE_KIND,
  RELAY_LIST_KIND,
  currentReplacement,
  docPath,
  hasControlCharacters,
  isExpired,
  isValidDocPath,
  isWellFormedUnicode,
  parseDocument,
  writeRelays,
} from './protocol.ts'
import { findSecret } from './secretguard.ts'
import type { CliSigner } from './signing.ts'
import { trustRelayUrls } from './netguard.ts'

export interface PlannedDoc {
  path: string
  type: '0' | '1'
  title: string
  content: string
}

export const RECOVERY_MANIFEST = '.gopherkind.json'

interface RecoveryManifestEntry {
  file: string
  path: string
  type: '0' | '1'
  title: string
}

interface RecoveryManifest {
  format: 'gopherkind-hole-export'
  version: 1
  documents: RecoveryManifestEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function manifestEntry(value: unknown, index: number): RecoveryManifestEntry {
  if (!isRecord(value)) throw new Error(`${RECOVERY_MANIFEST}: document ${index} is not an object`)
  const { file, path: docPath, type, title } = value
  if (
    typeof file !== 'string' ||
    file === '' ||
    !isWellFormedUnicode(file) ||
    hasControlCharacters(file)
  ) {
    throw new Error(`${RECOVERY_MANIFEST}: document ${index} has no file`)
  }
  if (
    file.startsWith('/') ||
    file.includes('\\') ||
    file.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${RECOVERY_MANIFEST}: unsafe file path: ${file}`)
  }
  if (typeof docPath !== 'string' || !isValidDocPath(docPath)) {
    throw new Error(`${RECOVERY_MANIFEST}: invalid document path: ${String(docPath)}`)
  }
  if (type !== '0' && type !== '1') {
    throw new Error(`${RECOVERY_MANIFEST}: invalid type for ${docPath}`)
  }
  if (typeof title !== 'string' || !isWellFormedUnicode(title) || hasControlCharacters(title)) {
    throw new Error(`${RECOVERY_MANIFEST}: invalid title for ${docPath}`)
  }
  return { file, path: docPath, type, title }
}

function readRecoveryManifest(abs: string): RecoveryManifest | null {
  const filename = path.join(abs, RECOVERY_MANIFEST)
  if (!existsSync(filename)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filename, 'utf8'))
  } catch (err) {
    throw new Error(`${RECOVERY_MANIFEST}: ${err instanceof Error ? err.message : 'invalid JSON'}`)
  }
  if (
    !isRecord(parsed) ||
    parsed.format !== 'gopherkind-hole-export' ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.documents)
  ) {
    throw new Error(`${RECOVERY_MANIFEST}: unsupported or malformed export manifest`)
  }
  return {
    format: 'gopherkind-hole-export',
    version: 1,
    documents: parsed.documents.map(manifestEntry),
  }
}

function planRecoveryDirectory(abs: string, manifest: RecoveryManifest): PlannedDoc[] {
  const realRoot = realpathSync(abs)
  const seenFiles = new Set<string>()
  return manifest.documents.map((entry) => {
    if (seenFiles.has(entry.file)) {
      throw new Error(`${RECOVERY_MANIFEST}: duplicate file: ${entry.file}`)
    }
    seenFiles.add(entry.file)
    const filename = path.resolve(abs, entry.file)
    const relative = path.relative(abs, filename)
    if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${RECOVERY_MANIFEST}: unsafe file path: ${entry.file}`)
    }
    if (!existsSync(filename) || !lstatSync(filename).isFile()) {
      throw new Error(`${RECOVERY_MANIFEST}: missing document file: ${entry.file}`)
    }
    const realFile = realpathSync(filename)
    const realRelative = path.relative(realRoot, realFile)
    if (realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error(`${RECOVERY_MANIFEST}: document file leaves export directory: ${entry.file}`)
    }
    return {
      path: entry.path,
      type: entry.type,
      title: entry.title,
      content: readFileSync(filename, 'utf8'),
    }
  })
}

// `index.map` (or classic `gophermap`) becomes the menu for its directory;
// any other `*.map` file becomes a menu at its own path; everything else is
// a type 0 text document. Dotfiles are skipped.
const MENU_NAMES = new Set(['index.map', 'gophermap'])

export function planDirectory(root: string): PlannedDoc[] {
  const abs = path.resolve(root)
  const manifest = readRecoveryManifest(abs)
  const docs: PlannedDoc[] = manifest === null ? [] : planRecoveryDirectory(abs, manifest)
  if (manifest === null) {
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
        docs.push({
          path: `/${posix.slice(0, -4)}`,
          type: '1',
          title: base.slice(0, -4),
          content,
        })
      } else {
        docs.push({ path: `/${posix}`, type: '0', title: base, content })
      }
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

export interface PublishOptions {
  dryRun?: boolean
  expireSeconds?: number
  pool?: PublishPool
  verifyReadback?: boolean
}

export interface PublishedDocumentReport {
  npub: string
  path: string
  eventId: string
  relays: string[]
  acceptedBy: string[]
  readableFrom: string[]
}

export interface PublishPool {
  querySync(relays: string[], filter: Filter, opts: { maxWait: number }): Promise<Event[]>
  publish(relays: string[], event: Event): Promise<string>[]
  destroy(): void
}

interface RelayPlan {
  relays: string[]
  relayList: Event | null
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

async function relayPlan(
  pubkey: string,
  configured: string[],
  pool: PublishPool,
): Promise<RelayPlan> {
  trustRelayUrls(configured)
  const lists = await pool
    .querySync(
      configured,
      { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 10 },
      { maxWait: 4000 },
    )
    .catch(() => [])
  const relayList = currentReplacement(lists, Math.floor(Date.now() / 1000))
  const relays = union(configured, relayList === null ? [] : writeRelays(relayList))
  // The local publisher is acting for this author, so their signed outbox list
  // is an explicit destination choice rather than attacker-controlled input.
  trustRelayUrls(relays)
  return { relays, relayList }
}

async function publishOne(pool: PublishPool, relays: string[], event: Event): Promise<string[]> {
  const results = await Promise.allSettled(pool.publish(relays, event))
  return relays.filter((_, index) => results[index]?.status === 'fulfilled')
}

async function verifyPublished(
  pool: PublishPool,
  relays: string[],
  events: Event[],
): Promise<Map<string, Set<string>>> {
  const ids = events.map((event) => event.id)
  const out = new Map<string, Set<string>>()
  await Promise.all(
    relays.map(async (relay) => {
      const found = await pool
        .querySync([relay], { ids, limit: ids.length }, { maxWait: 4000 })
        .catch(() => [])
      out.set(relay, new Set(found.map((event) => event.id)))
    }),
  )
  return out
}

// Publish one browser-authored document with the same relay discovery and
// read-back guarantees as directory publishing. The web frontend uses this
// rather than its HoleStore so an easy authoring path does not quietly weaken
// the publisher's NIP-65 or settlement-truth behaviour.
export async function publishDocument(
  doc: PlannedDoc,
  relays: string[],
  signer: CliSigner,
  opts: { pool?: PublishPool; now?: number } = {},
): Promise<PublishedDocumentReport> {
  const leak = findSecret(doc.content)
  if (leak) {
    throw new Error(
      `${doc.path} contains what looks like ${leak}; refusing to publish. ` +
        'Remove it before trying again.',
    )
  }
  if (Buffer.byteLength(doc.path, 'utf8') > 190) {
    throw new Error(`${doc.path} is longer than the 190-byte interoperable selector limit`)
  }
  if (Buffer.byteLength(doc.content, 'utf8') > 60 * 1024) {
    throw new Error(`${doc.path} is larger than the 60 KB relay-safe authoring limit`)
  }

  const pubkey = await signer.pubkey()
  const event = await signer.sign(docToTemplate(doc, opts.now ?? Math.floor(Date.now() / 1000)))
  if (event.pubkey !== pubkey) throw new Error('signer returned the wrong author')

  const pool = opts.pool ?? new SimplePool()
  try {
    const plan = await relayPlan(pubkey, relays, pool)
    if (plan.relayList !== null) await publishOne(pool, plan.relays, plan.relayList)
    const acceptedBy = await publishOne(pool, plan.relays, event)
    if (acceptedBy.length === 0) throw new Error('document was rejected by every relay')

    const readback = await verifyPublished(pool, plan.relays, [event])
    const readableFrom = plan.relays.filter((relay) => readback.get(relay)?.has(event.id) === true)
    if (readableFrom.length === 0) {
      throw new Error('document was accepted but is not readable from any relay')
    }
    return {
      npub: npubEncode(pubkey),
      path: doc.path,
      eventId: event.id,
      relays: plan.relays,
      acceptedBy,
      readableFrom,
    }
  } finally {
    pool.destroy()
  }
}

export async function publishHole(
  dir: string,
  relays: string[],
  signer: CliSigner,
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
  const pubkey = await signer.pubkey()
  const events: Event[] = []
  for (const doc of docs) {
    const event = await signer.sign(docToTemplate(doc, createdAt, opts.expireSeconds))
    if (event.pubkey !== pubkey) throw new Error(`signer returned the wrong author for ${doc.path}`)
    events.push(event)
  }
  const npub = npubEncode(pubkey)

  if (opts.dryRun) {
    console.log(JSON.stringify(events, null, 2))
    console.log(`\n${docs.length} document(s), not published (dry run). Hole: /${npub}`)
    return
  }

  const pool = opts.pool ?? new SimplePool()
  const plan = await relayPlan(pubkey, relays, pool)
  let ok = 0
  let failed = 0
  let verified: number | null = null
  const acceptedByRelay = new Map(plan.relays.map((relay) => [relay, 0]))
  try {
    if (plan.relayList !== null) {
      const accepted = await publishOne(pool, plan.relays, plan.relayList)
      console.log(`NIP-65 relay list  ->  ${accepted.length}/${plan.relays.length} relays`)
    }
    for (const ev of events) {
      const accepted = await publishOne(pool, plan.relays, ev)
      for (const relay of accepted) {
        acceptedByRelay.set(relay, (acceptedByRelay.get(relay) ?? 0) + 1)
      }
      if (accepted.length > 0) ok++
      else failed++
      console.log(`${docPath(ev)}  ->  ${accepted.length}/${plan.relays.length} relays`)
    }

    for (const relay of plan.relays) {
      console.log(
        `acceptance ${relay}  ->  ${acceptedByRelay.get(relay) ?? 0}/${events.length} documents`,
      )
    }

    if (opts.verifyReadback !== false) {
      const readback = await verifyPublished(pool, plan.relays, events)
      const verifiedIds = new Set<string>()
      for (const relay of plan.relays) {
        const ids = readback.get(relay) ?? new Set<string>()
        for (const id of ids) verifiedIds.add(id)
        console.log(`read-back ${relay}  ->  ${ids.size}/${events.length} documents`)
      }
      verified = verifiedIds.size
    }
  } finally {
    pool.destroy()
  }
  console.log(`\nAccepted ${ok}/${docs.length} document(s) by at least one relay.`)
  if (verified !== null) console.log(`Read back ${verified}/${docs.length} document(s).`)
  if (opts.expireSeconds !== undefined) {
    console.log(
      `Documents expire at ${new Date((createdAt + opts.expireSeconds) * 1000).toISOString()} (NIP-40).`,
    )
  }
  console.log(`Hole root selector: /${npub}`)
  console.log(`Try it: lynx gopher://127.0.0.1:7070/1/${npub}`)
  if (failed > 0) throw new Error(`${failed} document(s) were rejected by every relay`)
  if (verified !== null && verified < events.length) {
    throw new Error(`${events.length - verified} document(s) were accepted but not readable`)
  }
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
  signer: CliSigner,
  dryRun: boolean,
  injectedPool?: PublishPool,
): Promise<void> {
  const pubkey = await signer.pubkey()
  const pool = injectedPool ?? new SimplePool()
  try {
    const plan = await relayPlan(pubkey, relays, pool)
    const events = await pool.querySync(
      plan.relays,
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
    const del = await signer.sign(planDeletion(targets, now))
    if (del.pubkey !== pubkey) throw new Error('signer returned the wrong author for deletion')
    if (dryRun) {
      console.log(JSON.stringify(del, null, 2))
      console.log(`\nWould request deletion of ${targets.length} document(s) (dry run).`)
      return
    }
    if (plan.relayList !== null) await publishOne(pool, plan.relays, plan.relayList)
    const accepted = await publishOne(pool, plan.relays, del)
    console.log(
      `Deletion request for ${targets.length} document(s) accepted by ${accepted.length}/${plan.relays.length} relays.`,
    )
    console.log('Relays are free to ignore NIP-09; deletion is a request, not a guarantee.')
    if (accepted.length === 0) throw new Error('deletion request was rejected by every relay')
  } finally {
    pool.destroy()
  }
}
