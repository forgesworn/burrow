#!/usr/bin/env node
import { parseArgs } from 'node:util'
import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
import type { Server as NetServer } from 'node:net'
import * as nip19 from 'nostr-tools/nip19'
import { createGopherServer } from './server.ts'
import { createGeminiServer } from './gemini.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { ensureSelfSignedCert } from './certs.ts'
import { PairingStore } from './identity.ts'
import { Nip46Client } from './nip46client.ts'
import { publishHole, unpublishHole, parseDuration } from './publish.ts'
import {
  cmdRead,
  cmdSearch,
  cmdPost,
  cmdFeed,
  cmdPair,
  cmdUnpair,
  cmdWhoami,
  cmdDelete,
  cmdAnnounce,
  cmdExport,
  cmdInspect,
  packageVersion,
} from './commands.ts'
import { createHttpServer } from './http.ts'
import { resolveSigner, requireSignerIdentity } from './signing.ts'
import { configureProxy } from './netguard.ts'
import { runBrowse } from './browse.ts'
import { BookmarkStore } from './bookmarks.ts'
import { aboutContent } from './about.ts'
import { renderForTerminal } from './cliview.ts'

// relay.trotters.cc is the project's own relay. It is in the defaults as the
// reliability anchor: a general-purpose relay may refuse an unfamiliar kind or
// drop it on retention, and the popular set changed without notice before
// (relay.damus.io rejected every kind 31436 document when this list was
// written; it accepted one in testing on 2026-08-07). A hole published only
// to relays you do not run is readable exactly as long as they feel like
// keeping it. `--relay` replaces this list entirely.
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.trotters.cc',
]

const USAGE = `usage:
  read and browse (no identity needed):
    gopherkind                           interactive browser (also: gopherkind browse)
    gopherkind browse [target]           browse from an npub or gopher:// url
    gopherkind read <target>             print a hole document or gopher page
    gopherkind search <target> <query>   search a hole, or a gopher type 7 endpoint
    gopherkind inspect <npub> [--json]   show current documents visible on each relay
    gopherkind export <npub> <dir>       save a lossless, re-publishable snapshot
    gopherkind feed [--limit 20]         notes from who you follow
    gopherkind why                       the case for gopherholes on nostr
    targets: npub[/path], nostr: entity, name@domain (NIP-05), gopher:// url

  write (needs a signer, see below):
    gopherkind post <text> [--as npub1...] [--dry-run]  sign and broadcast a note
    gopherkind delete <id|note1|nevent1> [--wide] [--dry-run]
    gopherkind publish <dir> [--as npub1...] [--expire 30d] [--dry-run] [--force]
      only signs documents the relays do not already carry unchanged.
      --force signs every one of them regardless.
    gopherkind unpublish </path>... | --all [--as npub1...] [--dry-run]
      --as refuses to sign unless the signer is that npub. Worth using
      whenever one signer holds more than one identity.

  identity:
    gopherkind pair <bunker://...>       store a remote signer for future use
    gopherkind unpair
    gopherkind whoami

  bridge:
    gopherkind serve [--port 7070] [--host 127.0.0.1] [--hostname name] [--public-port n]
                     [--gemini-port 1965] [--no-gemini] [--http-port 8070] [--no-http]
                     [--http-url https://bridge.example] [--http-behind-proxy]
                     [--no-local-trust] [--trust-loopback-anyway]
                     [--cert f --key f] [--state-dir d]
                     [--pin npub1...]... [--home npub1...]
                     [--no-virtual] [--no-identity]
      the http frontend is the one to point lynx at for the full client.
    gopherkind announce --hostname bridge.example [--http-url https://bridge.example]
                        [--gopher-port 70] [--gemini-port 1965] [--no-gemini]
                        [--name n] [--about a] [--as npub1...] [--dry-run]
      tells nostr clients this bridge opens kind 31436 (NIP-89).

  gopherkind version | help

  every command takes [--relay wss://...]..., [--proxy socks5h://host:port]
  and [--state-dir d]. --proxy routes relay connections through a SOCKS5
  proxy (use socks5h so DNS, and any .onion names, resolve at the proxy;
  Tor's default is socks5h://127.0.0.1:9050). GOPHERKIND_PROXY does the same.

  signer resolution: GOPHERKIND_BUNKER (one-off bunker URI), else whatever
  \`gopherkind pair\` stored. User secret keys are never accepted.`

