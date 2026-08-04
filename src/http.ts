import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError, type Route } from './selector.ts'
import { robotsTxt } from './robots.ts'
import { resolveRoute, type Content } from './router.ts'
import { page, renderMenuHtml, renderContentHtml, esc } from './html.ts'
import { parseProxyPath, proxyPath, browseGopher } from './gopherclient.ts'
import { resolvePublicHost } from './netguard.ts'
import type { MenuItem } from './resolve.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import type { PairingStore, Pairing } from './identity.ts'
import { Nip46Client } from './nip46client.ts'
import { storedSigner, CLI_PAIRING_KEY, type CliSigner } from './signing.ts'
import { findSecret } from './secretguard.ts'
import { parseProfile, displayName } from './virtual.ts'
import {
  NOTE_KIND,
  DOC_KIND,
  DELETE_KIND,
  docPath,
  docTitle,
  docType,
  firstLine,
  isValidDocPath,
  isoDate,
  parseDocument,
  plainTerminalText,
} from './protocol.ts'
import { holeRef } from './gemtext.ts'
import { resolveClientTarget, type ClientTarget } from './target.ts'
import {
  docToTemplate,
  publishDocument,
  publishSignedDocument,
  type PlannedDoc,
  type PublishedDocumentReport,
} from './publish.ts'
import {
  assertBrowserSignedTemplate,
  HTTP_BROWSER_SCRIPT,
  nip98Authorization,
  parseSignedEvent,
} from './nip07.ts'

// HTTP stays plain HTML and works without JavaScript in lynx. Graphical
// browsers get history navigation and the standard NIP-07 window.nostr
// interface as progressive enhancements. Loopback requests still use the
// stored CLI pairing; remote visitors can use NIP-46 or browser-side NIP-07.

export interface HttpOptions {
  relays: string[]
  pins: string[]
  virtual: boolean
  pairings: PairingStore
  identity: boolean
  store?: HoleStore
  limiter?: RateLimiter
  // Injectable for tests and embedders. The CLI itself supplies only the
  // persisted NIP-46 signer, never local key material.
  operatorSigner?: CliSigner
  // Trust loopback requests as the operator. On by default.
  localTrust?: boolean
  // Canonical public HTTPS origin when this listener is behind a reverse
  // proxy. It affects links and share metadata, never request authority.
  publicUrl?: string
  // Trust one proxy-supplied client address for rate limiting. The CLI enables
  // this only as part of the explicit private TLS-proxy contract.
  trustedProxy?: boolean
  // Injectable seams for tests and embedders. Production uses the shared
  // target resolver and the NIP-65/read-back publisher.
  resolveTarget?: (input: string) => Promise<ClientTarget>
  documentPublisher?: (document: PlannedDoc, signer: CliSigner) => Promise<PublishedDocumentReport>
  signedDocumentPublisher?: (document: PlannedDoc, event: Event) => Promise<PublishedDocumentReport>
}

interface SessionBase {
  expires: number
  csrf: string
}

type Session = SessionBase &
  ({ kind: 'nip46'; pairing: Pairing } | { kind: 'nip07'; pubkey: string })

const sessions = new Map<string, Session>()
const usedNip98Events = new Map<string, number>()
const SESSION_MS = 12 * 60 * 60 * 1000
const SEARCH_PREFIX = '/_gopherkind/search/'

function targetLocation(target: ClientTarget): string {
  return target.kind === 'hole'
    ? holeRef(target.npub, target.path)
    : proxyPath({
        host: target.host,
        port: target.port,
        type: target.type,
        selector: target.selector,
      })
}

function canonical(opts: HttpOptions, ref: string): string | undefined {
  if (opts.publicUrl === undefined) return undefined
  return new URL(ref, `${opts.publicUrl.replace(/\/$/, '')}/`).toString()
}

function contentDescription(content: Content): string {
  if (content.kind === 'text') return firstLine(content.body, 180) || content.title
  if (content.kind === 'menu') {
    return (
      firstLine(
        plainTerminalText(
          content.items
            .filter((item) => item.target.scheme === 'none')
            .map((item) => item.display)
            .join(' '),
        ),
        180,
      ) || content.title
    )
  }
  return content.message
}

function decodePath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes('/')) throw new Error('encoded path separator')
      return decoded
    })
    .join('/')
}

function requestPath(target: string): string {
  const query = target.indexOf('?')
  const fragment = target.indexOf('#')
  const ends = [query, fragment].filter((index) => index !== -1)
  const end = ends.length === 0 ? target.length : Math.min(...ends)
  return target.slice(0, end) || '/'
}

function isLoopback(addr: string | undefined): boolean {
  if (addr === undefined) return false
  const bare = addr.replace(/^::ffff:/, '')
  return bare === '::1' || bare === '127.0.0.1' || /^127\./.test(bare)
}

// The operator surface is reachable only when the request both originates
// on loopback and presents a loopback Host header. A cross-site page can
// force a loopback connection (127.0.0.1) but a DNS-rebound one carries a
// foreign Host, so requiring both closes rebinding to the operator.
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return true
  const host = hostHeader
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || /^127\./.test(host)
}

// Reject a state-changing request whose Origin is not our own. Lynx and the
// CLI send no Origin; a cross-site browser attack always does.
function originOk(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
  'cache-control': 'no-store',
}

function sweepSessions(now: number): void {
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token)
  for (const [eventId, expires] of usedNip98Events) {
    if (expires < now) usedNip98Events.delete(eventId)
  }
}

// Mark the session cookie Secure when the request arrived over TLS, whether
// directly or via a proxy that sets x-forwarded-proto, so the token is never
// sent back in clear once TLS is in play.
function secureFlag(req: http.IncomingMessage): string {
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true
  const forwarded = req.headers['x-forwarded-proto'] === 'https'
  return encrypted || forwarded ? ' Secure;' : ''
}

function absoluteRequestUrl(req: http.IncomingMessage, opts: HttpOptions): string {
  const target = req.url ?? '/'
  if (opts.publicUrl !== undefined) {
    return new URL(target, `${opts.publicUrl.replace(/\/$/, '')}/`).toString()
  }
  const host = req.headers.host
  if (host === undefined) throw new Error('request has no Host header')
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true
  const protocol = encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  return new URL(target, `${protocol}://${host}`).toString()
}

