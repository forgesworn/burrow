import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { parseProxyPath, proxyPath, parseGopherMenu, browseGopher } from '../src/gopherclient.ts'

test('proxy paths round-trip', () => {
  assert.deepEqual(parseProxyPath('/gopher/example.org/1/foo/bar'), {
    host: 'example.org',
    port: 70,
    type: '1',
    selector: 'foo/bar',
  })
  assert.deepEqual(parseProxyPath('/gopher/example.org:7070/0/x'), {
    host: 'example.org',
    port: 7070,
    type: '0',
    selector: 'x',
  })
  assert.deepEqual(parseProxyPath('/gopher/example.org'), {
    host: 'example.org',
    port: 70,
    type: '1',
    selector: '',
  })
  assert.equal(parseProxyPath('/notgopher/x'), null)
  assert.equal(parseProxyPath('/gopher/example.org:99999/1/'), null)

  assert.equal(proxyPath({ host: 'a.org', port: 70, type: '1', selector: '/x' }), '/gopher/a.org/1/x')
  assert.equal(
    proxyPath({ host: 'a.org', port: 7070, type: '0', selector: '' }),
    '/gopher/a.org:7070/0',
  )
})

test('gopher menus parse into menu items', () => {
  const body = [
    'iWelcome\t-\terror.host\t1',
    '1Subdir\t/sub\tgopher.example\t70',
    '0A file\t/file.txt\tgopher.example\t70',
    'hWebsite\tURL:https://example.com\tgopher.example\t70',
    '3Something broke\t-\terror.host\t1',
    '.',
    'ignored after dot\t-\terror.host\t1',
  ].join('\r\n')
  const items = parseGopherMenu(body)
  assert.equal(items.length, 5)
  assert.deepEqual(items[0], { type: 'i', display: 'Welcome', target: { scheme: 'none' } })
  assert.deepEqual(items[1]?.target, {
    scheme: 'gopher',
    host: 'gopher.example',
    port: 70,
    itemType: '1',
    selector: '/sub',
  })
  assert.deepEqual(items[3]?.target, { scheme: 'web', url: 'https://example.com' })
  assert.equal(items[4]?.target.scheme, 'none')
})

test('browses a local gopher server end to end', async (t) => {
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      const sel = chunk.toString('utf8').trim()
      if (sel === '/text') {
        socket.end('line one\r\n..dotted\r\n.\r\n')
      } else {
        socket.end('iHello\t-\terror.host\t1\r\n1Dir\t/d\tlocal.test\t70\r\n.\r\n')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  const port = (server.address() as net.AddressInfo).port

  const menu = await browseGopher({ host: '127.0.0.1', port, type: '1', selector: '' })
  assert.equal(menu.kind, 'menu')
  assert.match(menu.title, /^gopher:\/\/127\.0\.0\.1:/)
  if (menu.kind === 'menu') {
    assert.equal(menu.items.length, 2)
    assert.equal(menu.items[1]?.display, 'Dir')
  }

  const text = await browseGopher({ host: '127.0.0.1', port, type: '0', selector: '/text' })
  assert.equal(text.kind, 'text')
  if (text.kind === 'text') assert.equal(text.body, 'line one\n.dotted')
})

test('unreachable host is an error content, not a throw', async () => {
  const res = await browseGopher({ host: '127.0.0.1', port: 1, type: '1', selector: '' })
  assert.equal(res.kind, 'error')
})
