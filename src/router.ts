import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { parseKindmap } from './linemap.ts'
import { resolveMapLines, relayHints, info, type MenuItem } from './resolve.ts'
import type { HoleStore, ThreadView } from './fetch.ts'
import type { Route } from './selector.ts'
import {
  DOC_KIND,
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
  | { kind: 'text'; title: string; body: string; mediaType?: string }
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
  // generated virtual hole is disabled, because kindmap links and the
  // post-success link point straight at them; --no-virtual only turns off
  // the generated index pages (root, profile, notes, follows, followers).
  const m = virtual.matchVirtualPath(route.path)
  const isItem = m !== null && (m.kind === 'note' || m.kind === 'article' || m.kind === 'thread')
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
      items: resolveMapLines(parseKindmap(ev.content), npub),
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
      const notes = await store.notes(route.pubkey, m.before)
      const cursor = notes.length === virtual.PAGE ? virtual.eventCursor(notes.at(-1)) : null
      return {
        kind: 'menu',
        title: m.before === undefined ? 'Notes' : 'Notes (older)',
        items: resolveMapLines(
          [
            ...virtual.notesMenuLines(notes),
            ...virtual.pageLines('/notes', cursor, m.before !== undefined),
          ],
          route.npub,
        ),
      }
    }
    case 'note': {
      const ev = await store.note(route.pubkey, m.id)
      if (!ev) return null
      return { kind: 'text', title: 'Note', body: virtual.noteText(ev) }
    }
    case 'replies':
    case 'mentions': {
      const events =
        m.kind === 'replies'
          ? await store.replies(route.pubkey, m.before)
          : await store.mentions(route.pubkey, m.before)
      const profiles = await store.profilesBatch(events.map((event) => event.pubkey))
      const cursor = events.length === virtual.PAGE ? virtual.eventCursor(events.at(-1)) : null
      const base = m.kind === 'replies' ? '/replies' : '/mentions'
      const title = `${m.kind === 'replies' ? 'Replies' : 'Mentions'}${m.before ? ' (older)' : ''}`
      return {
        kind: 'menu',
        title,
        items: [
          ...interactionItems(events, profiles, m.kind),
          ...resolveMapLines(virtual.pageLines(base, cursor, m.before !== undefined), route.npub),
        ],
      }
    }
    case 'thread': {
      const thread = await store.thread(route.pubkey, m.id)
      if (thread === null) return null
      const events = [thread.focus, ...thread.ancestors, ...thread.replies]
      const profiles = await store.profilesBatch(events.map((event) => event.pubkey))
      return { kind: 'menu', title: 'Thread', items: threadItems(thread, profiles) }
    }
    case 'feed': {
      const [profileEvent, notes, articles] = await Promise.all([
        store.profile(route.pubkey),
        store.notes(route.pubkey),
        store.articles(route.pubkey),
      ])
      const profile = virtual.parseProfile(profileEvent)
      return {
        kind: 'text',
        title: `${virtual.displayName(profile, route.npub)} Atom feed`,
        body: virtual.atomFeed(profile, route.npub, notes, articles),
        mediaType: 'application/atom+xml; charset=utf-8',
      }
    }
    case 'follows':
    case 'followers': {
      const pubkeys =
        m.kind === 'follows'
          ? await store.contacts(route.pubkey)
          : await store.followers(route.pubkey)
      // Resolve and sort the complete snapshot before applying the offset.
      // Slicing first makes page membership depend on relay return order.
      const profiles = await store.profilesBatch(pubkeys)
      const people = pubkeys.map((pk) => {
        const npub = nip19.npubEncode(pk)
        const profile = virtual.parseProfile(profiles.get(pk) ?? null)
        return { npub, name: virtual.displayName(profile, npub), about: profile?.about }
      })
      people.sort((a, b) => a.name.localeCompare(b.name) || a.npub.localeCompare(b.npub))
      const from = Math.min(m.from ?? 0, Math.max(people.length - 1, 0))
      const page = people.slice(from, from + virtual.PEOPLE_PAGE)
      const title = m.kind === 'follows' ? 'Follows' : 'Followers'
      const empty =
        m.kind === 'follows'
          ? 'No follows found (kind 3 empty or unreachable).'
          : 'No followers found on these relays.'
      const base = m.kind === 'follows' ? '/follows' : '/followers'
      const lines = virtual.peopleMenuLines(page, empty)
      return {
        kind: 'menu',
        title,
        items: resolveMapLines(
          [...lines, ...virtual.offsetLines(base, people.length, from, page.length)],
          route.npub,
        ),
      }
    }

    case 'articles': {
      const articles = await store.articles(route.pubkey, m.before)
      const cursor = articles.length === virtual.PAGE ? virtual.eventCursor(articles.at(-1)) : null
      return {
        kind: 'menu',
        title: m.before === undefined ? 'Articles' : 'Articles (older)',
        items: resolveMapLines(
          [
            ...virtual.articlesMenuLines(articles),
            ...virtual.pageLines('/articles', cursor, m.before !== undefined),
          ],
          route.npub,
        ),
      }
    }
    case 'article': {
      if (m.pubkey !== route.pubkey) return null
      const ev = await store.article(route.pubkey, m.d)
      if (!ev) return null
      return { kind: 'text', title: tagValue(ev, 'title') ?? m.d, body: virtual.articleText(ev) }
    }
  }
}

