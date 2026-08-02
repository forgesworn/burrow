import net from 'node:net'
import { parseSelector, SelectorError } from './selector.ts'
import { parseBurrowmap } from './linemap.ts'
import {
  renderMenu,
  renderText,
  renderError,
  gopherLine,
  infoLine,
  type BridgeAddr,
} from './render.ts'
import { HoleStore } from './fetch.ts'
import { docType, docTitle, docPath } from './protocol.ts'

export interface ServeOptions {
  relays: string[]
  // Advertised host/port written into menus; may differ from the bind address.
  bridge: BridgeAddr
  // npubs listed on the welcome menu.
  pins: string[]
  store?: HoleStore
}

export function createGopherServer(opts: ServeOptions): net.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  return net.createServer((socket) => {
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

  if (route.kind === 'welcome') return welcome(opts)

  if (route.kind === 'search') {
    const docs = await store.hole(route.pubkey)
    const q = route.query.toLowerCase()
    const hits = docs.filter(
      (ev) => ev.content.toLowerCase().includes(q) || docTitle(ev).toLowerCase().includes(q),
    )
    let out = infoLine(`Results for "${route.query}" in ${short(route.npub)}`) + infoLine('')
    for (const ev of hits) {
      const path = docPath(ev)
      out += gopherLine(
        docType(ev),
        `${docTitle(ev)} (${path})`,
        `/${route.npub}${path === '/' ? '' : path}`,
        opts.bridge.host,
        opts.bridge.port,
      )
    }
    if (hits.length === 0) out += infoLine('Nothing found.')
    return out + '.\r\n'
  }

  const ev = await store.doc(route.pubkey, route.path)
  if (!ev) return renderError(`no document at ${route.path} in ${short(route.npub)}`)
  return docType(ev) === '1'
    ? renderMenu(parseBurrowmap(ev.content), route.npub, opts.bridge)
    : renderText(ev.content)
}

function welcome(opts: ServeOptions): string {
  const { host, port } = opts.bridge
  let out = ''
  out += infoLine('burrow')
  out += infoLine('gopherholes served from Nostr relays')
  out += infoLine('')
  out += infoLine('Every hole here is a set of signed Nostr events (kind 31436).')
  out += infoLine('No hosting, no server to die: relays mirror the content.')
  out += infoLine('')
  out += infoLine('Browse a hole by selector:  /<npub>')
  out += infoLine(`e.g. gopher://${host}:${port}/1/npub1...`)
  out += infoLine('')
  out += infoLine(`Relays: ${opts.relays.join(', ')}`)
  if (opts.pins.length > 0) {
    out += infoLine('')
    out += infoLine('Pinned holes:')
    for (const npub of opts.pins) {
      out += gopherLine('1', short(npub), `/${npub}`, host, port)
    }
  }
  return out + '.\r\n'
}

function short(npub: string): string {
  return npub.length > 24 ? `${npub.slice(0, 16)}...` : npub
}
