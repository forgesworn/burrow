import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import type { MapLine } from './linemap.ts'
import { tagValue, isoDate, firstLine, LONG_FORM_KIND } from './protocol.ts'
export { firstLine }

// Virtual holes: any npub browses as a gopherhole even when it has never
// published a kind 31436 event. Profile, notes and long-form articles are
// rendered from the events every Nostr user already has. Authored
// documents always shadow virtual paths.

export interface Profile {
  name?: string
  about?: string
  nip05?: string
  lud16?: string
  website?: string
}

export interface TimeCursor {
  createdAt: number
  id: string
}

export function parseProfile(ev: Event | null): Profile | null {
  if (!ev) return null
  try {
    const raw = JSON.parse(ev.content) as Record<string, unknown>
    const str = (k: string): string | undefined =>
      typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined
    return {
      name: str('display_name') ?? str('name'),
      about: str('about'),
      nip05: str('nip05'),
      lud16: str('lud16'),
      website: str('website'),
    }
  } catch {
    return null
  }
}

export function displayName(profile: Profile | null, npub: string): string {
  return profile?.name ?? `${npub.slice(0, 16)}...`
}

// A page of a generated stream. Gopher has no query string, so a composite
// timestamp/id cursor lives in the path for time-ordered streams and an
// offset lives there for flat people lists. Authored documents still shadow
// every generated path.
export type VirtualPath =
  | { kind: 'root' }
  | { kind: 'profile' }
  | { kind: 'notes'; before?: TimeCursor }
  | { kind: 'note'; id: string }
  | { kind: 'replies'; before?: TimeCursor }
  | { kind: 'mentions'; before?: TimeCursor }
  | { kind: 'thread'; id: string }
  | { kind: 'feed' }
  | { kind: 'articles'; before?: TimeCursor }
  | { kind: 'article'; pubkey: string; d: string }
  | { kind: 'follows'; from?: number }
  | { kind: 'followers'; from?: number }

// How many entries a generated page holds before it offers an older one.
export const PAGE = 20
export const PEOPLE_PAGE = 200

const BEFORE = /^before\/(\d{1,10})\/([0-9a-f]{64})$/
const FROM = /^from\/(\d{1,7})$/

function timeCursor(rest: string): TimeCursor | null {
  const m = BEFORE.exec(rest)
  return m ? { createdAt: Number(m[1]), id: m[2] as string } : null
}

function articlePath(rest: string): VirtualPath | null {
  try {
    const decoded = nip19.decode(rest)
    if (decoded.type !== 'naddr' || decoded.data.kind !== LONG_FORM_KIND) return null
    return { kind: 'article', pubkey: decoded.data.pubkey, d: decoded.data.identifier }
  } catch {
    return null
  }
}

function peoplePage(kind: 'follows' | 'followers', rest: string): VirtualPath | null {
  const m = FROM.exec(rest)
  return m ? { kind, from: Number(m[1]) } : null
}

export function matchVirtualPath(path: string): VirtualPath | null {
  if (path === '/') return { kind: 'root' }
  if (path === '/profile.txt') return { kind: 'profile' }
  if (path === '/follows') return { kind: 'follows' }
  if (path === '/followers') return { kind: 'followers' }
  if (path.startsWith('/follows/')) return peoplePage('follows', path.slice('/follows/'.length))
  if (path.startsWith('/followers/')) {
    return peoplePage('followers', path.slice('/followers/'.length))
  }
  if (path === '/notes') return { kind: 'notes' }
  if (path.startsWith('/notes/')) {
    const rest = path.slice('/notes/'.length)
    if (/^[0-9a-f]{64}$/.test(rest)) return { kind: 'note', id: rest }
    const before = timeCursor(rest)
    return before ? { kind: 'notes', before } : null
  }
  if (path === '/replies') return { kind: 'replies' }
  if (path.startsWith('/replies/')) {
    const before = timeCursor(path.slice('/replies/'.length))
    return before ? { kind: 'replies', before } : null
  }
  if (path === '/mentions') return { kind: 'mentions' }
  if (path.startsWith('/mentions/')) {
    const before = timeCursor(path.slice('/mentions/'.length))
    return before ? { kind: 'mentions', before } : null
  }
  if (path.startsWith('/threads/')) {
    const id = path.slice('/threads/'.length)
    return /^[0-9a-f]{64}$/.test(id) ? { kind: 'thread', id } : null
  }
  if (path === '/feed.xml') return { kind: 'feed' }
  if (path === '/articles') return { kind: 'articles' }
  if (path.startsWith('/articles/')) {
    const rest = path.slice('/articles/'.length)
    const before = timeCursor(rest)
    return before ? { kind: 'articles', before } : articlePath(rest)
  }
  return null
}

