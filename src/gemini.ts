import tls from 'node:tls'
import { readFileSync } from 'node:fs'
import * as nip19 from 'nostr-tools/nip19'
import { parseSelector, SelectorError } from './selector.ts'
import { resolveRoute, type Content } from './router.ts'
import { renderGemtextMenu } from './gemtext.ts'
import type { MenuItem } from './resolve.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { parseProfile, displayName } from './virtual.ts'
import { NOTE_KIND, firstLine, isoDate } from './protocol.ts'
import type { PairingStore, Pairing } from './identity.ts'
import type { RemoteSigner, PairResult } from './nip46client.ts'

// Gemini frontend: same holes, same router, gemtext out. On top of the
// read side, client certificates give a signed-in experience: /pair binds
// a cert to a NIP-46 bunker (Heartwood, Amber, nsecBunker, nsec.app...),
// /post signs kind 1 notes through it, /feed renders your follows. The
// bridge never holds a user key; it only ever asks a bunker to sign.

export interface IdentityService {
  pairings: PairingStore
  signer: RemoteSigner
  // shown to the signer as the requesting app's name
  appName: string
}

interface PendingConnect {
  uri: string
  state: 'waiting' | 'done' | 'failed'
  error?: string
}

export interface GeminiContext {
  relays: string[]
  pins: string[]
  virtual: boolean
  identity?: IdentityService
}

export interface GeminiOptions extends GeminiContext {
  certFile: string
  keyFile: string
  store?: HoleStore
  limiter?: RateLimiter
}

export interface ClientCert {
  fingerprint: string
}

const RESERVED = new Set(['account', 'pair', 'post', 'feed', 'unpair'])
const pendingConnects = new Map<string, PendingConnect>()