function eventAuthor(event: Event, profiles: Map<string, Event>): { npub: string; name: string } {
  const npub = nip19.npubEncode(event.pubkey)
  const profile = virtual.parseProfile(profiles.get(event.pubkey) ?? null)
  return { npub, name: virtual.displayName(profile, npub) }
}

function interactionItems(
  events: Event[],
  profiles: Map<string, Event>,
  kind: 'replies' | 'mentions',
): MenuItem[] {
  if (events.length === 0) return [info(`No ${kind} found on these relays.`)]
  return events.map((event) => {
    const author = eventAuthor(event, profiles)
    return {
      type: '1',
      display: `${isoDate(event.created_at)}  ${author.name}: ${firstLine(event.content)}`,
      target: { scheme: 'hole', npub: author.npub, path: `/threads/${event.id}` },
    }
  })
}

function threadItems(thread: ThreadView, profiles: Map<string, Event>): MenuItem[] {
  const items: MenuItem[] = []
  const addEvent = (label: string, event: Event, plain = false): void => {
    const author = eventAuthor(event, profiles)
    items.push(info(label))
    items.push(info(`${isoDate(event.created_at)}  ${author.name}`))
    for (const line of virtual.wrap(event.content)) items.push(info(`  ${line}`))
    items.push({
      type: plain ? '0' : '1',
      display: plain ? 'Plain note' : 'Open this part of the thread',
      target: {
        scheme: 'hole',
        npub: author.npub,
        path: plain ? `/notes/${event.id}` : `/threads/${event.id}`,
      },
    })
    items.push(info(''))
  }
  for (const event of thread.ancestors) addEvent('Earlier', event)
  addEvent('Focused note', thread.focus, true)
  for (const event of thread.replies) addEvent('Reply', event)
  if (thread.replies.length === 0) items.push(info('No replies found on these relays.'))
  return items
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
    texts.some((t) => t?.toLowerCase().includes(q))

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
        const path = virtual.articleLink(ev)
        if (path === null) continue
        push(
          '0',
          `${isoDate(ev.created_at)}  ${tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? ''}`,
          path,
        )
      }
    }
  }

  for (const ev of await store.searchRelays(route.pubkey, route.query)) {
    if (ev.pubkey !== route.pubkey) continue
    if (ev.kind === DOC_KIND) push(docType(ev), `${docTitle(ev)} (${docPath(ev)})`, docPath(ev))
    else if (ev.kind === NOTE_KIND && !ev.tags.some((t) => t[0] === 'e')) {
      push('0', `${isoDate(ev.created_at)}  ${firstLine(ev.content)}`, `/notes/${ev.id}`)
    } else if (ev.kind === LONG_FORM_KIND) {
      const path = virtual.articleLink(ev)
      if (path === null) continue
      push(
        '0',
        `${isoDate(ev.created_at)}  ${tagValue(ev, 'title') ?? tagValue(ev, 'd') ?? ''}`,
        path,
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
