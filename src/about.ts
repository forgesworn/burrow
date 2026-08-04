import type { Content } from './router.ts'
import { info, type MenuItem } from './resolve.ts'

// The case for gopherholes on Nostr, served in the medium it argues for.
// One Content, rendered by every frontend: read it over gopher, gemini,
// http or in the terminal, and the argument demonstrates itself.

export const ABOUT_PATH = '/about'

export const PROJECT_REPO = 'https://github.com/forgesworn/gopherkind'
export const PROJECT_SPEC = 'https://github.com/forgesworn/gopherkind/blob/main/SPEC.md'
const PROJECT_SITE = 'https://forgesworn.github.io/gopherkind/'
const SUPPORT_KOFI = 'https://ko-fi.com/brays'
const SUPPORT_GEYSER = 'https://geyser.fund/project/forgesworn'
const AUTHOR_NPUB = 'npub1mgvlrnf5hm9yf0n5mf9nqmvarhvxkc6remu5ec3vf8r0txqkuk7su0e7q2'

// Which frontend the reader arrived on, so the page can say so. Purely
// cosmetic: the document is identical everywhere else.
export type AboutSurface = 'gopher' | 'gemini' | 'the web' | 'your terminal'

const PITCH = [
  'Gopherspace has one endemic disease: holes die.',
  '',
  'The hobby box behind your favourite phlog loses power, a domain',
  'lapses, a university closes an account, and fifteen years of',
  'writing are gone. RFC 1436 has no notion of an author, so nothing',
  'in the protocol survives the hostname. Even while a hole is up,',
  'nothing in the wire format can prove who wrote what.',
  '',
  'gopherkind moves the hole off the box. A document is a signed Nostr',
  'event, kind 31436, named for the RFC. It lives on whichever relays',
  'its author chose. Any bridge that can retrieve a copy serves it to',
  'any gopher client written since 1991.',
  '',
  'What that changes:',
  '',
  '  The hole belongs to an npub, not a hostname. Lose the machine',
  '  and another bridge serves the same signed events. That removes',
  '  one point of failure; it does not promise relays keep events',
  '  forever, and this project will not pretend otherwise.',
  '',
  '  Every document proves its author. A signature travels with the',
  '  text, so a copy served by a stranger is still verifiably yours.',
  '',
  '  Editing is replacement, not a new address. The path is the',
  "  event's d tag, so revising a page keeps every link alive.",
  '',
  '  Every npub is already a hole. Profile, notes, long-form articles,',
  '  follows and followers render as menus and text with nothing',
  '  published at all. Gopherspace quietly grows by the whole Nostr',
  '  userbase, and taking over your own hole is just publishing.',
  '',
  'The trade runs both ways. Nostr clients are timelines built for the',
  'scroll, and long writing is buried an hour after it is posted.',
  'Gopher is the opposite temperament: a reading room, where structure',
  'is mandatory and nothing on the page is competing for your',
  'attention. No trackers, no fonts, no cookie banner, no layout',
  'shift. Text, menus, and whatever renders them: lynx, VF-1,',
  'Lagrange, a terminal, an Amiga.',
  '',
  'Cameron Kaiser wrote that gopher divorces interface from',
  'information, and that gopher and the web should coexist. Add Nostr',
  'and all three read the same documents, while the writing outlives',
  'the box it was typed on.',
]

function surfaceNote(surface: AboutSurface): string[] {
  const where =
    surface === 'your terminal'
      ? 'You are reading this in your terminal.'
      : `You are reading this over ${surface}.`
  return ['', where, 'The same document is served on all four. That is the argument.']
}

export function aboutItems(surface: AboutSurface): MenuItem[] {
  const items: MenuItem[] = [...PITCH, ...surfaceNote(surface)].map(info)
  items.push(info(''))
  items.push(info('Start here'))
  items.push(info(''))
  items.push({
    type: '1',
    display: 'Open a hole: any npub works',
    target: { scheme: 'self', path: '/' },
  })
  items.push({
    type: '1',
    display: "The author's own hole",
    target: { scheme: 'hole', npub: AUTHOR_NPUB, path: '/' },
  })
  items.push({
    type: 'h',
    display: 'Source, docs and issues',
    target: { scheme: 'web', url: PROJECT_REPO },
  })
  items.push({
    type: 'h',
    display: 'The kind 31436 spec',
    target: { scheme: 'web', url: PROJECT_SPEC },
  })
  items.push({
    type: 'h',
    display: 'Project home page',
    target: { scheme: 'web', url: PROJECT_SITE },
  })
  items.push(info(''))
  items.push(info('Keeping it alive'))
  items.push(info(''))
  items.push(info('gopherkind is unfunded work: no company, no token, no ads,'))
  items.push(info("no custody of anyone's key, and nothing to sell you. It is"))
  items.push(info('paid for in evenings. If it earns a place in your week, the'))
  items.push(info('cheapest way to keep it going is to fund an evening of it.'))
  items.push(info(''))
  items.push(info(`Zap: ${AUTHOR_NPUB}`))
  items.push({
    type: 'h',
    display: 'Support the work (Ko-fi)',
    target: { scheme: 'web', url: SUPPORT_KOFI },
  })
  items.push({
    type: 'h',
    display: 'Support the work (Geyser, Lightning)',
    target: { scheme: 'web', url: SUPPORT_GEYSER },
  })
  return items
}

export function aboutContent(surface: AboutSurface): Content {
  return { kind: 'menu', title: 'Why gopher on Nostr', items: aboutItems(surface) }
}