export function createGeminiServer(opts: GeminiOptions): tls.Server {
  const store = opts.store ?? new HoleStore(opts.relays)
  const limiter = opts.limiter ?? new RateLimiter()
  return tls.createServer(
    {
      cert: readFileSync(opts.certFile),
      key: readFileSync(opts.keyFile),
      requestCert: true,
      rejectUnauthorized: false,
    },
    (socket) => {
      if (!limiter.allow(socket.remoteAddress ?? 'unknown')) {
        socket.end('44 slow down\r\n')
        return
      }
      const peer = socket.getPeerCertificate()
      const cert: ClientCert | null =
        peer && typeof peer === 'object' && 'fingerprint256' in peer && peer.fingerprint256
          ? { fingerprint: peer.fingerprint256 }
          : null
      socket.setTimeout(90_000, () => socket.destroy())
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
        respondGemini(line, opts, store, cert)
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
  cert: ClientCert | null = null,
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

  const head = rawPath.split('/').filter((s) => s !== '')[0] ?? ''
  if (RESERVED.has(head)) return accountRoutes(rawPath, query, ctx, store, cert)

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

async function accountRoutes(
  rawPath: string,
  query: string,
  ctx: GeminiContext,
  store: HoleStore,
  cert: ClientCert | null,
): Promise<string> {
  const id = ctx.identity
  if (!id) return '51 identity features are disabled on this bridge\r\n'
  if (!cert) return '60 client certificate required (make one in your client and retry)\r\n'
  const pairing = id.pairings.get(cert.fingerprint)

  switch (rawPath) {
    case '/account': {
      if (!pairing) {
        return page('Your account', [
          'This certificate is not paired with a signer yet.',
          '',
          'Pairing connects a NIP-46 remote signer (Heartwood, Amber,',
          'nsecBunker, nsec.app and friends). Your key stays on the',
          'signer; this bridge only ever asks it to sign.',
          '',
          '=> /pair Paste a bunker:// URI',
          '=> /pair/connect Cross-device connect (nostrconnect://)',
        ])
      }
      const npub = nip19.npubEncode(pairing.userPubkey)
      const profile = parseProfile(await store.profile(pairing.userPubkey))
      return page('Your account', [
        `Signed in as ${displayName(profile, npub)}`,
        npub,
        '',
        '=> /post Write a note',
        '=> /feed Your feed',
        `=> /${npub} Your hole`,
        '=> /unpair Unpair this certificate',
      ])
    }

    case '/pair': {
      if (pairing) return '30 /account\r\n'
      if (query === '') {
        return '10 Paste your bunker:// URI (from Signet, Amber, nsecBunker...)\r\n'
      }
      try {
        const result = await id.signer.pair(query)
        savePairing(id, cert, result)
        return '30 /account\r\n'
      } catch (err) {
        return page('Pairing failed', [
          err instanceof Error ? err.message : 'unknown error',
          '',
          '=> /pair Try again',
          '=> /pair/connect Or use cross-device connect',
        ])
      }
    }

    case '/pair/connect': {
      if (pairing) return '30 /account\r\n'
      let pending = pendingConnects.get(cert.fingerprint)
      if (!pending || pending.state === 'failed') {
        const { uri, finish } = id.signer.startConnect(ctx.relays, id.appName)
        pending = { uri, state: 'waiting' }
        pendingConnects.set(cert.fingerprint, pending)
        const mine = pending
        finish
          .then((result) => {
            savePairing(id, cert, result)
            mine.state = 'done'
          })
          .catch((err: unknown) => {
            mine.state = 'failed'
            mine.error = err instanceof Error ? err.message : 'connect failed'
          })
      }
      return page('Cross-device connect', [
        'Open your signer app and paste (or scan) this URI:',
        '',
        '```',
        pending.uri,
        '```',
        '',
        'Approve the connection there, then check back:',
        '',
        '=> /pair/status Check status',
      ])
    }

    case '/pair/status': {
      if (pairing) return '30 /account\r\n'
      const pending = pendingConnects.get(cert.fingerprint)
      if (!pending) return '30 /pair/connect\r\n'
      if (pending.state === 'waiting') {
        return page('Waiting for your signer', [
          'No approval yet. Approve the connection on your signer, then:',
          '',
          '=> /pair/status Check again',
        ])
      }
      if (pending.state === 'done') {
        pendingConnects.delete(cert.fingerprint)
        return '30 /account\r\n'
      }
      pendingConnects.delete(cert.fingerprint)
      return page('Connect failed', [
        pending.error ?? 'unknown error',
        '',
        '=> /pair/connect Start over',
      ])
    }

    case '/post': {
      if (!pairing) return '30 /account\r\n'
      if (query === '') return '10 Your note (posted as kind 1)\r\n'
      const content = query.trim()
      if (content === '') return '10 Your note (posted as kind 1)\r\n'
      if (content.length > 1200) return '59 note too long for a URL line\r\n'
      try {
        const signed = await id.signer.sign(pairing, {
          kind: NOTE_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content,
        })
        const accepted = await store.publish(signed)
        const npub = nip19.npubEncode(signed.pubkey)
        return page('Posted', [
          `Accepted by ${accepted}/${ctx.relays.length} relays.`,
          '',
          `=> /${npub}/notes/${signed.id} View your note`,
          '=> /post Write another',
          '=> /account Account',
        ])
      } catch (err) {
        return page('Posting failed', [
          err instanceof Error ? err.message : 'unknown error',
          '',
          '=> /post Try again',
        ])
      }
    }

    case '/feed': {
      if (!pairing) return '30 /account\r\n'
      const follows = await store.contacts(pairing.userPubkey)
      if (follows.length === 0) {
        return page('Your feed', ['No follows found (kind 3 is empty or unreachable).'])
      }
      const notes = await store.feedNotes(follows.slice(0, 100))
      const profiles = await store.profilesBatch(notes.map((n) => n.pubkey))
      const items: MenuItem[] = notes.map((ev) => {
        const authorNpub = nip19.npubEncode(ev.pubkey)
        const name = displayName(parseProfile(profiles.get(ev.pubkey) ?? null), authorNpub)
        return {
          type: '0',
          display: `${isoDate(ev.created_at)}  ${name}: ${firstLine(ev.content)}`,
          target: { scheme: 'hole', npub: authorNpub, path: `/notes/${ev.id}` },
        }
      })
      if (items.length === 0) {
        return page('Your feed', ['Nothing recent from your follows on these relays.'])
      }
      return `20 text/gemini; charset=utf-8\r\n${renderGemtextMenu('Your feed', items)}`
    }

    case '/unpair': {
      if (!pairing) return '30 /account\r\n'
      id.pairings.delete(cert.fingerprint)
      return page('Unpaired', [
        'This certificate is no longer linked to a signer. You can also',
        'revoke the session on the signer itself.',
        '',
        '=> /account Account',
      ])
    }

    default:
      return '51 no such page\r\n'
  }
}

function savePairing(id: IdentityService, cert: ClientCert, result: PairResult): void {
  const pairing: Pairing = {
    fingerprint: cert.fingerprint,
    userPubkey: result.userPubkey,
    clientSecretKey: result.clientSecretKey,
    bunker: result.bunker,
    pairedAt: Math.floor(Date.now() / 1000),
  }
  id.pairings.set(pairing)
}

function page(title: string, lines: string[]): string {
  return `20 text/gemini; charset=utf-8\r\n# ${title}\n\n${lines.join('\n')}\n`
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
  ]
  if (ctx.identity) {
    lines.push('', '=> /account Sign in (client certificate + your Nostr signer)')
  }
  lines.push('', `Relays: ${ctx.relays.join(', ')}`)
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
