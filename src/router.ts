import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { parseBurrowmap } from './linemap.ts'
import { resolveMapLines, relayHints, info, type MenuItem } from './resolve.ts'
import type { HoleStore } from './fetch.ts'
import type { Route } from './selector.ts'
import {
  BURROW_KIND,
  NOTE_KIND,
  LONG_FORM_KIND,
  docPath,
  docTitle,
  docType,
  tagValue,
  firstLine,
  isoDate,
} from './protocol.ts'
import * as virtual from './virtual.ts'

// Protocol-neutral request resolution shared by the gopher and gemini
// frontends. Authored kind 31436 documents always win; virtual paths
// (profile, notes, articles) fill the gaps.

export type Content =
  | { kind: 'menu'; title: string; items: MenuItem[] }
  | { kind: 'text'; title: string; body: string }
  | { kind: 'error'; message: string }

export interface RouterOptions {
  virtual: boolean
}

type ContentRoute = Exclude<Route, { kind: 'welcome' }>

export async function resolveRoute(
  route: ContentRoute,
  store: HoleStore,
  opts: RouterOptions,
): Promise<Content> {
  if (route.kind === 'search') return search(route, store, opts)

  const ev = await store.doc(route.pubkey, route.path)
  if (ev) return rememberHints(contentFromDoc(ev, route.npub), store)

  // Single-item permalinks (a note or an article) resolve even when the
  // generated virtual hole is disabled, because burrowmap links and the
  // post-success link point straight at them; --no-virtual only turns off
  // the generated index pages (root, profile, notes, follows, followers).
  const m = virtual.matchVirtualPath(route.path)
  const isItem = m !== null && (m.kind === 'note' || m.kind === 'article')
  if (opts.virtual || isItem) {
    const v = await resolveVirtual(route, store)
    if (v) return v
  }
  return { kind: 'error', message: `no document at ${route.path} in ${short(route.npub)}` }
}

// A rendered link's relay hints cannot survive into the next gopher
// selector, so the store keeps them: following the link then reads the
// linked author from the relays their document named.
function rememberHints(content: Content, store: HoleStore): Content {
  if (content.kind !== 'menu') return content
  for (const [npub, relays] of relayHints(content.items)) {
    try {
      const decoded = nip19.decode(npub)
      if (decoded.type === 'npub') store.addRelayHints(decoded.data, relays)
    } catch {
      // an unresolvable npub simply carries no hint
    }
  }
  return content
}

function contentFromDoc(ev: Event, npub: string): Content {
  if (docType(ev) === '1') {
    return {
      kind: 'menu',
      title: docTitle(ev),
      items: resolveMapLines(parseBurrowmap(ev.content), npub),
    }
  }
  return { kind: 'text', title: docTitle(ev), body: ev.content }
}