// The navigation tail of a generated page: an older-page link when this one
// filled up, and a way back to the top once the reader has paged down.
export function eventCursor(ev: Event | undefined): TimeCursor | null {
  return ev ? { createdAt: ev.created_at, id: ev.id } : null
}

export function pageLines(base: string, cursor: TimeCursor | null, paged: boolean): MapLine[] {
  const lines: MapLine[] = []
  if (cursor !== null || paged) lines.push({ type: 'i', display: '' })
  if (cursor !== null) {
    lines.push({
      type: '1',
      display: 'Older',
      link: `${base}/before/${cursor.createdAt}/${cursor.id}`,
    })
  }
  if (paged) lines.push({ type: '1', display: 'Back to the latest', link: base })
  return lines
}

// The same tail for a flat list paged by offset rather than time.
export function offsetLines(base: string, total: number, from: number, shown: number): MapLine[] {
  const lines: MapLine[] = []
  const next = from + shown
  if (next >= total && from === 0) return lines
  lines.push({ type: 'i', display: '' })
  lines.push({
    type: 'i',
    display: `showing ${total === 0 ? 0 : from + 1}-${next} of ${total}`,
  })
  if (next < total) lines.push({ type: '1', display: 'More', link: `${base}/from/${next}` })
  if (from > 0) lines.push({ type: '1', display: 'Back to the start', link: base })
  return lines
}

export function wrap(text: string, width = 68): string[] {
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if (line === '') line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line !== '') out.push(line)
  }
  return out
}

export function virtualRootLines(profile: Profile | null, npub: string): MapLine[] {
  const lines: MapLine[] = [
    { type: 'i', display: displayName(profile, npub) },
    { type: 'i', display: 'a virtual hole generated from Nostr events' },
    { type: 'i', display: '' },
  ]
  if (profile?.about) {
    for (const l of wrap(profile.about)) lines.push({ type: 'i', display: l })
    lines.push({ type: 'i', display: '' })
  }
  lines.push({ type: '0', display: 'Profile', link: '/profile.txt' })
  lines.push({ type: '1', display: 'Notes', link: '/notes' })
  lines.push({ type: '1', display: 'Replies', link: '/replies' })
  lines.push({ type: '1', display: 'Mentions', link: '/mentions' })
  lines.push({ type: '1', display: 'Articles (long-form)', link: '/articles' })
  lines.push({ type: '0', display: 'Atom feed', link: '/feed.xml' })
  lines.push({ type: '1', display: 'Follows', link: '/follows' })
  lines.push({ type: '1', display: 'Followers', link: '/followers' })
  lines.push({ type: '7', display: 'Search', link: '/' })
  return lines
}

// A list of people as a menu of holes: each entry links to that npub's
// own hole, so you can walk the social graph by following links.
export function peopleMenuLines(
  people: { npub: string; name: string; about?: string }[],
  emptyMessage: string,
): MapLine[] {
  if (people.length === 0) return [{ type: 'i', display: emptyMessage }]
  const lines: MapLine[] = []
  for (const p of people) {
    lines.push({ type: '1', display: p.name, link: p.npub })
    if (p.about) lines.push({ type: 'i', display: `    ${firstLine(p.about, 64)}` })
  }
  return lines
}

export function profileText(profile: Profile | null, npub: string): string {
  const rows = [`Profile: ${displayName(profile, npub)}`, `npub:    ${npub}`]
  if (profile?.nip05) rows.push(`nip05:   ${profile.nip05}`)
  if (profile?.website) rows.push(`web:     ${profile.website}`)
  if (profile?.lud16) rows.push(`zap:     ${profile.lud16}`)
  if (profile?.about) rows.push('', ...wrap(profile.about))
  return `${rows.join('\n')}\n`
}

