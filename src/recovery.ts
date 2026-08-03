import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Event, Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { npubEncode } from 'nostr-tools/nip19'
import {
  currentDocument,
  currentReplacement,
  DOC_KIND,
  docPath,
  isValidDocPath,
  parseDocument,
  RELAY_LIST_KIND,
  tagValue,
  writeRelays,
} from './protocol.ts'
import { publicRelayUrls, trustRelayUrls } from './netguard.ts'
import { RECOVERY_MANIFEST } from './publish.ts'

export interface HoleExportManifest {
  format: 'gopherkind-hole-export'
  version: 1
  npub: string
  exportedAt: string
  documents: Array<{
    file: string
    path: string
    type: '0' | '1'
    title: string
    eventId: string
    createdAt: number
  }>
}

function slugFor(docPath: string): string {
  const raw = docPath === '/' ? 'root' : docPath.slice(1).replaceAll('/', '--')
  const cleaned = raw.normalize('NFC').replaceAll(/[^\p{Letter}\p{Number}._-]+/gu, '_')
  return (cleaned || 'document').slice(0, 80)
}

export function writeHoleExport(
  events: Event[],
  pubkey: string,
  outputDir: string,
  opts: { force?: boolean; now?: Date } = {},
): HoleExportManifest {
  const abs = path.resolve(outputDir)
  if (existsSync(abs)) {
    const target = lstatSync(abs)
    if (target.isSymbolicLink() || !target.isDirectory()) {
      throw new Error(`export target is not a regular directory: ${abs}`)
    }
    if (!opts.force && readdirSync(abs).length > 0) {
      throw new Error(`export target is not empty: ${abs} (use --force to overwrite)`)
    }
  } else {
    mkdirSync(abs, { recursive: true })
  }

  const now = opts.now ?? new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const byPath = new Map<string, Event[]>()
  for (const event of events) {
    if (event.pubkey !== pubkey || event.kind !== DOC_KIND) continue
    const coordinate = tagValue(event, 'd')
    if (coordinate === undefined) continue
    const revisions = byPath.get(coordinate)
    if (revisions) revisions.push(event)
    else byPath.set(coordinate, [event])
  }
  const current = [...byPath.values()]
    .map((revisions) => currentDocument(revisions, nowSeconds))
    .filter((event): event is Event => event !== null)
    .sort((a, b) => docPath(a).localeCompare(docPath(b)))
  if (current.length === 0) throw new Error('no current documents found to export')

  const documentsDir = path.join(abs, 'documents')
  if (existsSync(documentsDir)) {
    const target = lstatSync(documentsDir)
    if (target.isSymbolicLink() || !target.isDirectory()) {
      throw new Error(`unsafe export documents directory: ${documentsDir}`)
    }
  } else {
    mkdirSync(documentsDir)
  }
  const documents: HoleExportManifest['documents'] = []
  for (const [index, event] of current.entries()) {
    const doc = parseDocument(event)
    if (doc === null) continue
    const extension = doc.type === '1' ? '.map' : '.txt'
    const file = `documents/${String(index + 1).padStart(4, '0')}-${slugFor(doc.path)}${extension}`
    const filename = path.join(abs, file)
    if (existsSync(filename) && (!opts.force || !lstatSync(filename).isFile())) {
      throw new Error(`refusing to overwrite export file: ${filename}`)
    }
    writeFileSync(filename, event.content, { encoding: 'utf8', flag: opts.force ? 'w' : 'wx' })
    documents.push({
      file,
      path: doc.path,
      type: doc.type,
      title: doc.title,
      eventId: event.id,
      createdAt: event.created_at,
    })
  }
  const manifest: HoleExportManifest = {
    format: 'gopherkind-hole-export',
    version: 1,
    npub: npubEncode(pubkey),
    exportedAt: now.toISOString(),
    documents,
  }
  const manifestFile = path.join(abs, RECOVERY_MANIFEST)
  if (existsSync(manifestFile) && (!opts.force || !lstatSync(manifestFile).isFile())) {
    throw new Error(`refusing to overwrite export manifest: ${manifestFile}`)
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: opts.force ? 'w' : 'wx',
  })
  return manifest
}

export interface InspectPool {
  querySync(relays: string[], filter: Filter, opts: { maxWait: number }): Promise<Event[]>
  ensureRelay?(url: string): Promise<{ onnotice: (() => void) | ((message: string) => void) }>
  destroy(): void
}

export interface RelayInspection {
  relay: string
  reachable: boolean
  present: string[]
  stale: string[]
  missing: string[]
}

export interface HoleInspection {
  npub: string
  documents: Array<{ path: string; eventId: string }>
  suppressed: string[]
  relays: RelayInspection[]
}