const [command, ...rest] = process.argv.slice(2)

const COMMON = {
  relay: { type: 'string', multiple: true },
  proxy: { type: 'string' },
  'state-dir': { type: 'string' },
} as const

// --proxy is pre-scanned rather than threaded through every parseArgs call
// below. Each command still declares the option so strict parsing accepts it.
{
  const inline = rest.find((a) => a.startsWith('--proxy='))
  const separate = rest.indexOf('--proxy')
  if (inline !== undefined) configureProxy(inline.slice('--proxy='.length))
  else if (separate !== -1 && rest[separate + 1] !== undefined) configureProxy(rest[separate + 1])
}

function stateDirOf(v: { 'state-dir'?: string }): string {
  return v['state-dir'] ?? path.join(os.homedir(), '.gopherkind')
}

function pairingsOf(v: { 'state-dir'?: string }): PairingStore {
  return new PairingStore(path.join(stateDirOf(v), 'pairings.json'))
}

function relaysOf(v: { relay?: string[] }): string[] {
  return v.relay ?? DEFAULT_RELAYS
}

function run(p: Promise<string>): void {
  p.then((out) => {
    process.stdout.write(out)
    process.exit(0)
  }).catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
}

if (command === 'serve') {
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string', default: '7070' },
      host: { type: 'string', default: '127.0.0.1' },
      hostname: { type: 'string' },
      'public-port': { type: 'string' },
      'gemini-port': { type: 'string', default: '1965' },
      'no-gemini': { type: 'boolean', default: false },
      cert: { type: 'string' },
      key: { type: 'string' },
      'state-dir': { type: 'string' },
      relay: { type: 'string', multiple: true },
      pin: { type: 'string', multiple: true },
      home: { type: 'string' },
      'no-virtual': { type: 'boolean', default: false },
      'no-identity': { type: 'boolean', default: false },
      'http-port': { type: 'string', default: '8070' },
      'no-http': { type: 'boolean', default: false },
      'http-url': { type: 'string' },
      'http-behind-proxy': { type: 'boolean', default: false },
      'no-local-trust': { type: 'boolean', default: false },
      'trust-loopback-anyway': { type: 'boolean', default: false },
      proxy: { type: 'string' },
    },
  })
  const port = Number(values.port)
  const relays = values.relay ?? DEFAULT_RELAYS
  const pins = values.pin ?? []
  // Validate here rather than per frontend: a mistyped --home would otherwise
  // fall back to the generic welcome on every surface and look like nothing
  // happened, which is a slow way to find a typo.
  const home = values.home
  if (home !== undefined) {
    try {
      const decoded = nip19.decode(home)
      if (decoded.type !== 'npub') throw new Error('not an npub')
    } catch {
      fail(`--home must be an npub: ${home}`)
    }
  }
  const virtualEnabled = !values['no-virtual']
  const wildcardBind = values.host === '0.0.0.0' || values.host === '::'
  if (wildcardBind && values.hostname === undefined) {
    fail('--hostname is required when --host is a wildcard address')
  }
  const advertisedHost = values.hostname ?? values.host
  if (
    [...advertisedHost].some((char) => {
      const code = char.codePointAt(0) ?? 0
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
    })
  ) {
    fail('bad --hostname')
  }
  const advertisedPort = Number(values['public-port'] ?? values.port)
  const store = new HoleStore(relays)
  const limiter = new RateLimiter()
  const servers: NetServer[] = []

  const serveStateDir = values['state-dir'] ?? path.join(os.homedir(), '.gopherkind')
  const servePairings = new PairingStore(path.join(serveStateDir, 'pairings.json'))
  // Operator trust is granted on connection origin (loopback). Behind a
  // reverse proxy every request originates on loopback, so trusting it when
  // the bridge is bound to a public address would hand the operator's signer
  // to every visitor. Only trust loopback when the bind is itself loopback,
  // unless the operator explicitly overrides.
  const bindIsLoopback =
    values.host === '127.0.0.1' || values.host === '::1' || values.host === 'localhost'
  let publicHttpUrl: string | undefined
  if (values['http-url'] !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(values['http-url'])
    } catch {
      fail('--http-url must be an absolute http(s) origin')
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      fail('--http-url must be an absolute http(s) origin without a path, query or credentials')
    }
    publicHttpUrl = parsed.origin
  }
  const httpBehindProxy = values['http-behind-proxy']
  if (httpBehindProxy) {
    if (values['no-http']) fail('--http-behind-proxy conflicts with --no-http')
    if (publicHttpUrl === undefined || !publicHttpUrl.startsWith('https://')) {
      fail('--http-behind-proxy requires an https --http-url')
    }
    if (!values['no-local-trust']) {
      fail('--http-behind-proxy requires --no-local-trust')
    }
    if (values['no-identity']) fail('--http-behind-proxy conflicts with --no-identity')
  }
  const trustLoopback = bindIsLoopback || values['trust-loopback-anyway']
  if (!bindIsLoopback && !values['no-local-trust'] && !values['trust-loopback-anyway']) {
    console.log(
      '  operator trust is OFF: bound to a non-loopback address. Behind a reverse\n' +
        '  proxy, loopback trust would treat every visitor as you. Bind to 127.0.0.1,\n' +
        '  or pass --trust-loopback-anyway if you understand the risk.',
    )
  }
  const localTrust = !values['no-local-trust'] && !values['no-identity'] && trustLoopback
  const httpIdentity = !values['no-identity'] && (bindIsLoopback || httpBehindProxy)

  // Resolve the operator's signer once and reuse it: resolveSigner may pair a
  // GOPHERKIND_BUNKER, and re-pairing on every /me request would fire a fresh
  // approval prompt at the signer each time. Reset on failure so a transient
  // error doesn't wedge it permanently.
  let cachedSigner: ReturnType<typeof resolveSigner> | undefined
  const signerFactory = localTrust
    ? async () => {
        if (cachedSigner === undefined) cachedSigner = resolveSigner(servePairings)
        try {
          return await cachedSigner
        } catch (err) {
          cachedSigner = undefined
          throw err
        }
      }
    : undefined

  const gopher = createGopherServer({
    relays,
    bridge: { host: advertisedHost, port: advertisedPort },
    pins,
    home,
    virtual: virtualEnabled,
    localTrust,
    signerFactory,
    store,
    limiter,
  })
  servers.push(gopher)
  gopher.listen(port, values.host, () => {
    console.log(
      `gopherkind: gopher on ${values.host}:${port} (advertised as ${advertisedHost}:${advertisedPort})`,
    )
    console.log(`relays: ${relays.join(', ')}`)
    if (!virtualEnabled) console.log('virtual holes: off')
    if (localTrust) console.log('  loopback gets /me: feed, follows, post, delete')
  })

  if (!values['no-gemini']) {
    try {
      const stateDir = values['state-dir'] ?? path.join(os.homedir(), '.gopherkind')
      const certs =
        values.cert !== undefined && values.key !== undefined
          ? { cert: values.cert, key: values.key }
          : ensureSelfSignedCert(stateDir, advertisedHost)
      const geminiPort = Number(values['gemini-port'])
      const identity = values['no-identity']
        ? undefined
        : {
            pairings: servePairings,
            signer: new Nip46Client(),
            appName: `gopherkind (${advertisedHost})`,
          }
      const gemini = createGeminiServer({
        relays,
        pins,
        home,
        virtual: virtualEnabled,
        identity,
        certFile: certs.cert,
        keyFile: certs.key,
        store,
        limiter,
      })
      servers.push(gemini)
      gemini.listen(geminiPort, values.host, () => {
        console.log(
          `gopherkind: gemini on ${values.host}:${geminiPort}${identity ? ' (sign-in enabled)' : ''}`,
        )
      })
    } catch (err) {
      console.error(`gemini disabled: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!values['no-http']) {
    const httpPort = Number(values['http-port'])
    const httpLocalTrust = !values['no-local-trust'] && !values['no-identity'] && trustLoopback
    const http = createHttpServer({
      relays,
      pins,
      home,
      virtual: virtualEnabled,
      identity: httpIdentity,
      pairings: servePairings,
      localTrust: httpLocalTrust,
      store,
      limiter: new RateLimiter(60, 2),
      publicUrl: publicHttpUrl,
      trustedProxy: httpBehindProxy,
    })
    servers.push(http)
    http.listen(httpPort, values.host, () => {
      console.log(
        `gopherkind: http on ${values.host}:${httpPort}  (lynx http://localhost:${httpPort}/)`,
      )
      if (httpLocalTrust) console.log('  loopback requests act as you, using your stored pairing')
      if (httpBehindProxy) {
        console.log(`  HTTP identity is ON behind the explicit TLS proxy at ${publicHttpUrl}`)
      } else if (!bindIsLoopback) {
        console.log('  HTTP identity is OFF on a public bind; plain HTTP is read-only.')
      }
    })
  }

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`gopherkind: ${signal}, closing listeners`)
    let open = servers.length
    const finish = (): void => {
      store.close()
      process.exit(0)
    }
    const forced = setTimeout(finish, 10_000)
    forced.unref()
    for (const server of servers) {
      server.close(() => {
        open--
        if (open === 0) {
          clearTimeout(forced)
          finish()
        }
      })
    }
    if (open === 0) finish()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
} else if (command === 'publish') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      ...COMMON,
      expire: { type: 'string' },
      as: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
  const dir = positionals[0]
  if (dir === undefined) fail(USAGE)
  resolveSigner(pairingsOf(values))
    .then((signer) => requireSignerIdentity(signer, values.as))
    .then((signer) =>
      publishHole(dir, values.relay ?? DEFAULT_RELAYS, signer, {
        dryRun: values['dry-run'],
        force: values.force,
        expireSeconds: values.expire !== undefined ? parseDuration(values.expire) : undefined,
      }),
    )
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else if (command === 'unpublish') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      ...COMMON,
      all: { type: 'boolean', default: false },
      as: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (!values.all && positionals.length === 0) fail(USAGE)
  resolveSigner(pairingsOf(values))
    .then((signer) => requireSignerIdentity(signer, values.as))
    .then((signer) =>
      unpublishHole(
        values.all ? 'all' : positionals,
        values.relay ?? DEFAULT_RELAYS,
        signer,
        values['dry-run'],
      ),
    )
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else if (command === 'browse' || (command === undefined && process.stdin.isTTY === true)) {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, 'no-virtual': { type: 'boolean', default: false } },
  })
  runBrowse(positionals[0], {
    relays: relaysOf(values),
    pairings: pairingsOf(values),
    bookmarks: new BookmarkStore(path.join(stateDirOf(values), 'bookmarks.json')),
    virtual: !values['no-virtual'],
  })
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else if (command === 'read') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, 'no-virtual': { type: 'boolean', default: false } },
  })
  const target = positionals[0]
  if (target === undefined) fail('usage: gopherkind read <npub[/path] or gopher://...>')
  run(cmdRead(target, relaysOf(values), !values['no-virtual']))
} else if (command === 'search') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, 'no-virtual': { type: 'boolean', default: false } },
  })
  const target = positionals[0]
  const query = positionals.slice(1).join(' ')
  if (target === undefined || query === '') fail('usage: gopherkind search <target> <query>')
  run(cmdSearch(target, query, relaysOf(values), !values['no-virtual']))
} else if (command === 'inspect') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, json: { type: 'boolean', default: false } },
  })
  const target = positionals[0]
  if (target === undefined) fail('usage: gopherkind inspect <npub|nprofile|name@domain>')
  run(cmdInspect(target, relaysOf(values), values.json))
} else if (command === 'export') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, force: { type: 'boolean', default: false } },
  })
  const target = positionals[0]
  const outputDir = positionals[1]
  if (target === undefined || outputDir === undefined) {
    fail('usage: gopherkind export <npub|nprofile|name@domain> <dir> [--force]')
  }
  run(cmdExport(target, outputDir, relaysOf(values), values.force))
} else if (command === 'post') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      ...COMMON,
      'dry-run': { type: 'boolean', default: false },
      as: { type: 'string' },
    },
  })
  const text = positionals.join(' ')
  if (text.trim() === '') fail('usage: gopherkind post <text>')
  // A note is as much an identity claim as a document is, and the signer that
  // answers is whichever bunker happens to be running. publish has refused a
  // mismatch since 0.16.2; there was no reason for post not to.
  resolveSigner(pairingsOf(values))
    .then((signer) => requireSignerIdentity(signer, values.as))
    .then((signer) =>
      cmdPost(text, relaysOf(values), pairingsOf(values), values['dry-run'], signer),
    )
    .then((out) => {
      process.stdout.write(out)
      process.exit(0)
    })
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else if (command === 'delete') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      ...COMMON,
      'dry-run': { type: 'boolean', default: false },
      wide: { type: 'boolean', default: false },
      reason: { type: 'string' },
    },
  })
  const target = positionals[0]
  if (target === undefined) fail('usage: gopherkind delete <id|note1...|nevent1...> [--wide]')
  run(
    cmdDelete(target, relaysOf(values), pairingsOf(values), {
      dryRun: values['dry-run'],
      wide: values.wide,
      reason: values.reason,
    }),
  )
} else if (command === 'feed') {
  const { values } = parseArgs({
    args: rest,
    options: { ...COMMON, limit: { type: 'string', default: '20' } },
  })
  run(cmdFeed(relaysOf(values), pairingsOf(values), Number(values.limit)))
} else if (command === 'pair') {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: COMMON })
  const uri = positionals[0]
  if (uri === undefined) fail('usage: gopherkind pair <bunker://... or user@domain>')
  run(cmdPair(uri, pairingsOf(values)))
} else if (command === 'announce') {
  const { values } = parseArgs({
    args: rest,
    options: {
      ...COMMON,
      hostname: { type: 'string' },
      name: { type: 'string' },
      about: { type: 'string' },
      'gopher-port': { type: 'string', default: '70' },
      'gemini-port': { type: 'string', default: '1965' },
      'no-gemini': { type: 'boolean', default: false },
      'http-url': { type: 'string' },
      identifier: { type: 'string', default: 'gopherkind-bridge' },
      as: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const hostname = values.hostname
  if (hostname === undefined) {
    fail('usage: gopherkind announce --hostname bridge.example [--http-url https://bridge.example]')
  }
  run(
    cmdAnnounce(
      {
        name: values.name ?? `gopherkind bridge at ${hostname}`,
        about: values.about ?? 'Serves kind 31436 gopherholes over gopher, gemini and http.',
        hostname,
        gopherPort: Number(values['gopher-port']),
        geminiPort: values['no-gemini'] ? null : Number(values['gemini-port']),
        httpUrl: values['http-url'] ?? null,
        identifier: values.identifier,
      },
      relaysOf(values),
      pairingsOf(values),
      values['dry-run'],
      values.as,
    ),
  )
} else if (command === 'unpair') {
  const { values } = parseArgs({ args: rest, options: COMMON })
  process.stdout.write(cmdUnpair(pairingsOf(values)))
} else if (command === 'whoami') {
  const { values } = parseArgs({ args: rest, options: COMMON })
  run(cmdWhoami(relaysOf(values), pairingsOf(values)))
} else if (command === 'why' || command === 'about') {
  process.stdout.write(renderForTerminal(aboutContent('your terminal')))
} else if (command === 'version' || command === '--version' || command === '-v') {
  process.stdout.write(`${packageVersion()}\n`)
} else if (command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(`${USAGE}\n`)
} else {
  fail(USAGE)
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
