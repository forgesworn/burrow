#!/usr/bin/env node
import { parseArgs } from 'node:util'
import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
import { createGopherServer } from './server.ts'
import { createGeminiServer } from './gemini.ts'
import { HoleStore } from './fetch.ts'
import { RateLimiter } from './ratelimit.ts'
import { ensureSelfSignedCert } from './certs.ts'
import { PairingStore } from './identity.ts'
import { Nip46Client } from './nip46client.ts'
import { publishHole, unpublishHole, decodeSecret, parseDuration } from './publish.ts'
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
} from './commands.ts'
import { createHttpServer } from './http.ts'
import { resolveSigner } from './signing.ts'
import { runBrowse } from './browse.ts'
import { BookmarkStore } from './bookmarks.ts'

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

const USAGE = `usage:
  read and browse (no identity needed):
    gopherkind                           interactive browser (also: gopherkind browse)
    gopherkind browse [target]           browse from an npub or gopher:// url
    gopherkind read <target>             print a hole document or gopher page
    gopherkind search <target> <query>   search a hole, or a gopher type 7 endpoint
    gopherkind feed [--limit 20]         notes from who you follow
    targets: npub[/path], nostr: entity, name@domain (NIP-05), gopher:// url

  write (needs a signer, see below):
    gopherkind post <text> [--dry-run]   sign and broadcast a kind 1 note
    gopherkind delete <id|note1|nevent1> [--wide] [--dry-run]
    gopherkind publish <dir> [--expire 30d] [--dry-run]
    gopherkind unpublish </path>... | --all [--dry-run]

  identity:
    gopherkind pair <bunker://...>       store a remote signer for future use
    gopherkind unpair
    gopherkind whoami

  bridge:
    gopherkind serve [--port 7070] [--host 0.0.0.0] [--hostname name] [--public-port n]
                     [--gemini-port 1965] [--no-gemini] [--http-port 8070] [--no-http]
                     [--no-local-trust] [--trust-loopback-anyway]
                     [--cert f --key f] [--state-dir d]
                     [--pin npub1...]... [--no-virtual] [--no-identity]
      the http frontend is the one to point lynx at for the full client.
    gopherkind announce --hostname bridge.example [--http-url https://bridge.example]
                        [--gopher-port 70] [--gemini-port 1965] [--no-gemini]
                        [--name n] [--about a] [--dry-run]
      tells nostr clients this bridge opens kind 31436 (NIP-89).

  every command takes [--relay wss://...]... and [--state-dir d].

  signer resolution: GOPHERKIND_NSEC (local key), else GOPHERKIND_BUNKER (one-off
  bunker URI), else whatever \`gopherkind pair\` stored.`

const [command, ...rest] = process.argv.slice(2)