function rateLimitAddress(req: http.IncomingMessage, trustedProxy: boolean): string {
  if (trustedProxy) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && !forwarded.includes(',')) {
      const address = forwarded.trim()
      if (isIP(address) !== 0) return address
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function sessionFrom(cookieHeader: string | undefined): Session | null {
  const raw = /(?:^|;\s*)gopherkind=([A-Za-z0-9_-]+)/.exec(cookieHeader ?? '')?.[1]
  if (!raw) return null
  const s = sessions.get(raw)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(raw)
    return null
  }
  return s
}

interface Viewer {
  signer: CliSigner | null
  pubkey: string | null
  kind: 'anonymous' | 'local' | 'nip46' | 'nip07'
  csrf: string
}

function viewerFor(req: http.IncomingMessage, opts: HttpOptions, operatorCsrf: string): Viewer {
  if (!opts.identity) return { signer: null, pubkey: null, kind: 'anonymous', csrf: '' }
  const session = sessionFrom(req.headers.cookie)
  if (session) {
    if (session.kind === 'nip07') {
      return {
        signer: null,
        pubkey: session.pubkey,
        kind: 'nip07',
        csrf: session.csrf,
      }
    }
    const client = new Nip46Client()
    const pairing = session.pairing
    return {
      signer: {
        describe: 'paired signer',
        pubkey: async () => pairing.userPubkey,
        sign: (tpl) => client.sign(pairing, tpl),
      },
      pubkey: pairing.userPubkey,
      kind: 'nip46',
      csrf: session.csrf,
    }
  }
  // Loopback is the operator: same trust the CLI already gives them, so
  // browsing from your own machine needs no login. Requires a loopback Host
  // too, so a DNS-rebound page cannot borrow the operator's signer.
  // GOPHERKIND_BUNKER is not consulted here because it would re-pair every request.
  if (
    opts.localTrust !== false &&
    isLoopback(req.socket.remoteAddress) &&
    isLoopbackHost(req.headers.host)
  ) {
    const signer = opts.operatorSigner ?? storedSigner(opts.pairings)
    if (signer) return { signer, pubkey: null, kind: 'local', csrf: operatorCsrf }
  }
  return { signer: null, pubkey: null, kind: 'anonymous', csrf: '' }
}

function isSignedIn(viewer: Viewer): boolean {
  return viewer.signer !== null || viewer.pubkey !== null
}

async function viewerPubkey(viewer: Viewer): Promise<string | null> {
  if (viewer.pubkey !== null) return viewer.pubkey
  return viewer.signer === null ? null : viewer.signer.pubkey()
}

function nip07FormAttributes(viewer: Viewer, action: string): string {
  return viewer.kind === 'nip07'
    ? ` data-nip07-action="${action}" data-nip07-pubkey="${esc(viewer.pubkey ?? '')}"`
    : ''
}

function browserSubmittedEvent(body: Record<string, string>, viewer: Viewer): Event {
  if (viewer.kind !== 'nip07' || viewer.pubkey === null) {
    throw new Error('this session does not use a browser signer')
  }
  return parseSignedEvent(body['event'] ?? '')
}

function nip07SigningStatus(viewer: Viewer): string {
  return viewer.kind === 'nip07'
    ? '<p aria-live="polite">Your browser extension will ask you to approve the signature.</p>'
    : ''
}

function csrfField(viewer: Viewer): string {
  return `<input type="hidden" name="csrf" value="${esc(viewer.csrf)}">`
}

function csrfOk(req: http.IncomingMessage, body: Record<string, string>, viewer: Viewer): boolean {
  if (!originOk(req)) return false
  const given = body['csrf'] ?? ''
  const expected = viewer.csrf
  if (expected === '' || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
      // A signed document expands under form encoding. Keep the wire
      // bound explicit while leaving room for that event and its signature.
      if (body.length > 256_000) {
        reject(new Error('body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      const out: Record<string, string> = {}
      for (const [k, v] of new URLSearchParams(body)) out[k] = v
      resolve(out)
    })
    req.on('error', reject)
  })
}

export function createHttpServer(opts: HttpOptions): http.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  const limiter = opts.limiter ?? new RateLimiter(60, 2)
  // One server-lifetime token authorises the loopback operator's forms. It
  // is embedded in the operator's own pages (which a cross-site attacker
  // cannot read) and required on every state-changing POST.
  const operatorCsrf = randomBytes(24).toString('base64url')
  return http.createServer((req, res) => {
    if (requestPath(req.url ?? '/') === '/healthz') {
      res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 200 : 405, {
        'content-type': 'text/plain; charset=utf-8',
        allow: 'GET, HEAD',
        ...SECURITY_HEADERS,
      })
      res.end(req.method === 'HEAD' ? undefined : 'ok\n')
      return
    }
    if (!limiter.allow(rateLimitAddress(req, opts.trustedProxy === true))) {
      res.writeHead(429, { 'content-type': 'text/plain', ...SECURITY_HEADERS })
      res.end('slow down\n')
      return
    }
    handle(req, opts, store, operatorCsrf)
      .catch((err: unknown) => ({
        status: 500,
        headers: {},
        body: page(
          'Error',
          `<h1>Error</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>`,
          false,
        ),
      }))
      .then((r) => {
        res.writeHead(r.status, {
          'content-type': 'text/html; charset=utf-8',
          ...SECURITY_HEADERS,
          ...r.headers,
        })
        res.end(r.body)
      })
  })
}

interface Reply {
  status: number
  headers: Record<string, string>
  body: string
}

const html = (status: number, body: string, headers: Record<string, string> = {}): Reply => ({
  status,
  headers,
  body,
})
const redirect = (to: string, headers: Record<string, string> = {}): Reply => ({
  status: 303,
  headers: { location: to, ...headers },
  body: '',
})

