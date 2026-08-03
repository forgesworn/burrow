import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError, type Route } from './selector.ts'
import { robotsTxt } from './robots.ts'
import { resolveRoute } from './router.ts'
import { page, renderMenuHtml, renderContentHtml, esc } from './html.ts'
import { parseProxyPath, browseGopher } from './gopherclient.ts'
import { resolvePublicHost } from './netguard.ts'
import type { MenuItem } from './resolve.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import type { PairingStore, Pairing } from './identity.ts'
import { Nip46Client } from './nip46client.ts'
import { storedSigner, CLI_PAIRING_KEY, type CliSigner } from './signing.ts'
import { findSecret } from './secretguard.ts'
import { parseProfile, displayName } from './virtual.ts'
import { NOTE_KIND, DELETE_KIND, firstLine, isoDate } from './protocol.ts'

// HTTP frontend, written for lynx: plain HTML, real forms, no JavaScript
// anywhere. Loopback requests are treated as the operator and use the
// stored CLI pairing, so browsing from your own machine needs no login
// at all. Remote visitors pair a signer and get a session cookie.

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
}

interface Session {
  pairing: Pairing
  expires: number
  csrf: string
}

const sessions = new Map<string, Session>()
const SESSION_MS = 12 * 60 * 60 * 1000
const SEARCH_PREFIX = '/_gopherkind/search/'

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
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  'cache-control': 'no-store',
}

function sweepSessions(now: number): void {
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token)
}

// Mark the session cookie Secure when the request arrived over TLS, whether
// directly or via a proxy that sets x-forwarded-proto, so the token is never
// sent back in clear once TLS is in play.
function secureFlag(req: http.IncomingMessage): string {
  const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true
  const forwarded = req.headers['x-forwarded-proto'] === 'https'
  return encrypted || forwarded ? ' Secure;' : ''
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
  label: string
  csrf: string
}