const COMMON = {
  relay: { type: 'string', multiple: true },
  'state-dir': { type: 'string' },
} as const

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
      host: { type: 'string', default: '0.0.0.0' },
      hostname: { type: 'string' },
      'public-port': { type: 'string' },
      'gemini-port': { type: 'string', default: '1965' },
      'no-gemini': { type: 'boolean', default: false },
      cert: { type: 'string' },
      key: { type: 'string' },
      'state-dir': { type: 'string' },
      relay: { type: 'string', multiple: true },
      pin: { type: 'string', multiple: true },
      'no-virtual': { type: 'boolean', default: false },
      'no-identity': { type: 'boolean', default: false },
      'http-port': { type: 'string', default: '8070' },
      'no-http': { type: 'boolean', default: false },
      'no-local-trust': { type: 'boolean', default: false },
      'trust-loopback-anyway': { type: 'boolean', default: false },
    },
  })
  const port = Number(values.port)
  const relays = values.relay ?? DEFAULT_RELAYS
  const pins = values.pin ?? []
  const virtualEnabled = !values['no-virtual']
  const advertisedHost = values.hostname ?? (values.host === '0.0.0.0' ? 'localhost' : values.host)
  const advertisedPort = Number(values['public-port'] ?? values.port)
  const store = new HoleStore(relays)
  const limiter = new RateLimiter()

  const serveStateDir = values['state-dir'] ?? path.join(os.homedir(), '.gopherkind')
  const servePairings = new PairingStore(path.join(serveStateDir, 'pairings.json'))
  // Operator trust is granted on connection origin (loopback). Behind a
  // reverse proxy every request originates on loopback, so trusting it when
  // the bridge is bound to a public address would hand the operator's signer
  // to every visitor. Only trust loopback when the bind is itself loopback,
  // unless the operator explicitly overrides.
  const bindIsLoopback =
    values.host === '127.0.0.1' || values.host === '::1' || values.host === 'localhost'
  const trustLoopback = bindIsLoopback || values['trust-loopback-anyway']
  if (!bindIsLoopback && !values['no-local-trust'] && !values['trust-loopback-anyway']) {
    console.log(
      '  operator trust is OFF: bound to a non-loopback address. Behind a reverse\n' +
        '  proxy, loopback trust would treat every visitor as you. Bind to 127.0.0.1,\n' +
        '  or pass --trust-loopback-anyway if you understand the risk.',
    )
  }
  const localTrust = !values['no-local-trust'] && !values['no-identity'] && trustLoopback

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
    virtual: virtualEnabled,
    localTrust,
    signerFactory,
    store,
    limiter,
  })
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
      createGeminiServer({
        relays,
        pins,
        virtual: virtualEnabled,
        identity,
        certFile: certs.cert,
        keyFile: certs.key,
        store,
        limiter,
      }).listen(geminiPort, values.host, () => {
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
    const httpLocalTrust = !values['no-local-trust'] && trustLoopback
    createHttpServer({
      relays,
      pins,
      virtual: virtualEnabled,
      identity: !values['no-identity'],
      pairings: servePairings,
      localTrust: httpLocalTrust,
      store,
      limiter: new RateLimiter(60, 2),
    }).listen(httpPort, values.host, () => {
      console.log(
        `gopherkind: http on ${values.host}:${httpPort}  (lynx http://localhost:${httpPort}/)`,
      )
      if (httpLocalTrust) console.log('  loopback requests act as you, using your stored pairing')
      if (values.host !== '127.0.0.1' && values.host !== 'localhost') {
        console.log('  note: plain HTTP. Put it behind TLS before exposing it publicly.')
      }
    })
  }
} else if (command === 'publish') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      relay: { type: 'string', multiple: true },
      expire: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const dir = positionals[0]
  if (dir === undefined) fail(USAGE)
  publishHole(dir, values.relay ?? DEFAULT_RELAYS, secretFromEnv(), {
    dryRun: values['dry-run'],
    expireSeconds: values.expire !== undefined ? parseDuration(values.expire) : undefined,
  })
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else if (command === 'unpublish') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      relay: { type: 'string', multiple: true },
      all: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (!values.all && positionals.length === 0) fail(USAGE)
  unpublishHole(
    values.all ? 'all' : positionals,
    values.relay ?? DEFAULT_RELAYS,
    secretFromEnv(),
    values['dry-run'],
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
} else if (command === 'post') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { ...COMMON, 'dry-run': { type: 'boolean', default: false } },
  })
  const text = positionals.join(' ')
  if (text.trim() === '') fail('usage: gopherkind post <text>')
  run(cmdPost(text, relaysOf(values), pairingsOf(values), values['dry-run']))
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
    ),
  )
} else if (command === 'unpair') {
  const { values } = parseArgs({ args: rest, options: COMMON })
  process.stdout.write(cmdUnpair(pairingsOf(values)))
} else if (command === 'whoami') {
  const { values } = parseArgs({ args: rest, options: COMMON })
  run(cmdWhoami(relaysOf(values), pairingsOf(values)))
} else {
  fail(USAGE)
}

function secretFromEnv(): Uint8Array {
  const raw = process.env['GOPHERKIND_NSEC']
  if (raw === undefined) fail('set GOPHERKIND_NSEC (nsec1... or 64 hex chars) to sign as your hole')
  return decodeSecret(raw)
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
