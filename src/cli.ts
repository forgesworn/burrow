#!/usr/bin/env node
import { parseArgs } from 'node:util'
import process from 'node:process'
import { createGopherServer } from './server.ts'
import { publishHole, decodeSecret } from './publish.ts'

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

const [command, ...rest] = process.argv.slice(2)

if (command === 'serve') {
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string', default: '7070' },
      host: { type: 'string', default: '0.0.0.0' },
      hostname: { type: 'string' },
      'public-port': { type: 'string' },
      relay: { type: 'string', multiple: true },
      pin: { type: 'string', multiple: true },
    },
  })
  const port = Number(values.port)
  const relays = values.relay ?? DEFAULT_RELAYS
  const advertisedHost = values.hostname ?? (values.host === '0.0.0.0' ? 'localhost' : values.host)
  const advertisedPort = Number(values['public-port'] ?? values.port)
  const server = createGopherServer({
    relays,
    bridge: { host: advertisedHost, port: advertisedPort },
    pins: values.pin ?? [],
  })
  server.listen(port, values.host, () => {
    console.log(`burrow: gopher on ${values.host}:${port} (advertised as ${advertisedHost}:${advertisedPort})`)
    console.log(`relays: ${relays.join(', ')}`)
  })
} else if (command === 'publish') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      relay: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const dir = positionals[0]
  if (dir === undefined) fail('usage: burrow publish <dir> [--relay wss://...] [--dry-run]')
  const secretRaw = process.env['BURROW_NSEC']
  if (secretRaw === undefined) fail('set BURROW_NSEC (nsec1... or 64 hex chars) to sign the hole')
  publishHole(dir, values.relay ?? DEFAULT_RELAYS, decodeSecret(secretRaw), values['dry-run'])
    .then(() => process.exit(0))
    .catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
} else {
  fail('usage: burrow <serve|publish> ...')
}

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}