export function notesMenuLines(notes: Event[]): MapLine[] {
  if (notes.length === 0) return [{ type: 'i', display: 'No notes found.' }]
  return notes.flatMap((ev) => [
    {
      type: '0' as const,
      display: `${isoDate(ev.created_at)}  ${firstLine(ev.content)}`,
      link: `/notes/${ev.id}`,
    },
    {
      type: '1' as const,
      display: '    thread and replies',
      link: `/threads/${ev.id}`,
    },
  ])
}

export function noteText(ev: Event): string {
  return `${[`date: ${isoDate(ev.created_at)}`, `id:   ${ev.id}`, '', ev.content].join('\n')}\n`
}

function xmlText(value: string): string {
  const safe = [...value]
    .map((character) => {
      const code = character.codePointAt(0) as number
      const valid =
        code === 0x9 ||
        code === 0xa ||
        code === 0xd ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff)
      return valid ? character : '\uFFFD'
    })
    .join('')
  return safe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function eventUri(event: Event): string | null {
  if (event.kind === 1) {
    return `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey })}`
  }
  if (event.kind === LONG_FORM_KIND) {
    const identifier = tagValue(event, 'd')
    if (identifier === undefined) return null
    return `nostr:${nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier })}`
  }
  return null
}

function atomTitle(event: Event): string {
  return event.kind === LONG_FORM_KIND
    ? articleTitle(event)
    : firstLine(event.content, 120) || 'Note'
}

export function atomFeed(
  profile: Profile | null,
  npub: string,
  notes: Event[],
  articles: Event[],
): string {
  const entries = [...notes, ...articles]
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    .slice(0, 40)
  const updated = new Date((entries[0]?.created_at ?? 0) * 1000).toISOString()
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>nostr:${xmlText(npub)}</id>`,
    `  <title>${xmlText(displayName(profile, npub))}</title>`,
    `  <updated>${updated}</updated>`,
    `  <link rel="alternate" href="nostr:${xmlText(npub)}"/>`,
    '  <author>',
    `    <name>${xmlText(displayName(profile, npub))}</name>`,
    `    <uri>nostr:${xmlText(npub)}</uri>`,
    '  </author>',
  ]
  for (const event of entries) {
    const uri = eventUri(event)
    if (uri === null) continue
    lines.push(
      '  <entry>',
      `    <id>${xmlText(uri)}</id>`,
      `    <title>${xmlText(atomTitle(event))}</title>`,
      `    <updated>${new Date(event.created_at * 1000).toISOString()}</updated>`,
      `    <link rel="alternate" href="${xmlText(uri)}"/>`,
      `    <content type="text">${xmlText(event.content)}</content>`,
      '  </entry>',
    )
  }
  lines.push('</feed>', '')
  return lines.join('\n')
}

function articleTitle(ev: Event): string {
  return tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? 'untitled'
}

export function articleLink(ev: Event): string | null {
  const identifier = tagValue(ev, 'd')
  if (identifier === undefined) return null
  const naddr = nip19.naddrEncode({ kind: LONG_FORM_KIND, pubkey: ev.pubkey, identifier })
  return `/articles/${naddr}`
}

export function articlesMenuLines(articles: Event[]): MapLine[] {
  if (articles.length === 0) return [{ type: 'i', display: 'No articles found.' }]
  return articles.flatMap((ev) => {
    const link = articleLink(ev)
    if (link === null) return []
    return [
      {
        type: '0' as const,
        display: `${isoDate(ev.created_at)}  ${articleTitle(ev)}`,
        link,
      },
    ]
  })
}

export function articleText(ev: Event): string {
  const rows = [articleTitle(ev), `date: ${isoDate(ev.created_at)}`]
  const summary = tagValue(ev, 'summary')
  if (summary) rows.push('', ...wrap(summary))
  rows.push('', ev.content)
  return `${rows.join('\n')}\n`
}
