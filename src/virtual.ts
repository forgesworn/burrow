import type { Event } from 'nostr-tools'
import type { MapLine } from './linemap.ts'
import { tagValue, isoDate, firstLine } from './protocol.ts'
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

export type VirtualPath =
  | { kind: 'root' }
  | { kind: 'profile' }
  | { kind: 'notes' }
  | { kind: 'note'; id: string }
  | { kind: 'articles' }
  | { kind: 'article'; d: string }
  | { kind: 'follows' }
  | { kind: 'followers' }

export function matchVirtualPath(path: string): VirtualPath | null {
  if (path === '/') return { kind: 'root' }
  if (path === '/profile.txt') return { kind: 'profile' }
  if (path === '/follows') return { kind: 'follows' }
  if (path === '/followers') return { kind: 'followers' }
  if (path === '/notes') return { kind: 'notes' }
  if (path.startsWith('/notes/')) {
    const id = path.slice('/notes/'.length)
    return /^[0-9a-f]{64}$/.test(id) ? { kind: 'note', id } : null
  }
  if (path === '/articles') return { kind: 'articles' }
  if (path.startsWith('/articles/')) return { kind: 'article', d: path.slice('/articles/'.length) }
  return null
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
    { type: 'i', display: 'a virtual burrow generated from Nostr events' },
    { type: 'i', display: '' },
  ]
  if (profile?.about) {
    for (const l of wrap(profile.about)) lines.push({ type: 'i', display: l })
    lines.push({ type: 'i', display: '' })
  }
  lines.push({ type: '0', display: 'Profile', link: '/profile.txt' })
  lines.push({ type: '1', display: 'Notes', link: '/notes' })
  lines.push({ type: '1', display: 'Articles (long-form)', link: '/articles' })
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
  return rows.join('\n') + '\n'
}

export function notesMenuLines(notes: Event[]): MapLine[] {
  if (notes.length === 0) return [{ type: 'i', display: 'No notes found.' }]
  return notes.map((ev) => ({
    type: '0' as const,
    display: `${isoDate(ev.created_at)}  ${firstLine(ev.content)}`,
    link: `/notes/${ev.id}`,
  }))
}

export function noteText(ev: Event): string {
  return [`date: ${isoDate(ev.created_at)}`, `id:   ${ev.id}`, '', ev.content].join('\n') + '\n'
}

function articleTitle(ev: Event): string {
  return tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? 'untitled'
}

export function articlesMenuLines(articles: Event[]): MapLine[] {
  if (articles.length === 0) return [{ type: 'i', display: 'No articles found.' }]
  return articles.map((ev) => ({
    type: '0' as const,
    display: `${isoDate(ev.created_at)}  ${articleTitle(ev)}`,
    link: `/articles/${tagValue(ev, 'd') ?? ''}`,
  }))
}

export function articleText(ev: Event): string {
  const rows = [articleTitle(ev), `date: ${isoDate(ev.created_at)}`]
  const summary = tagValue(ev, 'summary')
  if (summary) rows.push('', ...wrap(summary))
  rows.push('', ev.content)
  return rows.join('\n') + '\n'
}
