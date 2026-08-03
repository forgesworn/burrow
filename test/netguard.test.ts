import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isBlockedAddress,
  resolvePublicHost,
  BlockedHostError,
  urlHostBlocked,
  publicLookup,
  publicRelayUrls,
} from '../src/netguard.ts'
import { fetchGopher } from '../src/gopherclient.ts'

test('loopback, private, link-local and metadata addresses are blocked', () => {
  for (const ip of [
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '192.0.2.1', // documentation
    '198.51.100.2', // documentation
    '203.0.113.9', // documentation
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:0:7f00:1',
    '::7f00:1',
    '::ffff:10.0.0.1',
    'fe80::1',
    'fd00::1',
    '2001:db8::1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`)
  }
})

test('public addresses are allowed', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`)
  }
})

test('a non-literal host is treated as blocked until resolved', () => {
  assert.equal(isBlockedAddress('gopher.floodgap.com'), true)
})

test('resolvePublicHost refuses a private IP literal', async () => {
  await assert.rejects(resolvePublicHost('10.0.0.1'), BlockedHostError)
  await assert.rejects(resolvePublicHost('169.254.169.254'), BlockedHostError)
})

test('resolvePublicHost returns a validated public IP literal unchanged', async () => {
  assert.equal(await resolvePublicHost('8.8.8.8'), '8.8.8.8')
})

test('urlHostBlocked flags private and local hosts but passes public hostnames', () => {
  assert.equal(urlHostBlocked('wss://10.0.0.1'), true)
  assert.equal(urlHostBlocked('wss://[::1]:4869'), true)
  assert.equal(urlHostBlocked('wss://relay.example.com'), false)
  assert.equal(urlHostBlocked('wss://1.1.1.1'), false)
  assert.equal(urlHostBlocked('ws://localhost:4869'), true)
  assert.equal(urlHostBlocked('wss://relay.local'), true)
})

test('untrusted relay filtering rejects local names before connection', async () => {
  assert.deepEqual(await publicRelayUrls(['ws://localhost:4869', 'wss://relay.local']), [])
})

test('connection-time DNS lookup refuses loopback answers', async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    publicLookup('localhost', { family: 0, hints: 0, all: false }, (lookupErr) => {
      resolve(lookupErr)
    })
  })
  assert.equal(err?.code, 'EACCES')
})

test('fetchGopher refuses a selector carrying CR or LF', async () => {
  await assert.rejects(
    fetchGopher({ host: '10.0.0.1', port: 6379, type: '1', selector: 'x' }, '\r\nINFO\r\nQUIT'),
    /bad selector/,
  )
})