function nip07ConnectPage(req: http.IncomingMessage, opts: HttpOptions): Reply {
  if (!opts.identity) return html(404, 'NIP-07 connection is disabled here.\n')
  if (req.method !== 'POST')
    return html(405, 'Use POST for NIP-07 connection.\n', { allow: 'POST' })
  if (!originOk(req)) return html(403, 'Cross-site NIP-07 connection refused.\n')
  try {
    const event = nip98Authorization(
      req.headers.authorization,
      absoluteRequestUrl(req, opts),
      'POST',
    )
    const now = Date.now()
    sweepSessions(now)
    if (usedNip98Events.has(event.id)) return html(401, 'NIP-98 authorization was already used.\n')
    usedNip98Events.set(event.id, now + 60_000)
    const token = randomBytes(24).toString('base64url')
    sessions.set(token, {
      kind: 'nip07',
      pubkey: event.pubkey,
      expires: now + SESSION_MS,
      csrf: randomBytes(24).toString('base64url'),
    })
    return html(204, '', {
      'set-cookie': `gopherkind=${token}; HttpOnly; SameSite=Strict; Path=/;${secureFlag(req)} Max-Age=${SESSION_MS / 1000}`,
    })
  } catch (err) {
    return html(401, `${err instanceof Error ? err.message : 'NIP-07 connection refused'}\n`)
  }
}

