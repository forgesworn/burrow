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

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

const USAGE = `usage:
  burrow serve [--port 7070] [--host 0.0.0.0] [--hostname name] [--public-port n]
               [--gemini-port 1965] [--no-gemini] [--cert f --key f] [--state-dir d]
               [--relay wss://...]... [--pin npub1...]... [--no-virtual] [--no-identity]
  burrow publish <dir> [--relay wss://...]... [--expire 30d] [--dry-run]
  burrow unpublish </path>... | --all [--relay wss://...]... [--dry-run]`

const [command, ...rest] = process.argv.slice(2)

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

  const gopher = createGopherServer({
    relays,
    bridge: { host: advertisedHost, port: advertisedPort },
    pins,
    virtual: virtualEnabled,
    store,
    limiter,
  })
  gopher.listen(port, values.host, () => {
    console.log(
      `burrow: gopher on ${values.host}:${port} (advertised as ${advertisedHost}:${advertisedPort})`,
    )
    console.log(`relays: ${relays.join(', ')}`)
    if (!virtualEnabled) console.log('virtual holes: off')
  })

  if (!values['no-gemini']) {
    try {
      const stateDir = values['state-dir'] ?? path.join(os.homedir(), '.burrow')
      const certs =
        values.cert !== undefined && values.key !== undefined
          ? { cert: values.cert, key: values.key }
          : ensureSelfSignedCert(stateDir, advertisedHost)
      const geminiPort = Number(values['gemini-port'])
      const identity = values['no-identity']
        ? undefined
        : {
            pairings: new PairingStore(path.join(stateDir, 'pairings.json')),
            signer: new Nip46Client(),
            appName: `burrow (${advertisedHost})`,
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
          `burrow: gemini on ${values.host}:${geminiPort}${identity ? ' (sign-in enabled)' : ''}`,
        )
      })
    } catch (err) {
      console.error(`gemini disabled: ${err instanceof Error ? err.message : String(err)}`)
    }
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
  unpublishHole(values.all ? 'all' : positionals, values.relay ?? DEFAULT_RELAYS, secretFromEnv(), values['dry-run'])
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else {
  fail(USAGE)
}

function secretFromEnv(): Uint8Array {
  const raw = process.env['BURROW_NSEC']
  if (raw === undefined) fail('set BURROW_NSEC (nsec1... or 64 hex chars) to sign as your hole')
  return decodeSecret(raw)
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
