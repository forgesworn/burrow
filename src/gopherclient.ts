import net from 'node:net'
import type { Content } from './router.ts'
import type { MenuItem } from './resolve.ts'
import { info } from './resolve.ts'

// A real gopher client, so burrow can browse traditional gopherspace and
// render it through any frontend. Menus from remote holes become the same
// MenuItem list burrow uses everywhere, with links pointing back through
// the proxy so navigation stays inside whichever client you are using.

export interface GopherTarget {
  host: string
  port: number
  type: string
  selector: string
}

export function parseProxyPath(path: string): GopherTarget | null {
  // /gopher/<host>[:port]/<type>/<selector...>
  const m = /^\/gopher\/([^/]+)(?:\/([0-9a-zA-Z+]))?(?:\/(.*))?$/.exec(path)
  if (!m) return null
  const hostPart = m[1] as string
  const [host, portRaw] = hostPart.split(':')
  if (!host) return null
  const port = portRaw ? Number(portRaw) : 70
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port, type: m[2] ?? '1', selector: m[3] ?? '' }
}

export function proxyPath(t: GopherTarget): string {
  const hostPart = t.port === 70 ? t.host : `${t.host}:${t.port}`
  const selector = t.selector.replace(/^\//, '')
  return `/gopher/${hostPart}/${t.type}${selector ? `/${selector}` : ''}`
}

export function fetchGopher(
  target: GopherTarget,
  timeoutMs = 10_000,
  maxBytes = 512 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    const socket = net.connect(target.port, target.host, () => {
      socket.write(`${target.selector}\r\n`)
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
      items.push({ type: 'h', display, target: { scheme: 'web', url: selector.slice(4) } })
      continue
    }
    items.push({
      type,
      display,
      target: { scheme: 'gopher', host, port, itemType: type, selector },
    })
  }
  return items
}

export async function browseGopher(target: GopherTarget): Promise<Content> {
  let body: string
  try {
    body = await fetchGopher(target)
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'gopher fetch failed' }
  }
  const sel = target.selector === '' || target.selector.startsWith('/')
    ? target.selector
    : `/${target.selector}`
  const title = `gopher://${target.host}${target.port === 70 ? '' : `:${target.port}`}/${target.type}${sel}`
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