async function handle(
  req: http.IncomingMessage,
  opts: HttpOptions,
  store: HoleStore,
  operatorCsrf: string,
): Promise<Reply> {
  let path: string
  try {
    path = decodePath(requestPath(req.url ?? '/'))
  } catch {
    return html(400, page('Bad request', '<h1>Bad request</h1><p>malformed url</p>', false))
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const viewer = viewerFor(req, opts, operatorCsrf)
  const signedIn = isSignedIn(viewer)

  if (path === '/browser.js') {
    return html(200, HTTP_BROWSER_SCRIPT, { 'content-type': 'text/javascript; charset=utf-8' })
  }
  if (path === '/nip07/connect') return nip07ConnectPage(req, opts)
  if (path === '/') return html(200, await welcome(opts, store, signedIn))
  if (path === '/robots.txt') {
    return html(200, robotsTxt(), { 'content-type': 'text/plain; charset=utf-8' })
  }
  if (path === '/go') {
    const input = (url.searchParams.get('npub') ?? '').trim()
    if (input === '') return redirect('/')
    try {
      const target = await (opts.resolveTarget ?? resolveClientTarget)(input)
      return redirect(targetLocation(target))
    } catch (err) {
      return html(
        400,
        page(
          'Cannot open that',
          `<h1>Cannot open that</h1><p>${esc(err instanceof Error ? err.message : 'bad target')}</p>`,
          signedIn,
        ),
      )
    }
  }
  if (path === '/account') return accountPage(opts, viewer, store, signedIn)
  if (path === '/me') return managePages(store, viewer, signedIn)
  if (path === '/me/delete') return deleteDocumentPage(req, store, viewer, signedIn)
  if (path === '/pair') return pairPage(req, opts, signedIn)
  if (path === '/unpair') return unpairPage(req, signedIn)
  if (path === '/post') return postPage(req, opts, store, viewer, signedIn)
  if (path === '/publish') return publishPage(req, opts, store, viewer, signedIn)
  if (path === '/feed') return feedPage(opts, store, viewer, signedIn)
  if (path === '/delete') return deletePage(req, store, viewer, signedIn)
  if (path.startsWith('/gopher/') || path === '/gopher') {
    const target = parseProxyPath(path)
    if (!target) {
      return html(
        400,
        page(
          'Bad gopher address',
          '<h1>Bad gopher address</h1><p>Use /gopher/host/1/selector</p>',
          signedIn,
        ),
      )
    }
    const q = url.searchParams.get('q')
    if (target.type === '7' && q === null) {
      const form =
        `<h1>Search ${esc(target.host)}</h1><form method="get">` +
        '<p><input type="text" name="q" size="40"> <input type="submit" value="Search"></p></form>'
      return html(200, page('Search gopherspace', form, signedIn))
    }
    // The proxy is internet-exposed and the remote visitor names the host,
    // so guard against SSRF into internal ranges before connecting, and
    // connect to the validated IP to close the DNS-rebinding window.
    let connectHost: string
    try {
      connectHost = await resolvePublicHost(target.host)
    } catch {
      return html(
        502,
        page(
          'Blocked',
          '<h1>Blocked</h1><p>That address is not reachable through this proxy.</p>',
          signedIn,
        ),
      )
    }
    const content = await browseGopher(target, q === null ? undefined : q, connectHost)
    const rendered = renderContentHtml(content)
    return html(content.kind === 'error' ? 502 : 200, page(rendered.title, rendered.body, signedIn))
  }

  if (path.startsWith(SEARCH_PREFIX)) {
    const npub = path.slice(SEARCH_PREFIX.length)
    if (npub === '' || npub.includes('/')) {
      return html(404, page('Not found', '<h1>Not found</h1><p>bad search address</p>', signedIn))
    }
    let searchOwner: Route
    try {
      searchOwner = parseSelector(`/${npub}`)
    } catch (err) {
      const msg = err instanceof SelectorError ? err.message : 'bad address'
      return html(404, page('Not found', `<h1>Not found</h1><p>${esc(msg)}</p>`, signedIn))
    }
    if (searchOwner.kind !== 'doc') return redirect('/')
    const q = url.searchParams.get('q') ?? ''
    const action = `${SEARCH_PREFIX}${searchOwner.npub}`
    const form =
      `<h1>Search</h1>\n<form method="get" action="${esc(action)}">` +
      `<p><input type="text" name="q" value="${esc(q)}" size="40"></p>` +
      '<p><input type="submit" value="Search"></p></form>'
    if (q === '') return html(200, page('Search', form, signedIn))
    const content = await resolveRoute(
      {
        kind: 'search',
        pubkey: searchOwner.pubkey,
        npub: searchOwner.npub,
        path: '/',
        query: q,
      },
      store,
      { virtual: opts.virtual },
    )
    const rendered = renderContentHtml(content)
    return html(200, page(rendered.title, `${form}\n<hr>\n${rendered.body}`, signedIn))
  }

  // Everything else is authored or virtual hole content: /<npub>[/path].
  // A NIP-05 name is a human-facing alias only. Resolve it, then redirect to
  // the canonical npub path so every generated link remains bridge-portable.
  const firstSegment = path.slice(1).split('/')[0] ?? ''
  if (firstSegment.includes('@')) {
    try {
      const target = await (opts.resolveTarget ?? resolveClientTarget)(path.slice(1))
      if (target.kind !== 'hole') throw new Error('not a Nostr identity')
      return redirect(targetLocation(target))
    } catch (err) {
      return html(
        404,
        page(
          'Not found',
          `<h1>Not found</h1><p>${esc(err instanceof Error ? err.message : 'bad NIP-05 name')}</p>`,
          signedIn,
        ),
      )
    }
  }
  let route: Route
  try {
    route = parseSelector(path)
  } catch (err) {
    const msg = err instanceof SelectorError ? err.message : 'bad address'
    return html(404, page('Not found', `<h1>Not found</h1><p>${esc(msg)}</p>`, signedIn))
  }
  if (route.kind !== 'doc') return redirect('/')

  const content = await resolveRoute(route, store, { virtual: opts.virtual })
  if (content.kind === 'text' && content.mediaType !== undefined) {
    return html(200, content.body, { 'content-type': content.mediaType })
  }
  const rendered = renderContentHtml(content)
  let extra = ''
  const mine = signedIn ? await viewerPubkey(viewer) : null
  if (mine === route.pubkey && content.kind !== 'error') {
    const authored = await store.doc(route.pubkey, route.path)
    if (authored !== null) {
      const edit = `/publish?path=${encodeURIComponent(route.path)}`
      const remove = `/me/delete?path=${encodeURIComponent(route.path)}`
      extra +=
        '\n<hr>\n<h2>Manage this page</h2>' +
        `<p><a href="${esc(edit)}">Edit and republish</a> · ` +
        `<a href="${esc(remove)}">Request deletion</a> · ` +
        '<a href="/me">All my pages</a></p>'
    }
  }
  // Offer deletion on your own notes.
  const noteId = /^\/notes\/([0-9a-f]{64})$/.exec(route.path)?.[1]
  if (noteId && mine === route.pubkey) {
    extra =
      `\n<hr>\n<form method="post" action="/delete"${nip07FormAttributes(viewer, 'delete')}>` +
      csrfField(viewer) +
      `<input type="hidden" name="id" value="${esc(noteId)}">` +
      `<input type="hidden" name="kind" value="${NOTE_KIND}">` +
      nip07SigningStatus(viewer) +
      '<p><input type="submit" value="Delete this note"></p></form>'
  }
  return html(
    content.kind === 'error' ? 404 : 200,
    page(rendered.title, rendered.body + extra, signedIn, {
      canonical: canonical(opts, holeRef(route.npub, route.path)),
      description: contentDescription(content),
    }),
  )
}

async function welcome(opts: HttpOptions, store: HoleStore, signedIn: boolean): Promise<string> {
  const body = [
    '<h1>gopherkind</h1>',
    '<p>Gopherholes served from Nostr relays. Every hole is a set of',
    'signed Nostr events. Any bridge that can retrieve a relay copy can serve it.</p>',
    '<p>Any npub works, published or not: profiles, notes and long-form',
    'articles are served as a virtual hole.</p>',
    '<form method="get" action="/go"><p>Open a hole: ',
    '<input type="text" name="npub" size="40" placeholder="npub1..."> ',
    '<input type="submit" value="Go"></p></form>',
    '<h2>Traditional gopherspace</h2>',
    '<p>gopherkind is also a gopher client, so old-school holes render here too.</p>',
    '<p><a href="/gopher/gopher.floodgap.com/1/">Floodgap</a> ',
    '<a href="/gopher/gopher.floodgap.com/1/world">Floodgap world map</a></p>',
  ]
  if (signedIn) {
    body.splice(
      8,
      0,
      '<p><strong>Your identity is connected.</strong> <a href="/me">Manage my pages</a>.</p>',
    )
  }
  if (opts.pins.length > 0) {
    body.push('<h2>Pinned holes</h2>')
    for (const npub of opts.pins) {
      let name = `${npub.slice(0, 16)}...`
      try {
        const decoded = nip19.decode(npub)
        if (decoded.type === 'npub') {
          name = displayName(parseProfile(await store.profile(decoded.data)), npub)
        }
      } catch {
        // keep the shortened npub
      }
      body.push(`<p><a href="/${esc(npub)}">${esc(name)}</a></p>`)
    }
  }
  return page('gopherkind', body.join('\n'), signedIn, {
    canonical: canonical(opts, '/'),
    description:
      'Signed, navigable Nostr reading rooms served over Gopher, Gemini, HTTP and the terminal.',
  })
}

async function accountPage(
  opts: HttpOptions,
  viewer: Viewer,
  store: HoleStore,
  signedIn: boolean,
): Promise<Reply> {
  if (!opts.identity) {
    return html(200, page('Account', '<h1>Account</h1><p>Sign-in is disabled here.</p>', false))
  }
  if (!isSignedIn(viewer)) {
    return html(
      200,
      page(
        'Sign in',
        [
          '<h1>Sign in</h1>',
          '<section data-nip07-connect>',
          '<h2>Browser extension (NIP-07)</h2>',
          '<p aria-live="polite">Looking for a NIP-07 browser extension...</p>',
          '<p><button type="button" hidden>Connect browser extension</button></p>',
          '<noscript><p>NIP-07 needs a graphical browser with JavaScript. The NIP-46 form below still works without it.</p></noscript>',
          '</section>',
          '<hr>',
          '<h2>Remote signer (NIP-46)</h2>',
          '<p>Pair a NIP-46 remote signer (Signet, Heartwood, Amber,',
          'nsecBunker, nsec.app). Your key stays on the signer; this',
          'bridge only asks it to sign.</p>',
          '<form method="post" action="/pair">',
          '<p><input type="text" name="uri" size="50" placeholder="bunker://..."></p>',
          '<p><input type="submit" value="Pair signer"></p></form>',
        ].join('\n'),
        false,
      ),
    )
  }
  const pubkey = await viewerPubkey(viewer)
  if (pubkey === null) return redirect('/account')
  const npub = nip19.npubEncode(pubkey)
  const profile = parseProfile(await store.profile(pubkey))
  const body = [
    '<h1>Account</h1>',
    `<p>Signed in as ${esc(displayName(profile, npub))}`,
    viewer.kind === 'local' && viewer.signer !== null
      ? ` (local operator, ${esc(viewer.signer.describe)})`
      : '',
    viewer.kind === 'nip07' ? ' (NIP-07 browser extension)' : '',
    viewer.kind === 'nip46' ? ' (NIP-46 remote signer)' : '',
    '</p>',
    `<p><code>${esc(npub)}</code></p>`,
    '<p><a href="/me">My pages</a></p>',
    '<p><a href="/feed">Your feed</a></p>',
    '<p><a href="/post">Write a note</a></p>',
  ]
  if (viewer.kind === 'nip46' || viewer.kind === 'nip07') {
    body.push(
      `<form method="post" action="/unpair">${csrfField(viewer)}<p><input type="submit" value="Disconnect"></p></form>`,
    )
  }
  return html(200, page('Account', body.join('\n'), signedIn))
}

async function pairPage(
  req: http.IncomingMessage,
  opts: HttpOptions,
  signedIn: boolean,
): Promise<Reply> {
  if (!opts.identity) return redirect('/')
  if (req.method !== 'POST') return redirect('/account')
  // Anonymous visitors have no per-viewer token yet, so the Origin check is
  // the CSRF defence here: it stops a cross-site page pairing you to an
  // attacker's signer.
  if (!originOk(req))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>cross-site request refused</p>', signedIn))
  const body = await readBody(req)
  const uri = (body['uri'] ?? '').trim()
  if (uri === '') return redirect('/account')
  try {
    const result = await new Nip46Client().pair(uri)
    const token = randomBytes(24).toString('base64url')
    const now = Date.now()
    sweepSessions(now)
    sessions.set(token, {
      kind: 'nip46',
      pairing: {
        fingerprint: `http:${token.slice(0, 8)}`,
        userPubkey: result.userPubkey,
        clientSecretKey: result.clientSecretKey,
        bunker: result.bunker,
        pairedAt: Math.floor(now / 1000),
      },
      expires: now + SESSION_MS,
      csrf: randomBytes(24).toString('base64url'),
    })
    return redirect('/account', {
      'set-cookie': `gopherkind=${token}; HttpOnly; SameSite=Strict; Path=/;${secureFlag(req)} Max-Age=${SESSION_MS / 1000}`,
    })
  } catch (err) {
    return html(
      200,
      page(
        'Pairing failed',
        `<h1>Pairing failed</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>` +
          '<p><a href="/account">Try again</a></p>',
        signedIn,
      ),
    )
  }
}

function unpairPage(req: http.IncomingMessage, signedIn: boolean): Reply {
  if (req.method !== 'POST') return redirect('/account')
  if (!originOk(req))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>cross-site request refused</p>', signedIn))
  const raw = /(?:^|;\s*)gopherkind=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1]
  if (raw) sessions.delete(raw)
  return html(
    200,
    page(
      'Disconnected',
      '<h1>Disconnected</h1><p>The bridge session has ended. If you used NIP-46, revoke that session on your signer too.</p><p><a href="/">Home</a></p>',
      signedIn && false,
    ),
    { 'set-cookie': 'gopherkind=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
  )
}

async function postPage(
  req: http.IncomingMessage,
  opts: HttpOptions,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  const form = [
    '<h1>Write a note</h1>',
    '<p>Public, signed by your signer, broadcast as a kind 1 event.</p>',
    `<form method="post" action="/post"${nip07FormAttributes(viewer, 'post')}>`,
    csrfField(viewer),
    '<p><textarea name="text" rows="6" cols="60"></textarea></p>',
    nip07SigningStatus(viewer),
    '<p><input type="submit" value="Sign and post"></p></form>',
  ].join('\n')
  if (req.method !== 'POST') return html(200, page('Write a note', form, signedIn))

  const body = await readBody(req)
  if (!csrfOk(req, body, viewer))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>bad or missing form token</p>', signedIn))
  try {
    let signed: Event
    let text: string
    if (viewer.kind === 'nip07') {
      signed = browserSubmittedEvent(body, viewer)
      text = signed.content.trim()
      assertBrowserSignedTemplate(signed, viewer.pubkey ?? '', {
        kind: NOTE_KIND,
        created_at: signed.created_at,
        tags: [],
        content: text,
      })
    } else {
      text = (body['text'] ?? '').trim()
      if (text === '') return html(200, page('Write a note', form, signedIn))
      if (viewer.signer === null) throw new Error('no signer is connected')
      signed = await viewer.signer.sign({
        kind: NOTE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: text,
      })
    }
    if (text === '') return html(200, page('Write a note', form, signedIn))
    const leak = findSecret(text)
    if (leak) {
      return html(
        200,
        page(
          'Not posting that',
          [
            '<h1>Not posting that</h1>',
            `<p>That note contains what looks like ${esc(leak)}. Nothing was`,
            'published or sent to a relay.</p>',
            '<p>If you meant to pair a signer, use <a href="/account">the account page</a>.</p>',
            '<p>If you already pasted a bunker secret somewhere public, rotate',
            'it on the signer.</p>',
            form,
          ].join('\n'),
          signedIn,
        ),
      )
    }
    const accepted = await store.publish(signed)
    const npub = nip19.npubEncode(signed.pubkey)
    return html(
      200,
      page(
        'Posted',
        [
          '<h1>Posted</h1>',
          `<p>Accepted by ${accepted}/${opts.relays.length} relays.</p>`,
          `<p><a href="/${esc(npub)}/notes/${esc(signed.id)}">View your note</a></p>`,
          '<p><a href="/post">Write another</a></p>',
        ].join('\n'),
        signedIn,
      ),
    )
  } catch (err) {
    return html(
      200,
      page(
        'Posting failed',
        `<h1>Posting failed</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>` +
          form,
        signedIn,
      ),
    )
  }
}

async function managePages(store: HoleStore, viewer: Viewer, signedIn: boolean): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  const pubkey = await viewerPubkey(viewer)
  if (pubkey === null) return redirect('/account')
  const npub = nip19.npubEncode(pubkey)
  const documents = await store.hole(pubkey)
  const rows = documents.map((event) => {
    const path = docPath(event)
    const view = holeRef(npub, path)
    const edit = `/publish?path=${encodeURIComponent(path)}`
    const remove = `/me/delete?path=${encodeURIComponent(path)}`
    const type = docType(event) === '1' ? 'menu' : 'text'
    return (
      `<li><code>${esc(path)}</code> — ${esc(docTitle(event))} (${type})<br>` +
      `<a href="${esc(view)}">view</a> · <a href="${esc(edit)}">edit and republish</a> · ` +
      `<a href="${esc(remove)}">request deletion</a></li>`
    )
  })
  const body = [
    '<h1>Your pages</h1>',
    `<p><a href="/${esc(npub)}">View your public hole</a> · ` +
      '<a href="/publish">Add a new page</a></p>',
    '<p>Publishing the same exact path updates that page. Deletion publishes a signed',
    'request; relays and readers may retain a copy.</p>',
    rows.length === 0
      ? '<p>You have no authored pages yet. Start with a <a href="/publish">home page at <code>/</code></a>.</p>'
      : `<ul>${rows.join('\n')}</ul>`,
  ]
  return html(200, page('Your pages', body.join('\n'), signedIn))
}