function documentState(
  events: Event[],
  pubkey: string,
  now: number,
): { current: Map<string, Event>; suppressed: string[] } {
  const grouped = new Map<string, Event[]>()
  for (const event of events) {
    if (event.kind !== DOC_KIND || event.pubkey !== pubkey) continue
    const coordinate = tagValue(event, 'd')
    if (coordinate === undefined) continue
    const revisions = grouped.get(coordinate)
    if (revisions) revisions.push(event)
    else grouped.set(coordinate, [event])
  }
  const current = new Map<string, Event>()
  const suppressed: string[] = []
  for (const [coordinate, revisions] of grouped) {
    const event = currentDocument(revisions, now)
    if (event !== null) current.set(docPath(event), event)
    else if (isValidDocPath(coordinate)) suppressed.push(coordinate)
  }
  return { current, suppressed: suppressed.sort() }
}

function union(...sets: readonly string[][]): string[] {
  return [...new Set(sets.flat())]
}

export async function inspectHole(
  pubkey: string,
  configuredRelays: string[],
  relayHints: string[] = [],
  opts: {
    pool?: InspectPool
    filterUntrustedRelays?: (urls: readonly string[]) => Promise<string[]>
    now?: number
  } = {},
): Promise<HoleInspection> {
  trustRelayUrls(configuredRelays)
  const pool = opts.pool ?? new SimplePool()
  const filterUntrusted = opts.filterUntrustedRelays ?? publicRelayUrls
  const safeHints = await filterUntrusted(relayHints)
  const discoveryRelays = union(configuredRelays, safeHints)
  const now = opts.now ?? Math.floor(Date.now() / 1000)
  try {
    const relayLists = await pool
      .querySync(
        discoveryRelays,
        { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 10 },
        { maxWait: 4000 },
      )
      .catch(() => [])
    const relayList = currentReplacement(
      relayLists.filter((event) => event.kind === RELAY_LIST_KIND && event.pubkey === pubkey),
      now,
    )
    const authorRelays = await filterUntrusted(relayList === null ? [] : writeRelays(relayList))
    const relays = union(configuredRelays, safeHints, authorRelays)
    const allEvents = await pool
      .querySync(relays, { kinds: [DOC_KIND], authors: [pubkey], limit: 500 }, { maxWait: 6000 })
      .catch(() => [])
    const expectedState = documentState(allEvents, pubkey, now)
    const expected = expectedState.current
    const reports = await Promise.all(
      relays.map(async (relay): Promise<RelayInspection> => {
        let relayEvents: Event[]
        try {
          if (pool.ensureRelay !== undefined) {
            const connection = await pool.ensureRelay(relay)
            connection.onnotice = () => {}
          }
          relayEvents = await pool.querySync(
            [relay],
            { kinds: [DOC_KIND], authors: [pubkey], limit: 500 },
            { maxWait: 4000 },
          )
        } catch {
          return {
            relay,
            reachable: false,
            present: [],
            stale: [],
            missing: [...expected.keys()].sort(),
          }
        }
        const found = documentState(relayEvents, pubkey, now).current
        const present: string[] = []
        const stale: string[] = []
        const missing: string[] = []
        for (const [docPath, event] of expected) {
          const candidate = found.get(docPath)
          if (candidate?.id === event.id) present.push(docPath)
          else if (candidate !== undefined) stale.push(docPath)
          else missing.push(docPath)
        }
        return { relay, reachable: true, present, stale, missing }
      }),
    )
    return {
      npub: npubEncode(pubkey),
      documents: [...expected].map(([docPath, event]) => ({ path: docPath, eventId: event.id })),
      suppressed: expectedState.suppressed,
      relays: reports,
    }
  } finally {
    pool.destroy()
  }
}

export function formatHoleInspection(inspection: HoleInspection): string {
  const count = inspection.documents.length
  const lines = [`hole: ${inspection.npub}`, `current documents found: ${count}`, '']
  if (inspection.suppressed.length > 0) {
    lines.push(
      `suppressed by a winning malformed or expired revision: ${inspection.suppressed.join(', ')}`,
      '',
    )
  }
  for (const report of inspection.relays) {
    if (!report.reachable) {
      lines.push(`${report.relay}  unreachable`)
      continue
    }
    lines.push(`${report.relay}  ${report.present.length}/${count} current documents readable`)
    if (report.stale.length > 0) lines.push(`  stale revision: ${report.stale.join(', ')}`)
    if (report.missing.length > 0) lines.push(`  missing: ${report.missing.join(', ')}`)
  }
  lines.push('', 'This is a read check now, not proof that a relay will retain the documents.', '')
  return lines.join('\n')
}