function viewerFor(req: http.IncomingMessage, opts: HttpOptions, operatorCsrf: string): Viewer {
  if (!opts.identity) return { signer: null, label: '', csrf: '' }
  const session = sessionFrom(req.headers.cookie)
  if (session) {
    const client = new Nip46Client()
    const pairing = session.pairing
    return {
      signer: {
        describe: 'paired signer',
        pubkey: async () => pairing.userPubkey,
        sign: (tpl) => client.sign(pairing, tpl),
      },
      label: 'session',
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
    if (signer) return { signer, label: 'local', csrf: operatorCsrf }
  }
  return { signer: null, label: '', csrf: '' }
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
      if (body.length > 64_000) {
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
    if (!limiter.allow(req.socket.remoteAddress ?? 'unknown')) {
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
  const signedIn = viewer.signer !== null

  if (path === '/') return html(200, await welcome(opts, store, signedIn))
  if (path === '/robots.txt') {
    return html(200, robotsTxt(), { 'content-type': 'text/plain; charset=utf-8' })
  }
  if (path === '/go') {
    const target = (url.searchParams.get('npub') ?? '').trim().replace(/^nostr:/, '')
    if (target === '') return redirect('/')
    return redirect(`/${encodeURIComponent(target)}`)
  }
  if (path === '/account') return accountPage(opts, viewer, store, signedIn)
  if (path === '/pair') return pairPage(req, opts, signedIn)
  if (path === '/unpair') return unpairPage(req, signedIn)
  if (path === '/post') return postPage(req, opts, store, viewer, signedIn)
  if (path === '/feed') return feedPage(opts, store, viewer, signedIn)
  if (path === '/delete') return deletePage(req, opts, store, viewer, signedIn)
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
  let route: Route
  try {
    route = parseSelector(path)
  } catch (err) {
    const msg = err instanceof SelectorError ? err.message : 'bad address'
    return html(404, page('Not found', `<h1>Not found</h1><p>${esc(msg)}</p>`, signedIn))
  }
  if (route.kind !== 'doc') return redirect('/')

  const content = await resolveRoute(route, store, { virtual: opts.virtual })
  const rendered = renderContentHtml(content)
  let extra = ''
  // Offer deletion on your own notes.
  const noteId = /^\/notes\/([0-9a-f]{64})$/.exec(route.path)?.[1]
  if (noteId && viewer.signer) {
    const mine = await viewer.signer.pubkey()
    if (mine === route.pubkey) {
      extra =
        `\n<hr>\n<form method="post" action="/delete">` +
        csrfField(viewer) +
        `<input type="hidden" name="id" value="${esc(noteId)}">` +
        '<p><input type="submit" value="Delete this note"></p></form>'
    }
  }
  return html(
    content.kind === 'error' ? 404 : 200,
    page(rendered.title, rendered.body + extra, signedIn),
  )
}

async function welcome(opts: HttpOptions, store: HoleStore, signedIn: boolean): Promise<string> {
  const body = [
    '<h1>gopherkind</h1>',
    '<p>Gopherholes served from Nostr relays. Every hole is a set of',
    'signed Nostr events; relays mirror it, any bridge serves it.</p>',
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
  return page('gopherkind', body.join('\n'), signedIn)
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
  if (!viewer.signer) {
    return html(
      200,
      page(
        'Sign in',
        [
          '<h1>Sign in</h1>',
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
  const pubkey = await viewer.signer.pubkey()
  const npub = nip19.npubEncode(pubkey)
  const profile = parseProfile(await store.profile(pubkey))
  const body = [
    '<h1>Account</h1>',
    `<p>Signed in as ${esc(displayName(profile, npub))}`,
    viewer.label === 'local' ? ` (local operator, ${esc(viewer.signer.describe)})` : '',
    '</p>',
    `<p><code>${esc(npub)}</code></p>`,
    `<p><a href="/${esc(npub)}">Your hole</a></p>`,
    '<p><a href="/feed">Your feed</a></p>',
    '<p><a href="/post">Write a note</a></p>',
  ]
  if (viewer.label === 'session') {
    body.push(
      `<form method="post" action="/unpair">${csrfField(viewer)}<p><input type="submit" value="Sign out"></p></form>`,
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
      'Signed out',
      '<h1>Signed out</h1><p>Revoke the session on your signer too.</p><p><a href="/">Home</a></p>',
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
  if (!viewer.signer) return redirect('/account')
  const form = [
    '<h1>Write a note</h1>',
    '<p>Public, signed by your signer, broadcast as a kind 1 event.</p>',
    '<form method="post" action="/post">',
    csrfField(viewer),
    '<p><textarea name="text" rows="6" cols="60"></textarea></p>',
    '<p><input type="submit" value="Sign and post"></p></form>',
  ].join('\n')
  if (req.method !== 'POST') return html(200, page('Write a note', form, signedIn))

  const body = await readBody(req)
  if (!csrfOk(req, body, viewer))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>bad or missing form token</p>', signedIn))
  const text = (body['text'] ?? '').trim()
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
          'signed and nothing was sent.</p>',
          '<p>If you meant to pair a signer, use <a href="/account">the account page</a>.</p>',
          '<p>If you already pasted a bunker secret somewhere public, rotate',
          'it on the signer.</p>',
          form,
        ].join('\n'),
        signedIn,
      ),
    )
  }
  try {
    const signed = await viewer.signer.sign({
      kind: NOTE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: text,
    })
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

async function deletePage(
  req: http.IncomingMessage,
  opts: HttpOptions,
  store: HoleStore,
  viewer: Viewer,
  signedIn: boolean,
): Promise<Reply> {
  if (!viewer.signer) return redirect('/account')
  if (req.method !== 'POST') return redirect('/account')
  const body = await readBody(req)
  if (!csrfOk(req, body, viewer))
    return html(403, page('Blocked', '<h1>Blocked</h1><p>bad or missing form token</p>', signedIn))
  const id = (body['id'] ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(id))
    return html(400, page('Bad request', '<p>bad event id</p>', signedIn))
  const mine = await viewer.signer.pubkey()
  const existing = await store.event(id)
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
  const signed = await viewer.signer.sign({
    kind: DELETE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', id],
      ['k', String(existing.kind)],
    ],
    content: 'deleted by author',
  })
  const accepted = await store.publish(signed)
  return html(
    200,
    page(
      'Deletion requested',
      [
        '<h1>Deletion requested</h1>',
        `<p>Accepted by ${accepted}/${opts.relays.length} relays.</p>`,
        '<p>Deletion is a request, not a guarantee: relays may ignore it and',
        'clients may keep a local copy. If the event contained a secret,',
        'rotate the secret too.</p>',
        '<p><a href="/feed">Back to your feed</a></p>',
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
  if (!viewer.signer) return redirect('/account')
  const pubkey = await viewer.signer.pubkey()
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