async function deleteDocumentPage(
  req: http.IncomingMessage,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  if (req.method !== 'GET') return redirect('/me')
  const path = new URL(req.url ?? '/', 'http://localhost').searchParams.get('path') ?? ''
  if (!isValidDocPath(path)) {
    return html(400, page('Bad page path', '<h1>Bad page path</h1>', signedIn))
  }
  const pubkey = await viewerPubkey(viewer)
  if (pubkey === null) return redirect('/account')
  const existing = await store.doc(pubkey, path)
  if (existing === null) {
    return html(
      404,
      page(
        'Page not found',
        '<h1>Page not found</h1><p>No current authored page exists at that path.</p><p><a href="/me">Back to your pages</a></p>',
        signedIn,
      ),
    )
  }
  const address = `${DOC_KIND}:${pubkey}:${path}`
  const rootWarning =
    path === '/' ? '<p><strong>This will leave your hole without a home page.</strong></p>' : ''
  const form = [
    '<h1>Request page deletion</h1>',
    `<p>You are requesting deletion of <code>${esc(path)}</code> (${esc(docTitle(existing))}).</p>`,
    rootWarning,
    '<p>This publishes a signed NIP-09 request. Relays may ignore it and clients may retain a copy.</p>',
    `<form method="post" action="/delete"${nip07FormAttributes(viewer, 'delete')}>`,
    csrfField(viewer),
    `<input type="hidden" name="id" value="${esc(existing.id)}">`,
    `<input type="hidden" name="kind" value="${DOC_KIND}">`,
    `<input type="hidden" name="path" value="${esc(path)}">`,
    `<input type="hidden" name="address" value="${esc(address)}">`,
    '<p><label>Type <code>DELETE</code> to confirm<br>',
    '<input type="text" name="confirm" pattern="DELETE" autocomplete="off" required></label></p>',
    nip07SigningStatus(viewer),
    '<p><input type="submit" value="Sign deletion request"> <a href="/me">Cancel</a></p>',
    '</form>',
  ].join('\n')
  return html(200, page('Request page deletion', form, signedIn))
}