async function resolveVirtual(
  route: Extract<ContentRoute, { kind: 'doc' }>,
  store: HoleStore,
): Promise<Content | null> {
  const m = virtual.matchVirtualPath(route.path)
  if (!m) return null
  switch (m.kind) {
    case 'root': {
      const profile = virtual.parseProfile(await store.profile(route.pubkey))
      return {
        kind: 'menu',
        title: virtual.displayName(profile, route.npub),
        items: resolveMapLines(virtual.virtualRootLines(profile, route.npub), route.npub),
      }
    }
    case 'profile': {
      const profile = virtual.parseProfile(await store.profile(route.pubkey))
      return { kind: 'text', title: 'Profile', body: virtual.profileText(profile, route.npub) }
    }
    case 'notes': {
      const notes = await store.notes(route.pubkey)
      return {
        kind: 'menu',
        title: 'Notes',
        items: resolveMapLines(virtual.notesMenuLines(notes), route.npub),
      }
    }
    case 'note': {
      const ev = await store.event(m.id)
      if (!ev || ev.pubkey !== route.pubkey || ev.kind !== NOTE_KIND) return null
      return { kind: 'text', title: 'Note', body: virtual.noteText(ev) }
    }
    case 'follows':
    case 'followers': {
      const pubkeys =
        m.kind === 'follows'
          ? await store.contacts(route.pubkey)
          : await store.followers(route.pubkey)
      const capped = pubkeys.slice(0, 200)
      const profiles = await store.profilesBatch(capped)
      const people = capped.map((pk) => {
        const npub = nip19.npubEncode(pk)
        const profile = virtual.parseProfile(profiles.get(pk) ?? null)
        return { npub, name: virtual.displayName(profile, npub), about: profile?.about }
      })
      people.sort((a, b) => a.name.localeCompare(b.name))
      const title = m.kind === 'follows' ? 'Follows' : 'Followers'
      const empty =
        m.kind === 'follows'
          ? 'No follows found (kind 3 empty or unreachable).'
          : 'No followers found on these relays.'
      const lines = virtual.peopleMenuLines(people, empty)
      const note =
        pubkeys.length > capped.length
          ? [{ type: 'i' as const, display: `(showing ${capped.length} of ${pubkeys.length})` }]
          : []
      return {
        kind: 'menu',
        title,
        items: resolveMapLines([...note, ...lines], route.npub),
      }
    }

    case 'articles': {
      const articles = await store.articles(route.pubkey)
      return {
        kind: 'menu',
        title: 'Articles',
        items: resolveMapLines(virtual.articlesMenuLines(articles), route.npub),
      }
    }
    case 'article': {
      const ev = await store.article(route.pubkey, m.d)
      if (!ev) return null
      return { kind: 'text', title: tagValue(ev, 'title') ?? m.d, body: virtual.articleText(ev) }
    }
  }
}

async function search(
  route: Extract<ContentRoute, { kind: 'search' }>,
  store: HoleStore,
  opts: RouterOptions,
): Promise<Content> {
  const q = route.query.toLowerCase()
  const items: MenuItem[] = []
  const seen = new Set<string>()
  const push = (type: string, display: string, path: string): void => {
    if (seen.has(path)) return
    seen.add(path)
    items.push({ type, display, target: { scheme: 'hole', npub: route.npub, path } })
  }
  const matches = (...texts: (string | undefined)[]): boolean =>
    texts.some((t) => t !== undefined && t.toLowerCase().includes(q))

  for (const ev of await store.hole(route.pubkey)) {
    if (matches(ev.content, docTitle(ev))) {
      push(docType(ev), `${docTitle(ev)} (${docPath(ev)})`, docPath(ev))
    }
  }

  if (opts.virtual) {
    for (const ev of await store.notes(route.pubkey)) {
      if (matches(ev.content)) {
        push('0', `${isoDate(ev.created_at)}  ${firstLine(ev.content)}`, `/notes/${ev.id}`)
      }
    }
    for (const ev of await store.articles(route.pubkey)) {
      if (matches(ev.content, tagValue(ev, 'title'), tagValue(ev, 'summary'))) {
        push(
          '0',
          `${isoDate(ev.created_at)}  ${tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? ''}`,
          `/articles/${tagValue(ev, 'd') ?? ''}`,
        )
      }
    }
  }

  for (const ev of await store.searchRelays(route.pubkey, route.query)) {
    if (ev.pubkey !== route.pubkey) continue
    if (ev.kind === BURROW_KIND) push(docType(ev), `${docTitle(ev)} (${docPath(ev)})`, docPath(ev))
    else if (ev.kind === NOTE_KIND && !ev.tags.some((t) => t[0] === 'e')) {
      push('0', `${isoDate(ev.created_at)}  ${firstLine(ev.content)}`, `/notes/${ev.id}`)
    } else if (ev.kind === LONG_FORM_KIND) {
      push(
        '0',
        `${isoDate(ev.created_at)}  ${tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? ''}`,
        `/articles/${tagValue(ev, 'd') ?? ''}`,
      )
    }
  }

  const title = `Results for "${route.query}" in ${short(route.npub)}`
  if (items.length === 0) items.push(info('Nothing found.'))
  return { kind: 'menu', title, items: items.slice(0, 50) }
}

function short(npub: string): string {
  return npub.length > 24 ? `${npub.slice(0, 16)}...` : npub
}
