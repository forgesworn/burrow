import readline from 'node:readline'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import * as nip19 from 'nostr-tools/nip19'
import { HoleStore } from './fetch.ts'
import type { Content } from './router.ts'
import { resolveRoute } from './router.ts'
import type { MenuItem, LinkTarget } from './resolve.ts'
import { info } from './resolve.ts'
import { browseGopher } from './gopherclient.ts'
import {
  parseClientTarget,
  resolveClientTarget,
  refOf,
  describeTarget,
  upOf,
  type ClientTarget,
  type GopherTarget,
} from './target.ts'
import { renderNumbered, pageLinks } from './cliview.ts'
import { BookmarkStore } from './bookmarks.ts'
import { PairingStore } from './identity.ts'
import { resolveSigner } from './signing.ts'
import { cmdPost, cmdWhoami, cmdPair, cmdUnpair } from './commands.ts'
import { parseProfile, displayName } from './virtual.ts'
import { firstLine, isoDate } from './protocol.ts'

// The interactive client: a line-mode browser in the VF-1 tradition that
// speaks both gopherspace and Nostr. Numbered links, back/up, bookmarks,
// your feed as a menu, and posting through your own signer. Session logic
// is pure and injectable; the readline loop at the bottom stays thin.

export type Location = ClientTarget | { kind: 'feed' } | { kind: 'home' }

export interface Page {
  location: Location
  content: Content
  links: MenuItem[]
}

export interface BrowseDeps {
  store: HoleStore
  pairings: PairingStore
  bookmarks: BookmarkStore
  relays: string[]
  virtual: boolean
  gopher?: (t: GopherTarget, query?: string) => Promise<Content>
}

export function describeLocation(loc: Location): string {
  if (loc.kind === 'feed') return 'feed'
  if (loc.kind === 'home') return 'home'
  return describeTarget(loc)
}

function linkTargetOf(target: ClientTarget): LinkTarget {
  if (target.kind === 'hole') return { scheme: 'hole', npub: target.npub, path: target.path }
  return {
    scheme: 'gopher',
    host: target.host,
    port: target.port,
    itemType: target.type,
    selector: target.selector,
  }
}

// A followed menu link becomes the next location. Web links are handled
// by the loop (printed, never fetched); none/invalid are not followable.
export function locationOfLink(t: LinkTarget): ClientTarget | null {
  if (t.scheme === 'hole') {
    return parseClientTarget(t.path === '/' ? t.npub : `${t.npub}${t.path}`)
  }
  if (t.scheme === 'gopher') {
    return { kind: 'gopher', host: t.host, port: t.port, type: t.itemType, selector: t.selector }
  }
  return null
}

const STARTERS: { display: string; ref: string; type: string }[] = [
  { display: 'Floodgap, the heart of gopherspace', ref: 'gopher://gopher.floodgap.com', type: '1' },
  {
    display: 'Why is gopher still relevant?',
    ref: 'gopher://gopher.floodgap.com/0/gopher/relevance.txt',
    type: '0',
  },
  {
    display: 'Veronica-2, search all of gopherspace',
    ref: 'gopher://gopher.floodgap.com/7/v2/vs',
    type: '7',
  },
]

export function homeContent(bookmarks: BookmarkStore): Content {
  const items: MenuItem[] = [info('a gopher client that speaks nostr'), info('')]
  const marks = bookmarks.list()
  if (marks.length > 0) {
    items.push(info('bookmarks:'))
    for (const mark of marks) {
      try {
        const target = parseClientTarget(mark.ref)
        const type = target.kind === 'gopher' ? target.type : '1'
        items.push({ type, display: mark.name, target: linkTargetOf(target) })
      } catch {
        items.push(info(`${mark.name} (unreadable bookmark)`))
      }
    }
    items.push(info(''))
  }
  items.push(info('somewhere to start:'))
  for (const s of STARTERS) {
    const target = parseClientTarget(s.ref)
    items.push({ type: s.type, display: s.display, target: linkTargetOf(target) })
  }
  items.push(info(''))
  items.push(info('go <npub, name@domain or gopher url> visits anywhere; help lists commands.'))
  return { kind: 'menu', title: 'burrow', items }
}