function documentForm(
  viewer: Viewer,
  values: Partial<PlannedDoc> = {},
  options: { editing?: boolean } = {},
): string {
  const type = values.type ?? '0'
  const editing = options.editing === true
  return [
    editing ? `<h1>Edit ${esc(values.path ?? '')}</h1>` : '<h1>Publish to your hole</h1>',
    '<p><a href="/me">Back to your pages</a></p>',
    '<p>Add a public page to your hole or update one you have already published.',
    'Your signer signs it, then gopherkind sends it to your Nostr relays.</p>',
    '<ul>',
    '<li><strong>Text page:</strong> write an about page, journal entry, contact page',
    'or any other plain-text document.</li>',
    '<li><strong>Menu page:</strong> make a home page or section that introduces your',
    "hole and links to pages, other people's holes, searches or websites. The",
    'menu format is called a <em>kindmap</em>.</li>',
    '</ul>',
    '<p>Published pages are public. Relays and readers may retain old copies even',
    'after you replace a page or request its deletion.</p>',
    `<form method="post" action="/publish"${nip07FormAttributes(viewer, 'publish')}>`,
    csrfField(viewer),
    `<p><label for="document-path">Path</label><br><input id="document-path" type="text" name="path" size="50" value="${esc(values.path ?? '/')}" aria-describedby="path-help"${editing ? ' readonly' : ''} required></p>`,
    '<p id="path-help">Use <code>/</code> for your home page, or a path such as',
    '<code>/about.txt</code> or <code>/phlog/2026-08-04.txt</code>. Paths are exact,',
    'and publishing to the same path updates that page.</p>',
    '<p><label for="document-title">Title</label><br>',
    `<input id="document-title" type="text" name="title" size="50" value="${esc(values.title ?? '')}" aria-describedby="title-help"></p>`,
    '<p id="title-help">Shown as the page heading. If left blank, the path is used.</p>',
    '<p><label for="document-type">Page type</label><br><select id="document-type" name="type" aria-describedby="type-help">',
    `<option value="0"${type === '0' ? ' selected' : ''}>Text page</option>`,
    `<option value="1"${type === '1' ? ' selected' : ''}>Menu page (kindmap)</option>`,
    '</select></p>',
    '<p id="type-help">Text pages show their content literally. Menu pages turn',
    'specially written lines into navigation links.</p>',
    '<details><summary>How to write a menu page</summary>',
    '<p>Ordinary lines become introductory text. A link line contains a one-character',
    'item type and its label, then one tab, then the destination. Useful item types',
    'are <code>0</code> for a text page, <code>1</code> for another menu,',
    '<code>7</code> for search and <code>h</code> for a website.</p>',
    '<pre>Welcome to my hole\n\n0About me\t/about.txt\n1My journal\t/phlog\n7Search this hole\t/\nhMy website\thttps://example.com</pre>',
    '<p>Same-hole destinations start with <code>/</code>. You can also link to an',
    '<code>npub</code>, <code>nprofile</code>, <code>naddr</code>,',
    '<code>gopher://</code> or <code>https://</code> address. Publish each linked',
    'same-hole page separately; adding a menu link does not create its destination.</p>',
    '</details>',
    '<p><label for="document-content">Content</label><br>',
    `<textarea name="content" id="document-content" rows="20" cols="72" aria-describedby="content-help">${esc(values.content ?? '')}</textarea></p>`,
    '<p id="content-help">Remote signing requests are capped at 20 KiB so their encrypted request',
    'and signed response remain inside the safe NIP-44 padding and relay envelope boundary.</p>',
    '<p><label><input type="checkbox" name="replace" value="yes" required> ',
    'I understand this is public and replaces any current page at the same exact path.</label></p>',
    nip07SigningStatus(viewer),
    `<p><input type="submit" value="${editing ? 'Sign and republish' : 'Sign and publish'}"></p></form>`,
  ].join('\n')
}

