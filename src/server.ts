import net from 'node:net'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError, type Route } from './selector.ts'
import {
  renderMenuItems,
  renderText,
  renderError,
  gopherLine,
  infoLine,
  type BridgeAddr,
} from './render.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { resolveRoute, type Content } from './router.ts'
import { parseProfile, displayName } from './virtual.ts'
import { matchPersonal, resolvePersonal, PERSONAL_ROOT } from './personal.ts'
import { aboutContent, ABOUT_PATH } from './about.ts'
import type { CliSigner } from './signing.ts'

export interface ServeOptions {
  relays: string[]
  // Advertised host/port written into menus; may differ from the bind address.
  bridge: BridgeAddr
  // npubs listed on the welcome menu.
  pins: string[]
  // An npub whose hole root replaces the generic welcome menu.
  home?: string
  // Serve virtual holes (profile/notes/articles) for npubs without
  // authored documents. Defaults to on.
  virtual?: boolean
  // Personal menu (/me) for loopback requests only. Gopher is plaintext
  // and unauthenticated, so this never applies to a remote client.
  signerFactory?: () => Promise<CliSigner>
  localTrust?: boolean
  store?: HoleStore
  limiter?: RateLimiter
}

function isLoopback(addr: string | undefined): boolean {
  if (addr === undefined) return false
  const bare = addr.replace(/^::ffff:/, '')
  return bare === '::1' || bare === '127.0.0.1' || /^127\./.test(bare)
}

export function createGopherServer(opts: ServeOptions): net.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  const limiter = opts.limiter ?? new RateLimiter()
  return net.createServer((socket) => {
    if (!limiter.allow(socket.remoteAddress ?? 'unknown')) {
      socket.end(renderError('rate limited, slow down'))
      return
    }
    const local = isLoopback(socket.remoteAddress)
    socket.setTimeout(10_000, () => socket.destroy())
    // Absolute deadline so a slow drip of bytes cannot hold a connection open
    // indefinitely past the idle timeout.
    const deadline = setTimeout(() => socket.destroy(), 15_000)
    socket.on('close', () => clearTimeout(deadline))
    socket.on('error', () => socket.destroy())
    let buf = ''
    let handled = false
    socket.on('data', (chunk) => {
      if (handled) return
      buf += chunk.toString('utf8')
      if (buf.length > 2048) {
        socket.destroy()
        return
      }
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      handled = true
      const line = buf.slice(0, nl).replace(/\r$/, '')
      respond(line, opts, store, local)
        .catch((err) => renderError(err instanceof Error ? err.message : 'internal error'))
        .then((out) => socket.end(out))
    })
  })
}

export async function respond(
  line: string,
  opts: ServeOptions,
  store: HoleStore,
  local = false,
): Promise<string> {
  const [rawPath = '', rawQuery = ''] = line.split('\t')
  const personalAllowed = local && opts.localTrust !== false && opts.signerFactory !== undefined
  const personal = matchPersonal(rawPath.trim(), rawQuery)
  if (personal) {
    if (!personalAllowed) {
      return renderError(
        local
          ? 'no signer configured for the personal menu'
          : 'the personal menu is local-only (gopher has no authentication)',
      )
    }
    try {
      const signer = await opts.signerFactory!()
      const content = await resolvePersonal(personal, store, signer, opts.relays.length)
      return toGopher(content, opts.bridge, true)
    } catch (err) {
      return renderError(err instanceof Error ? err.message : 'personal menu failed')
    }
  }

  // Banner on: a gopher menu has nowhere else to carry the page title.
  if (rawPath.trim() === ABOUT_PATH) {
    return toGopher(aboutContent('gopher'), opts.bridge, true)
  }

  let route: Route
  try {
    route = parseSelector(line)
  } catch (err) {
    return renderError(err instanceof SelectorError ? err.message : 'bad selector')
  }
  if (route.kind === 'welcome') return welcome(opts, store, personalAllowed)
  const content = await resolveRoute(route, store, { virtual: opts.virtual !== false })
  return toGopher(content, opts.bridge, route.kind === 'search')
}

function toGopher(content: Content, bridge: BridgeAddr, banner: boolean): string {
  switch (content.kind) {
    case 'menu':
      return (
        (banner ? infoLine(content.title) + infoLine('') : '') +
        renderMenuItems(content.items, bridge)
      )
    case 'text':
      return renderText(content.body)
    case 'error':
      return renderError(content.message)
  }
}

// A bridge with a home hole leads with that hole's own root menu rather than a
// generic greeting, so the front door is content instead of an explanation of
// what a front door is. The ways out stay one line below it, and an
// unreachable home falls back to the generic menu rather than an error page:
// the bridge is still useful when one author's relays are down.
async function homeMenu(opts: ServeOptions, store: HoleStore): Promise<string | null> {
  if (opts.home === undefined) return null
  let route: Route
  try {
    route = parseSelector(`/${opts.home}`)
  } catch {
    return null
  }
  if (route.kind !== 'doc') return null
  const content = await resolveRoute(route, store, { virtual: opts.virtual !== false })
  if (content.kind !== 'menu') return null
  const { host, port } = opts.bridge
  let out = renderMenuItems(content.items, opts.bridge).replace(/\.\r\n$/, '')
  out += infoLine('')
  out += infoLine('--')
  out += gopherLine('1', 'Why gopher on Nostr', ABOUT_PATH, host, port)
  out += infoLine('')
  out += infoLine('Any npub is a hole on this bridge. Browse one by selector:')
  out += infoLine('  /<npub>')
  return out
}

async function welcome(
  opts: ServeOptions,
  store: HoleStore,
  personalAllowed = false,
): Promise<string> {
  const { host, port } = opts.bridge
  const home = await homeMenu(opts, store)
  if (home !== null) {
    let out = home
    if (personalAllowed) {
      out += infoLine('')
      out += gopherLine('1', 'You: feed, follows, post, delete', PERSONAL_ROOT, host, port)
    }
    return `${out}.\r\n`
  }
  let out = ''
  out += infoLine('gopherkind')
  out += infoLine('gopherholes served from Nostr relays')
  out += infoLine('')
  if (personalAllowed) {
    out += gopherLine('1', 'You: feed, follows, post, delete', PERSONAL_ROOT, host, port)
    out += infoLine('')
  }
  out += infoLine('Every hole here is a set of signed Nostr events (kind 31436).')
  out += infoLine('No single host owns the hole; it is readable while relays retain copies.')
  out += infoLine('')
  out += gopherLine('1', 'Why gopher on Nostr', ABOUT_PATH, host, port)
  out += infoLine('')
  out += infoLine('Browse a hole by selector:  /<npub>')
  out += infoLine('Any npub works: profiles, notes and long-form articles are')
  out += infoLine('served as a virtual hole even without authored documents.')
  out += infoLine('')
  out += infoLine(`Relays: ${opts.relays.join(', ')}`)
  if (opts.pins.length > 0) {
    out += infoLine('')
    out += infoLine('Pinned holes:')
    for (const npub of opts.pins) {
      let name = `${npub.slice(0, 16)}...`
      try {
        const decoded = nip19.decode(npub)
        if (decoded.type === 'npub') {
          name = displayName(parseProfile(await store.profile(decoded.data)), npub)
        }
      } catch {
        // fall through with the shortened npub
      }
      out += gopherLine('1', name, `/${npub}`, host, port)
    }
  }
  return `${out}.\r\n`
}