export async function feedContent(deps: BrowseDeps): Promise<Content> {
  let pubkey: string
  try {
    pubkey = await (await resolveSigner(deps.pairings)).pubkey()
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  const follows = await deps.store.contacts(pubkey)
  if (follows.length === 0) {
    return { kind: 'error', message: 'no follows found (kind 3 empty or unreachable)' }
  }
  const notes = await deps.store.feedNotes(follows.slice(0, 100))
  const profiles = await deps.store.profilesBatch(notes.map((n) => n.pubkey))
  const items: MenuItem[] = []
  for (const ev of notes) {
    const authorNpub = nip19.npubEncode(ev.pubkey)
    const name = displayName(parseProfile(profiles.get(ev.pubkey) ?? null), authorNpub)
    items.push({
      type: '0',
      display: `${isoDate(ev.created_at)}  ${name}: ${firstLine(ev.content, 56)}`,
      target: { scheme: 'hole', npub: authorNpub, path: `/notes/${ev.id}` },
    })
  }
  if (items.length === 0) items.push(info('nothing recent from your follows on these relays'))
  return { kind: 'menu', title: `feed (${follows.length} follows)`, items }
}

export async function fetchLocation(
  loc: Location,
  deps: BrowseDeps,
  query?: string,
): Promise<Content> {
  if (loc.kind === 'home') return homeContent(deps.bookmarks)
  if (loc.kind === 'feed') return feedContent(deps)
  if (loc.kind === 'gopher') {
    const fetcher = deps.gopher ?? browseGopher
    return fetcher(loc, query)
  }
  const route =
    query === undefined
      ? ({ kind: 'doc', pubkey: loc.pubkey, npub: loc.npub, path: loc.path } as const)
      : ({ kind: 'search', pubkey: loc.pubkey, npub: loc.npub, path: loc.path, query } as const)
  return resolveRoute(route, deps.store, { virtual: deps.virtual })
}

export class BrowseSession {
  private deps: BrowseDeps
  private stack: Page[] = []
  current: Page | null = null

  constructor(deps: BrowseDeps) {
    this.deps = deps
  }

  async visit(loc: Location, query?: string): Promise<Page> {
    const content = await fetchLocation(loc, this.deps, query)
    const page = { location: loc, content, links: pageLinks(content) }
    if (this.current !== null && content.kind !== 'error') this.stack.push(this.current)
    if (content.kind !== 'error') this.current = page
    return page
  }

  async reload(): Promise<Page | null> {
    if (this.current === null) return null
    const content = await fetchLocation(this.current.location, this.deps)
    this.current = { location: this.current.location, content, links: pageLinks(content) }
    return this.current
  }

  back(): Page | null {
    const prev = this.stack.pop()
    if (prev === undefined) return null
    this.current = prev
    return prev
  }

  up(): Location | null {
    if (this.current === null || this.current.location.kind === 'home') return null
    if (this.current.location.kind === 'feed') return { kind: 'home' }
    return upOf(this.current.location) ?? { kind: 'home' }
  }

  link(n: number): MenuItem | null {
    return this.current?.links[n - 1] ?? null
  }

  history(): string[] {
    return [...this.stack, ...(this.current ? [this.current] : [])].map((p) =>
      describeLocation(p.location),
    )
  }
}

export type BrowseCommand =
  | { cmd: 'follow'; n: number }
  | { cmd: 'go'; target: string }
  | { cmd: 'search'; query: string }
  | { cmd: 'post'; text: string }
  | { cmd: 'pair'; uri: string }
  | { cmd: 'unmark'; n: number }
  | { cmd: 'back' }
  | { cmd: 'up' }
  | { cmd: 'reload' }
  | { cmd: 'links' }
  | { cmd: 'feed' }
  | { cmd: 'home' }
  | { cmd: 'mark' }
  | { cmd: 'marks' }
  | { cmd: 'history' }
  | { cmd: 'whoami' }
  | { cmd: 'unpair' }
  | { cmd: 'help' }
  | { cmd: 'quit' }
  | { cmd: 'empty' }
  | { cmd: 'unknown'; word: string }

export function parseBrowseCommand(line: string): BrowseCommand {
  const trimmed = line.trim()
  if (trimmed === '') return { cmd: 'empty' }
  if (/^\d+$/.test(trimmed)) return { cmd: 'follow', n: Number(trimmed) }
  const [word, ...restParts] = trimmed.split(/\s+/)
  const rest = restParts.join(' ')
  switch ((word as string).toLowerCase()) {
    case 'go':
    case 'g':
      return rest === '' ? { cmd: 'unknown', word: 'go needs a target' } : { cmd: 'go', target: rest }
    case 'search':
    case 's':
      return rest === ''
        ? { cmd: 'unknown', word: 'search needs a query' }
        : { cmd: 'search', query: rest }
    case 'post':
    case 'p':
      return rest === '' ? { cmd: 'unknown', word: 'post needs text' } : { cmd: 'post', text: rest }
    case 'pair':
      return rest === ''
        ? { cmd: 'unknown', word: 'pair needs a bunker:// uri' }
        : { cmd: 'pair', uri: rest }
    case 'unmark':
      return /^\d+$/.test(rest)
        ? { cmd: 'unmark', n: Number(rest) }
        : { cmd: 'unknown', word: 'unmark needs a bookmark number' }
    case 'back':
    case 'b':
      return { cmd: 'back' }
    case 'up':
    case 'u':
      return { cmd: 'up' }
    case 'reload':
    case 'r':
      return { cmd: 'reload' }
    case 'links':
    case 'l':
      return { cmd: 'links' }
    case 'feed':
    case 'f':
      return { cmd: 'feed' }
    case 'home':
      return { cmd: 'home' }
    case 'mark':
      return { cmd: 'mark' }
    case 'marks':
    case 'm':
      return { cmd: 'marks' }
    case 'history':
    case 'hist':
      return { cmd: 'history' }
    case 'whoami':
      return { cmd: 'whoami' }
    case 'unpair':
      return { cmd: 'unpair' }
    case 'help':
    case '?':
      return { cmd: 'help' }
    case 'quit':
    case 'q':
    case 'exit':
      return { cmd: 'quit' }
    default:
      return { cmd: 'unknown', word: word as string }
  }
}

export const HELP = `commands:
  1, 2, ...          follow a numbered link ((?) links prompt for a query)
  go <target>        npub, nostr: entity, name@domain (NIP-05), gopher://
                     url or bare hostname
  back, up, reload   navigate; up climbs towards the root
  search <query>     search this hole (nostr) or this type 7 endpoint (gopher)
  feed               notes from who you follow, as a menu
  post <text>        sign and broadcast a kind 1 note
  mark / marks       bookmark this page / show bookmarks (unmark <n> removes)
  history            where you have been this session
  whoami, pair <bunker://...>, unpair
  home, help, quit
`

// Long output goes through $PAGER when it will not fit the terminal.
function pageOut(text: string): void {
  const rows = process.stdout.rows ?? 24
  if (!process.stdout.isTTY || text.split('\n').length < rows) {
    process.stdout.write(text)
    return
  }
  const pager = process.env['PAGER'] ?? 'less'
  const result = spawnSync(pager, { input: text, stdio: ['pipe', 'inherit', 'inherit'], shell: true })
  if (result.error) process.stdout.write(text)
}

export interface BrowseOptions {
  relays: string[]
  pairings: PairingStore
  bookmarks: BookmarkStore
  virtual: boolean
}

export async function runBrowse(initial: string | undefined, opts: BrowseOptions): Promise<void> {
  const store = new HoleStore(opts.relays)
  const deps: BrowseDeps = {
    store,
    pairings: opts.pairings,
    bookmarks: opts.bookmarks,
    relays: opts.relays,
    virtual: opts.virtual,
  }
  const session = new BrowseSession(deps)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  // Lines can arrive while a fetch is in flight (piped input delivers
  // everything at once); queue them instead of letting readline drop them.
  const queued: string[] = []
  let waiter: ((line: string | null) => void) | null = null
  let closed = false
  rl.on('line', (line) => {
    if (waiter !== null) {
      const w = waiter
      waiter = null
      w(line)
    } else {
      queued.push(line)
    }
  })
  rl.on('close', () => {
    closed = true
    if (waiter !== null) {
      const w = waiter
      waiter = null
      w(null)
    }
  })
  rl.on('SIGINT', () => rl.close())

  const ask = (prompt: string): Promise<string | null> => {
    const buffered = queued.shift()
    if (buffered !== undefined) return Promise.resolve(buffered)
    if (closed) return Promise.resolve(null)
    rl.setPrompt(prompt)
    rl.prompt()
    return new Promise((resolve) => {
      waiter = resolve
    })
  }

  const show = async (loc: Location, query?: string): Promise<void> => {
    const page = await session.visit(loc, query)
    pageOut(renderNumbered(page.content))
  }

  const follow = async (item: MenuItem): Promise<void> => {
    if (item.target.scheme === 'web') {
      process.stdout.write(`web link: ${item.target.url}\n`)
      return
    }
    const loc = locationOfLink(item.target)
    if (loc === null) return
    if (item.type === '7') {
      const q = await ask('search for: ')
      if (q === null || q.trim() === '') return
      await show(loc, q.trim())
      return
    }
    await show(loc)
  }

  let startLoc: Location = { kind: 'home' }
  if (initial !== undefined) {
    try {
      startLoc = await resolveClientTarget(initial)
    } catch (err) {
      process.stdout.write(`${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
  await show(startLoc)

  for (;;) {
    const where = session.current ? describeLocation(session.current.location) : 'burrow'
    const line = await ask(`${where}> `)
    if (line === null) break
    const command = parseBrowseCommand(line)
    try {
      switch (command.cmd) {
        case 'empty':
          break
        case 'follow': {
          const item = session.link(command.n)
          if (item === null) process.stdout.write(`no link [${command.n}] on this page\n`)
          else await follow(item)
          break
        }
        case 'go':
          await show(await resolveClientTarget(command.target))
          break
        case 'back': {
          const prev = session.back()
          if (prev === null) process.stdout.write('start of history\n')
          else pageOut(renderNumbered(prev.content))
          break
        }
        case 'up': {
          const target = session.up()
          if (target === null) process.stdout.write('already at the top\n')
          else await show(target)
          break
        }
        case 'reload': {
          const page = await session.reload()
          if (page !== null) pageOut(renderNumbered(page.content))
          break
        }
        case 'links': {
          if (session.current !== null) pageOut(renderNumbered(session.current.content))
          break
        }
        case 'search': {
          const loc = session.current?.location
          if (loc === undefined || loc.kind === 'feed' || loc.kind === 'home') {
            process.stdout.write('nothing searchable here; go somewhere first\n')
          } else if (loc.kind === 'gopher' && loc.type !== '7') {
            const searchLink = session.current?.links.find((l) => l.type === '7')
            const searchLoc = searchLink ? locationOfLink(searchLink.target) : null
            if (searchLoc !== null) await show(searchLoc, command.query)
            else process.stdout.write('this gopher menu has no search endpoint (type 7)\n')
            break
          } else {
            await show(loc, command.query)
          }
          break
        }
        case 'feed':
          await show({ kind: 'feed' })
          break
        case 'home':
        case 'marks':
          await show({ kind: 'home' })
          break
        case 'mark': {
          const loc = session.current?.location
          if (loc === undefined || loc.kind === 'feed' || loc.kind === 'home') {
            process.stdout.write('nothing to bookmark here\n')
          } else {
            const title =
              session.current?.content.kind === 'menu' || session.current?.content.kind === 'text'
                ? session.current.content.title
                : describeLocation(loc)
            const added = deps.bookmarks.add(title, refOf(loc))
            process.stdout.write(added ? `marked: ${title}\n` : 'already bookmarked\n')
          }
          break
        }
        case 'unmark': {
          const removed = deps.bookmarks.remove(command.n)
          process.stdout.write(removed ? `unmarked: ${removed.name}\n` : 'no such bookmark\n')
          break
        }
        case 'history':
          process.stdout.write(session.history().map((h) => `  ${h}`).join('\n') + '\n')
          break
        case 'post':
          process.stdout.write(await cmdPost(command.text, opts.relays, opts.pairings, false))
          break
        case 'whoami':
          process.stdout.write(await cmdWhoami(opts.relays, opts.pairings))
          break
        case 'pair':
          process.stdout.write(await cmdPair(command.uri, opts.pairings))
          break
        case 'unpair':
          process.stdout.write(cmdUnpair(opts.pairings))
          break
        case 'help':
          process.stdout.write(HELP)
          break
        case 'quit':
          rl.close()
          break
        case 'unknown':
          process.stdout.write(`${command.word}; try help\n`)
          break
      }
    } catch (err) {
      process.stdout.write(`error: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
  rl.close()
  store.close()
}
