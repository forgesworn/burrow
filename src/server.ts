import net from 'node:net'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from './selector.ts'
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

export interface ServeOptions {
  relays: string[]
  // Advertised host/port written into menus; may differ from the bind address.
  bridge: BridgeAddr
  // npubs listed on the welcome menu.
  pins: string[]
  // Serve virtual holes (profile/notes/articles) for npubs without
  // authored documents. Defaults to on.
  virtual?: boolean
  store?: HoleStore
  limiter?: RateLimiter
}

export function createGopherServer(opts: ServeOptions): net.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  const limiter = opts.limiter ?? new RateLimiter()
  return net.createServer((socket) => {
    if (!limiter.allow(socket.remoteAddress ?? 'unknown')) {
      socket.end(renderError('rate limited, slow down'))
      return
    }
    socket.setTimeout(10_000, () => socket.destroy())
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
      respond(line, opts, store)
        .catch((err) => renderError(err instanceof Error ? err.message : 'internal error'))
        .then((out) => socket.end(out))
    })
  })
}

export async function respond(line: string, opts: ServeOptions, store: HoleStore): Promise<string> {
  let route
  try {
    route = parseSelector(line)
  } catch (err) {
    return renderError(err instanceof SelectorError ? err.message : 'bad selector')
  }
  if (route.kind === 'welcome') return welcome(opts, store)
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

async function welcome(opts: ServeOptions, store: HoleStore): Promise<string> {
  const { host, port } = opts.bridge
  let out = ''
  out += infoLine('burrow')
  out += infoLine('gopherholes served from Nostr relays')
  out += infoLine('')
  out += infoLine('Every hole here is a set of signed Nostr events (kind 31436).')
  out += infoLine('No hosting, no server to die: relays mirror the content.')
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
  return out + '.\r\n'
}
