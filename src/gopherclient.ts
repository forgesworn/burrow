import net from 'node:net'
import type { Content } from './router.ts'
import type { MenuItem } from './resolve.ts'
import { info, isSafeWebUrl } from './resolve.ts'
import {
  holeFromSelector,
  parseClientTarget,
  parseProxyPath,
  proxyPath,
  type GopherTarget,
} from './target.ts'

// A real gopher client, so gopherkind can browse traditional gopherspace and
// render it through any frontend. Menus from remote holes become the same
// MenuItem list gopherkind uses everywhere, with links pointing back through
// the proxy so navigation stays inside whichever client you are using.

export { parseProxyPath, proxyPath, type GopherTarget }

export function fetchGopher(
  target: GopherTarget,
  query?: string,
  connectHost?: string,
  timeoutMs = 10_000,
  maxBytes = 512 * 1024,
): Promise<string> {
  const request = query === undefined ? target.selector : `${target.selector}\t${query}`
  return new Promise((resolve, reject) => {
    // A CR, LF or NUL in the request line lets a caller inject additional
    // commands into newline-delimited services (Redis, memcached, ...): the
    // classic gopher SSRF payload. Refuse it before opening the socket.
    if (/[\r\n\0]/.test(request)) {
      reject(new Error('bad selector'))
      return
    }
    const chunks: Buffer[] = []
    let total = 0
    const socket = net.connect(target.port, connectHost ?? target.host, () => {
      socket.write(`${request}\r\n`)
    })
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new Error(`${target.host}:${target.port} timed out`))
    })
    socket.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        socket.destroy()
        resolve(Buffer.concat(chunks).toString('utf8'))
        return
      }
      chunks.push(chunk)
    })
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('error', (err: Error) => reject(new Error(`${target.host}: ${err.message}`)))
  })
}

// A traditional gophermap can still point into Nostr: an h-line with a
// nostr: URL, or a selector into a gopherkind bridge (leading npub). Both
// become native hole links, so every surface follows them through your
// own relays rather than someone else's bridge.
function nostrAware(item: MenuItem): MenuItem {
  const t = item.target
  if (t.scheme === 'web' && t.url.startsWith('nostr:')) {
    try {
      const native = parseClientTarget(t.url)
      if (native.kind === 'hole') {
        return { ...item, target: { scheme: 'hole', npub: native.npub, path: native.path } }
      }
    } catch {
      // not decodable; leave it as an inert web link
    }
  }
  if (t.scheme === 'gopher') {
    const native = holeFromSelector(t.selector)
    if (native && native.kind === 'hole') {
      return { ...item, target: { scheme: 'hole', npub: native.npub, path: native.path } }
    }
  }
  return item
}

// Parse a served gophermap: type + display TAB selector TAB host TAB port.
export function parseGopherMenu(body: string): MenuItem[] {
  const items: MenuItem[] = []
  for (const raw of body.split(/\r?\n/)) {
    if (raw === '.') break
    if (raw === '') continue
    const type = raw.slice(0, 1)
    const fields = raw.slice(1).split('\t')
    const display = fields[0] ?? ''
    const selector = fields[1] ?? ''
    const host = fields[2] ?? ''
    const port = Number(fields[3] ?? '70') || 70
    if (type === 'i' || type === '3' || host === '' || host === 'error.host') {
      items.push(info(display))
      continue
    }
    if (type === 'h' && selector.startsWith('URL:')) {
      const url = selector.slice(4)
      if (isSafeWebUrl(url)) {
        items.push(nostrAware({ type: 'h', display, target: { scheme: 'web', url } }))
      } else {
        // javascript:/data:/file: etc. from a hostile server: keep the text,
        // drop the link.
        items.push(info(display))
      }
      continue
    }
    items.push(
      nostrAware({
        type,
        display,
        target: { scheme: 'gopher', host, port, itemType: type, selector },
      }),
    )
  }
  return items
}

// The address this target names in gopherspace. Shared by the page heading and
// the proxy's "read it directly" note so the two cannot drift apart.
export function gopherUrl(target: GopherTarget): string {
  const sel =
    target.selector === '' || target.selector.startsWith('/')
      ? target.selector
      : `/${target.selector}`
  return `gopher://${target.host}${target.port === 70 ? '' : `:${target.port}`}/${target.type}${sel}`
}

export async function browseGopher(
  target: GopherTarget,
  query?: string,
  connectHost?: string,
): Promise<Content> {
  let body: string
  try {
    body = await fetchGopher(target, query, connectHost)
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'gopher fetch failed' }
  }
  const title = gopherUrl(target)
  if (target.type === '1' || target.type === '7') {
    return { kind: 'menu', title, items: parseGopherMenu(body) }
  }
  // Text: strip the trailing dot line and undo dot-stuffing.
  const lines = body.split(/\r?\n/)
  const end = lines.indexOf('.')
  const text = (end === -1 ? lines : lines.slice(0, end))
    .map((l) => (l.startsWith('..') ? l.slice(1) : l))
    .join('\n')
  return { kind: 'text', title, body: text }
}