async function publishPage(
  req: http.IncomingMessage,
  opts: HttpOptions,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  if (req.method !== 'POST') {
    const requestedPath = new URL(req.url ?? '/', 'http://localhost').searchParams.get('path')
    if (requestedPath !== null) {
      if (!isValidDocPath(requestedPath)) {
        return html(400, page('Bad page path', '<h1>Bad page path</h1>', signedIn))
      }
      const pubkey = await viewerPubkey(viewer)
      if (pubkey === null) return redirect('/account')
      const existing = await store.doc(pubkey, requestedPath)
      if (existing === null) {
        return html(
          404,
          page(
            'Page not found',
            '<h1>Page not found</h1><p>No current authored page exists at that path.</p><p><a href="/me">Back to your pages</a></p>',
            signedIn,
          ),
        )
      }
      return html(
        200,
        page(
          `Edit ${requestedPath}`,
          documentForm(
            viewer,
            {
              path: docPath(existing),
              title: docTitle(existing),
              type: docType(existing),
              content: existing.content,
            },
            { editing: true },
          ),
          signedIn,
        ),
      )
    }
    return html(200, page('Publish a document', documentForm(viewer), signedIn))
  }

  const body = await readBody(req)
  if (!csrfOk(req, body, viewer)) {
    return html(403, page('Blocked', '<h1>Blocked</h1><p>bad or missing form token</p>', signedIn))
  }
  let document: PlannedDoc
  let browserEvent: Event | null = null
  try {
    if (viewer.kind === 'nip07') {
      browserEvent = browserSubmittedEvent(body, viewer)
      const metadata = parseDocument(browserEvent)
      if (metadata === null) throw new Error('browser signer returned an invalid document')
      document = { ...metadata, content: browserEvent.content }
      assertBrowserSignedTemplate(
        browserEvent,
        viewer.pubkey ?? '',
        docToTemplate(document, browserEvent.created_at),
      )
    } else {
      document = {
        path: (body['path'] ?? '').trim(),
        title: (body['title'] ?? '').trim() || (body['path'] ?? '').trim(),
        type: body['type'] === '1' ? '1' : '0',
        content: body['content'] ?? '',
      }
    }
  } catch (err) {
    return html(
      400,
      page(
        'Publishing failed',
        `<h1>Publishing failed</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>` +
          documentForm(viewer),
        signedIn,
      ),
    )
  }
  if (body['replace'] !== 'yes') {
    return html(
      400,
      page(
        'Confirm replacement',
        '<h1>Confirm replacement</h1><p>Nothing was signed. Confirm the exact-path replacement before publishing.</p>' +
          documentForm(viewer, document),
        signedIn,
      ),
    )
  }
  const leak = findSecret(document.content)
  if (leak) {
    return html(
      400,
      page(
        'Not publishing that',
        `<h1>Not publishing that</h1><p>The document contains what looks like ${esc(leak)}. ` +
          'Nothing was sent to a relay, and the content has been removed from this form.</p>' +
          documentForm(viewer, { ...document, content: '' }),
        signedIn,
      ),
    )
  }

  try {
    let report: PublishedDocumentReport
    if (browserEvent !== null) {
      report = await (
        opts.signedDocumentPublisher ??
        ((doc: PlannedDoc, event: Event) => publishSignedDocument(doc, event, opts.relays))
      )(document, browserEvent)
    } else {
      if (viewer.signer === null) throw new Error('no signer is connected')
      report = await (
        opts.documentPublisher ??
        ((doc: PlannedDoc, signer: CliSigner) => publishDocument(doc, opts.relays, signer))
      )(document, viewer.signer)
    }
    const ref = holeRef(report.npub, report.path)
    const pubkey = await viewerPubkey(viewer)
    if (pubkey !== null) store.invalidateDocument?.(pubkey, report.path)
    const nextStep =
      document.type === '0'
        ? '<p>To make this page easy to find, link to it from a menu page such as your <code>/</code> home page.</p>'
        : '<p>Remember to publish any same-hole pages this menu links to; a menu link does not create its destination.</p>'
    return html(
      200,
      page(
        'Published',
        [
          '<h1>Published</h1>',
          `<p><code>${esc(report.path)}</code> was accepted by ${report.acceptedBy.length}/${report.relays.length} relays`,
          `and read back from ${report.readableFrom.length}/${report.relays.length}.</p>`,
          `<p><a href="${esc(ref)}">Read the document</a></p>`,
          nextStep,
          `<p><a href="/${esc(report.npub)}">Open your hole</a></p>`,
          '<p><a href="/me">Manage your pages</a></p>',
          '<p><a href="/publish">Publish another document</a></p>',
        ].join('\n'),
        signedIn,
      ),
    )
  } catch (err) {
    return html(
      400,
      page(
        'Publishing failed',
        `<h1>Publishing failed</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>` +
          documentForm(viewer, document),
        signedIn,
      ),
    )
  }
}

