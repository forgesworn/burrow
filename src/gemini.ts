import tls from 'node:tls'
import { readFileSync } from 'node:fs'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from './selector.ts'
import { resolveRoute, type Content } from './router.ts'
import { renderGemtextMenu } from './gemtext.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { parseProfile, displayName } from './virtual.ts'

// Gemini frontend (RFC-less, gemini://): same holes, same router, gemtext
// out. `/<npub>/search` is a reserved input endpoint (status 10).

export interface GeminiContext {
  relays: string[]
  pins: string[]
  virtual: boolean
}

export interface GeminiOptions extends GeminiContext {
  certFile: string
  keyFile: string
  store?: HoleStore
  limiter?: RateLimiter
}

export function createGeminiServer(opts: GeminiOptions): tls.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  const limiter = opts.limiter ?? new RateLimiter()
  return tls.createServer(
    { cert: readFileSync(opts.certFile), key: readFileSync(opts.keyFile) },
    (socket) => {
      if (!limiter.allow(socket.remoteAddress ?? 'unknown')) {
        socket.end('44 slow down\r\n')
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
        respondGemini(line, opts, store)
          .catch(() => '40 internal error\r\n')
          .then((out) => socket.end(out))
      })
    },
  )
}

export async function respondGemini(
  line: string,
  ctx: GeminiContext,
  store: HoleStore,
): Promise<string> {
  let url: URL
  let rawPath: string
  let query: string
  try {
    url = new URL(line.trim())
    rawPath = decodeURIComponent(url.pathname)
    query = decodeURIComponent(url.search.replace(/^\?/, ''))
  } catch {
    return '59 bad request\r\n'
  }
  if (url.protocol !== 'gemini:') return '59 unsupported scheme\r\n'
  if (rawPath === '' || rawPath === '/') return welcomePage(ctx, store)

  const isSearch = rawPath.endsWith('/search')
  const basePath = isSearch ? rawPath.slice(0, -'/search'.length) || '/' : rawPath

  let route
  try {
    route = parseSelector(basePath)
  } catch (err) {
    return err instanceof SelectorError ? `51 ${err.message}\r\n` : '59 bad request\r\n'
  }
  if (route.kind === 'welcome') return welcomePage(ctx, store)
  if (route.kind === 'search') return '59 bad request\r\n'

  if (isSearch) {
    if (query === '') return '10 Search this hole\r\n'
    const content = await resolveRoute(
      { kind: 'search', pubkey: route.pubkey, npub: route.npub, path: '/', query },
      store,
      { virtual: ctx.virtual },
    )
    return toGemini(content)
  }

  const content = await resolveRoute(route, store, { virtual: ctx.virtual })
  return toGemini(content)
}

function toGemini(content: Content): string {
  switch (content.kind) {
    case 'menu':
      return `20 text/gemini; charset=utf-8\r\n${renderGemtextMenu(content.title, content.items)}`
    case 'text':
      return `20 text/plain; charset=utf-8\r\n${content.body}`
    case 'error':
      return `51 ${content.message}\r\n`
  }
}

async function welcomePage(ctx: GeminiContext, store: HoleStore): Promise<string> {
  const lines = [
    '# burrow',
    '',
    'Gopherholes served from Nostr relays. Every hole is a set of signed',
    'Nostr events (kind 31436); relays mirror it, any bridge serves it.',
    '',
    'Browse a hole at /<npub>. Any npub works: profiles, notes and',
    'long-form articles are served as a virtual hole even when nothing',
    'was ever published to gopherspace.',
    '',
    `Relays: ${ctx.relays.join(', ')}`,
  ]
  if (ctx.pins.length > 0) {
    lines.push('', '## Pinned holes', '')
    for (const npub of ctx.pins) {
      let name = `${npub.slice(0, 16)}...`
      try {
        const decoded = nip19.decode(npub)
        if (decoded.type === 'npub') {
          name = displayName(parseProfile(await store.profile(decoded.data)), npub)
        }
      } catch {
        // fall through with the shortened npub
      }
      lines.push(`=> /${npub} ${name}`)
    }
  }
  return `20 text/gemini; charset=utf-8\r\n${lines.join('\n')}\n`
}
