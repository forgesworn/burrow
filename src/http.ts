import http from 'node:http'
import { randomBytes } from 'node:crypto'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from './selector.ts'
import { resolveRoute } from './router.ts'
import { page, renderMenuHtml, renderContentHtml, esc } from './html.ts'
import { parseProxyPath, browseGopher } from './gopherclient.ts'
import { resolvePublicHost } from './netguard.ts'
import type { MenuItem } from './resolve.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { PairingStore, type Pairing } from './identity.ts'
import { Nip46Client } from './nip46client.ts'
import { storedSigner, localSigner, CLI_PAIRING_KEY, type CliSigner } from './signing.ts'
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
  // Trust loopback requests as the operator. On by default.
  localTrust?: boolean
}

interface Session {
  pairing: Pairing
  expires: number
}

const sessions = new Map<string, Session>()
const SESSION_MS = 12 * 60 * 60 * 1000

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function sessionFrom(cookieHeader: string | undefined): Session | null {
  const raw = /(?:^|;\s*)burrow=([A-Za-z0-9_-]+)/.exec(cookieHeader ?? '')?.[1]
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
}

function viewerFor(req: http.IncomingMessage, opts: HttpOptions): Viewer {
  if (!opts.identity) return { signer: null, label: '' }
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
    }
  }
  // Loopback is the operator: same trust the CLI already gives them, so
  // browsing from your own machine needs no login. BURROW_BUNKER is not
  // consulted here because it would re-pair on every request.
  if (opts.localTrust !== false && isLoopback(req.socket.remoteAddress)) {
    const nsec = process.env['BURROW_NSEC']
    if (nsec !== undefined) {
      try {
        return { signer: localSigner(nsec), label: 'local' }
      } catch {
        // bad key in env; fall through to the stored pairing
      }
    }
    const stored = storedSigner(opts.pairings)
    if (stored) return { signer: stored, label: 'local' }
  }
  return { signer: null, label: '' }
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
  return http.createServer((req, res) => {
    if (!limiter.allow(req.socket.remoteAddress ?? 'unknown')) {
      res.writeHead(429, { 'content-type': 'text/plain' })
      res.end('slow down\n')
      return
    }
    handle(req, opts, store)
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
        res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8', ...r.headers })
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
): Promise<Reply> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = decodeURIComponent(url.pathname)
  const viewer = viewerFor(req, opts)
  const signedIn = viewer.signer !== null

  if (path === '/') return html(200, await welcome(opts, store, signedIn))
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
        page('Bad gopher address', '<h1>Bad gopher address</h1><p>Use /gopher/host/1/selector</p>', signedIn),
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
        page('Blocked', '<h1>Blocked</h1><p>That address is not reachable through this proxy.</p>', signedIn),
      )
    }
    const content = await browseGopher(target, q === null ? undefined : q, connectHost)
    const rendered = renderContentHtml(content)
    return html(
      content.kind === 'error' ? 502 : 200,
      page(rendered.title, rendered.body, signedIn),
    )
  }

  // Everything else is hole content: /<npub>[/path], plus /<npub>/search
  const isSearch = path.endsWith('/search')
  const basePath = isSearch ? path.slice(0, -'/search'.length) || '/' : path
  let route
  try {
    route = parseSelector(basePath)
  } catch (err) {
    const msg = err instanceof SelectorError ? err.message : 'bad address'
    return html(404, page('Not found', `<h1>Not found</h1><p>${esc(msg)}</p>`, signedIn))
  }
  if (route.kind !== 'doc') return redirect('/')

  if (isSearch) {
    const q = url.searchParams.get('q') ?? ''
    const form =
      `<h1>Search</h1>\n<form method="get" action="${esc(`/${route.npub}/search`)}">` +
      `<p><input type="text" name="q" value="${esc(q)}" size="40"></p>` +
      '<p><input type="submit" value="Search"></p></form>'
    if (q === '') return html(200, page('Search', form, signedIn))
    const content = await resolveRoute(
      { kind: 'search', pubkey: route.pubkey, npub: route.npub, path: '/', query: q },
      store,
      { virtual: opts.virtual },
    )
    const rendered = renderContentHtml(content)
    return html(200, page(rendered.title, form + '\n<hr>\n' + rendered.body, signedIn))
  }

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
    '<h1>burrow</h1>',
    '<p>Gopherholes served from Nostr relays. Every hole is a set of',
    'signed Nostr events; relays mirror it, any bridge serves it.</p>',
    '<p>Any npub works, published or not: profiles, notes and long-form',
    'articles are served as a virtual hole.</p>',
    '<form method="get" action="/go"><p>Open a hole: ',
    '<input type="text" name="npub" size="40" placeholder="npub1..."> ',
    '<input type="submit" value="Go"></p></form>',
    '<h2>Traditional gopherspace</h2>',
    '<p>burrow is also a gopher client, so old-school holes render here too.</p>',
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
  return page('burrow', body.join('\n'), signedIn)
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
    body.push('<form method="post" action="/unpair"><p><input type="submit" value="Sign out"></p></form>')
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
  const body = await readBody(req)
  const uri = (body['uri'] ?? '').trim()
  if (uri === '') return redirect('/account')
  try {
    const result = await new Nip46Client().pair(uri)
    const token = randomBytes(24).toString('base64url')
    sessions.set(token, {
      pairing: {
        fingerprint: `http:${token.slice(0, 8)}`,
        userPubkey: result.userPubkey,
        clientSecretKey: result.clientSecretKey,
        bunker: result.bunker,
        pairedAt: Math.floor(Date.now() / 1000),
      },
      expires: Date.now() + SESSION_MS,
    })
    return redirect('/account', {
      'set-cookie': `burrow=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
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
  const raw = /(?:^|;\s*)burrow=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '')?.[1]
  if (raw) sessions.delete(raw)
  return html(
    200,
    page(
      'Signed out',
      '<h1>Signed out</h1><p>Revoke the session on your signer too.</p><p><a href="/">Home</a></p>',
      signedIn && false,
    ),
    { 'set-cookie': 'burrow=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' },
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
    '<p><textarea name="text" rows="6" cols="60"></textarea></p>',
    '<p><input type="submit" value="Sign and post"></p></form>',
  ].join('\n')
  if (req.method !== 'POST') return html(200, page('Write a note', form, signedIn))

  const body = await readBody(req)
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
        `<h1>Posting failed</h1><p>${esc(err instanceof Error ? err.message : 'unknown')}</p>` + form,
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
  const id = (body['id'] ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(id)) return html(400, page('Bad request', '<p>bad event id</p>', signedIn))
  const mine = await viewer.signer.pubkey()
  const existing = await store.event(id)
  if (existing && existing.pubkey !== mine) {
    return html(403, page('Not yours', '<h1>Not yours</h1><p>You can only delete your own events.</p>', signedIn))
  }
  const signed = await viewer.signer.sign({
    kind: DELETE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', id],
      ['k', String(existing?.kind ?? NOTE_KIND)],
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
  opts: HttpOptions,
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