async function deletePage(
  req: http.IncomingMessage,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  if (req.method !== 'POST') return redirect('/account')
  const body = await readBody(req)
  if (!csrfOk(req, body, viewer))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>bad or missing form token</p>', signedIn))
  let browserEvent: Event | null = null
  let id: string
  let address: string | null = null
  let requestedPath: string | null = null
  try {
    if (viewer.kind === 'nip07') {
      browserEvent = browserSubmittedEvent(body, viewer)
      const eventTags = browserEvent.tags.filter((tag) => tag[0] === 'e')
      id = eventTags.length === 1 ? (eventTags[0]?.[1] ?? '') : ''
      const addressTags = browserEvent.tags.filter((tag) => tag[0] === 'a')
      if (addressTags.length > 1) throw new Error('deletion has more than one address')
      address = addressTags[0]?.[1] ?? null
    } else {
      id = (body['id'] ?? '').trim()
      address = (body['address'] ?? '').trim() || null
      requestedPath = (body['path'] ?? '').trim() || null
    }
  } catch (err) {
    return html(
      400,
      page(
        'Bad request',
        `<h1>Bad request</h1><p>${esc(err instanceof Error ? err.message : 'bad signed event')}</p>`,
        signedIn,
      ),
    )
  }
  if (!/^[0-9a-f]{64}$/.test(id))
    return html(400, page('Bad request', '<p>bad event id</p>', signedIn))
  const mine = await viewerPubkey(viewer)
  if (mine === null) return redirect('/account')
  if (address !== null) {
    const prefix = `${DOC_KIND}:${mine}:`
    if (!address.startsWith(prefix)) {
      return html(
        400,
        page('Deletion refused', '<h1>Deletion refused</h1><p>bad document address</p>', signedIn),
      )
    }
    requestedPath = address.slice(prefix.length)
  }
  if (requestedPath !== null && !isValidDocPath(requestedPath)) {
    return html(
      400,
      page('Deletion refused', '<h1>Deletion refused</h1><p>bad document path</p>', signedIn),
    )
  }
  const existing =
    requestedPath === null ? await store.event(id) : await store.doc(mine, requestedPath)
  // Fail closed: only sign a deletion for an event we positively confirm is
  // the operator's. A relay miss (existing === null) must not authorise it.
  if (!existing) {
    return html(
      404,
      page(
        'Not found',
        '<h1>Not found</h1><p>That event was not found on these relays, so nothing was deleted.</p>',
        signedIn,
      ),
    )
  }
  if (existing.pubkey !== mine) {
    return html(
      403,
      page('Not yours', '<h1>Not yours</h1><p>You can only delete your own events.</p>', signedIn),
    )
  }
  if (existing.id !== id) {
    return html(
      409,
      page(
        'Page changed',
        '<h1>Page changed</h1><p>That page has changed since the deletion form was opened. Nothing was deleted.</p><p><a href="/me">Back to your pages</a></p>',
        signedIn,
      ),
    )
  }
  const document = existing.kind === DOC_KIND ? parseDocument(existing) : null
  if (existing.kind === DOC_KIND) {
    if (document === null || requestedPath !== document.path) {
      return html(
        400,
        page('Deletion refused', '<h1>Deletion refused</h1><p>bad document metadata</p>', signedIn),
      )
    }
    const expectedAddress = `${DOC_KIND}:${mine}:${document.path}`
    if (address !== expectedAddress || body['confirm'] !== 'DELETE') {
      return html(
        400,
        page(
          'Confirm deletion',
          '<h1>Confirm deletion</h1><p>Nothing was deleted. Type DELETE on the page deletion form before signing.</p><p><a href="/me">Back to your pages</a></p>',
          signedIn,
        ),
      )
    }
  } else if (address !== null || requestedPath !== null) {
    return html(
      400,
      page(
        'Deletion refused',
        '<h1>Deletion refused</h1><p>address does not name a page</p>',
        signedIn,
      ),
    )
  }
  const template = {
    kind: DELETE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', id],
      ['k', String(existing.kind)],
    ],
    content: 'deleted by author',
  }
  if (document !== null) template.tags.push(['a', `${DOC_KIND}:${mine}:${document.path}`])
  let signed: Event
  if (browserEvent !== null) {
    template.created_at = browserEvent.created_at
    try {
      signed = assertBrowserSignedTemplate(browserEvent, mine, template)
    } catch (err) {
      return html(
        400,
        page(
          'Deletion refused',
          `<h1>Deletion refused</h1><p>${esc(err instanceof Error ? err.message : 'bad signed event')}</p>`,
          signedIn,
        ),
      )
    }
  } else {
    if (viewer.signer === null) return redirect('/account')
    signed = await viewer.signer.sign(template)
  }
  const delivery = await store.publishForAuthor(signed)
  if (document !== null) store.invalidateDocument?.(mine, document.path)
  return html(
    200,
    page(
      'Deletion requested',
      [
        '<h1>Deletion requested</h1>',
        `<p>Accepted by ${delivery.accepted}/${delivery.total} relays.</p>`,
        '<p>Deletion is a request, not a guarantee: relays may ignore it and',
        'clients may keep a local copy. If the event contained a secret,',
        'rotate the secret too.</p>',
        document === null
          ? '<p><a href="/feed">Back to your feed</a></p>'
          : '<p><a href="/me">Back to your pages</a></p>',
      ].join('\n'),
      signedIn,
    ),
  )
}

async function feedPage(
  _opts: HttpOptions,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!isSignedIn(viewer)) return redirect('/account')
  const pubkey = await viewerPubkey(viewer)
  if (pubkey === null) return redirect('/account')
  const follows = await store.contacts(pubkey)
  if (follows.length === 0) {
    return html(200, page('Your feed', '<h1>Your feed</h1><p>No follows found.</p>', signedIn))
  }
  const notes = await store.feedNotes(follows.slice(0, 100))
  const profiles = await store.profilesBatch(notes.map((n) => n.pubkey))
  const items: MenuItem[] = notes.map((ev) => {
    const authorNpub = nip19.npubEncode(ev.pubkey)
    const name = displayName(parseProfile(profiles.get(ev.pubkey) ?? null), authorNpub)
    return {
      type: '0',
      display: `${isoDate(ev.created_at)}  ${name}: ${firstLine(ev.content, 70)}`,
      target: { scheme: 'hole', npub: authorNpub, path: `/notes/${ev.id}` },
    }
  })
  return html(200, page('Your feed', renderMenuHtml('Your feed', items), signedIn))
}

export { CLI_PAIRING_KEY }
