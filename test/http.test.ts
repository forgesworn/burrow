import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import http from 'node:http'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as nip19 from 'nostr-tools/nip19'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { createHttpServer, type HttpOptions } from '../src/http.ts'
import { PairingStore } from '../src/identity.ts'
import { esc } from '../src/html.ts'
import { makeStore, npub, note, pubkey, testSigner } from './helpers.ts'

// The loopback operator's forms carry a server-lifetime CSRF token; grab it
// from the /post form to drive the write endpoints the way lynx would.
async function operatorCsrf(base: string): Promise<string> {
  const form = await (await fetch(`${base}/post`)).text()
  return /name="csrf" value="([^"]+)"/.exec(form)?.[1] ?? ''
}

function withRemoteSigner<T>(fn: () => Promise<T>): Promise<T> {
  return fn()
}

async function start(
  t: { after: (fn: () => void) => void },
  overrides: Partial<HttpOptions> = {},
  published: unknown[] = [],
): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'gopherkind-http-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createHttpServer({
    relays: ['wss://stub.invalid'],
    pins: [npub],
    virtual: true,
    identity: true,
    pairings: new PairingStore(path.join(dir, 'pairings.json')),
    operatorSigner: testSigner,
    store: makeStore(published),
    ...overrides,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  t.after(() => server.close())
  return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`
}

test('html escaping closes the obvious hole', () => {
  assert.equal(esc('<script>&"'), '&lt;script&gt;&amp;&quot;')
})

test('http frontend', async (t) => {
  await t.test('health check is cheap, plain text and supports HEAD', async (t2) => {
    const base = await start(t2)
    const get = await fetch(`${base}/healthz`)
    assert.equal(get.status, 200)
    assert.equal(get.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await get.text(), 'ok\n')
    const head = await fetch(`${base}/healthz`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  })

  await t.test('home page lists pins and needs no identity', async (t2) => {
    const base = await start(t2, { identity: false })
    const body = await (await fetch(`${base}/`)).text()
    assert.match(body, /<h1>gopherkind<\/h1>/)
    assert.match(body, new RegExp(`href="/${npub}"`))
    assert.match(body, /sign in/)
  })

  await t.test('/go redirects to the hole', async (t2) => {
    const base = await start(t2)
    const res = await fetch(`${base}/go?npub=${npub}`, { redirect: 'manual' })
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), `/${npub}`)
  })

  await t.test('NIP-05 input and direct paths resolve to canonical npub URLs', async (t2) => {
    const resolveTarget = async (input: string) => {
      if (input === 'donkey@example.org' || input === 'donkey@example.org/notes') {
        return {
          kind: 'hole' as const,
          pubkey,
          npub,
          path: input.endsWith('/notes') ? '/notes' : '/',
        }
      }
      throw new Error(`could not resolve ${input}`)
    }
    const base = await start(t2, { resolveTarget })
    const form = await fetch(`${base}/go?npub=donkey%40example.org%2Fnotes`, {
      redirect: 'manual',
    })
    assert.equal(form.status, 303)
    assert.equal(form.headers.get('location'), `/${npub}/notes`)
    const direct = await fetch(`${base}/donkey@example.org`, { redirect: 'manual' })
    assert.equal(direct.status, 303)
    assert.equal(direct.headers.get('location'), `/${npub}`)
    const missing = await fetch(`${base}/go?npub=nobody%40example.org`)
    assert.equal(missing.status, 400)
    assert.match(await missing.text(), /could not resolve/)
  })

  await t.test('hole content renders with working links', async (t2) => {
    const base = await start(t2)
    const body = await (await fetch(`${base}/${npub}`)).text()
    assert.match(body, new RegExp(`href="/${npub}/about.txt"`))
    // legacy gopherspace is linked through the built-in proxy, so it works
    // in browsers that do not speak gopher
    assert.match(body, /href="\/gopher\/gopher\.floodgap\.com\/1"/)
    const text = await (await fetch(`${base}/${npub}/about.txt`)).text()
    assert.match(text, /<pre>[\s\S]*kind 31436/)
  })

  await t.test('public HTTP pages carry canonical and share metadata', async (t2) => {
    const base = await start(t2, { publicUrl: 'https://bridge.example' })
    const body = await (await fetch(`${base}/${npub}`)).text()
    assert.match(body, new RegExp(`<link rel="canonical" href="https://bridge\\.example/${npub}">`))
    assert.match(body, /<meta property="og:title"/)
    assert.match(body, /<meta property="og:description"/)
    assert.match(body, /<meta name="twitter:card" content="summary">/)
  })

  await t.test('unknown hole path is a 404 page', async (t2) => {
    const base = await start(t2)
    const res = await fetch(`${base}/${npub}/nope.txt`)
    assert.equal(res.status, 404)
    assert.match(await res.text(), /Not found/)
  })

  await t.test('virtual holes expose a raw Atom feed', async (t2) => {
    const base = await start(t2)
    const res = await fetch(`${base}/${npub}/feed.xml`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/atom+xml; charset=utf-8')
    const body = await res.text()
    assert.match(body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/)
    assert.match(body, /nostr:nevent1/)
    assert.doesNotMatch(body, /<!doctype html>/i)
  })

  await t.test('URL paths distinguish a space from a literal percent escape', async (t2) => {
    const base = await start(t2)
    const space = await (await fetch(`${base}/${npub}/a%20b`)).text()
    const percent = await (await fetch(`${base}/${npub}/a%2520b`)).text()
    assert.match(space, /space path/)
    assert.doesNotMatch(space, /literal percent path/)
    assert.match(percent, /literal percent path/)
  })

  await t.test('raw dot segments are rejected instead of URL-normalised', async (t2) => {
    const base = await start(t2)
    const address = new URL(base)
    for (const path of [`/${npub}/a/../about.txt`, `/${npub}/a/%2e%2e/about.txt`]) {
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          { host: address.hostname, port: Number(address.port), path },
          (res) => {
            let body = ''
            res.on('data', (chunk) => (body += chunk))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
          },
        )
        req.on('error', reject)
        req.end()
      })
      assert.equal(result.status, 404)
      assert.doesNotMatch(result.body, /kind 31436/)
    }
  })

  await t.test('search form and results', async (t2) => {
    const base = await start(t2)
    const empty = await (await fetch(`${base}/_gopherkind/search/${npub}`)).text()
    assert.match(empty, /<form method="get"/)
    const results = await (await fetch(`${base}/_gopherkind/search/${npub}?q=gopherspace`)).text()
    assert.match(results, new RegExp(`href="/${npub}/notes/${note.id}"`))
    const authored = await (await fetch(`${base}/${npub}/search`)).text()
    assert.match(authored, /not an endpoint/)
  })

  await t.test('loopback with a remote operator signer is signed in automatically', async (t2) => {
    const base = await start(t2)
    await withRemoteSigner(async () => {
      const body = await (await fetch(`${base}/account`)).text()
      assert.match(body, /Signed in as/)
      assert.match(body, /local operator/)
    })
  })

  await t.test('local trust can be turned off', async (t2) => {
    const base = await start(t2, { localTrust: false })
    await withRemoteSigner(async () => {
      const body = await (await fetch(`${base}/account`)).text()
      assert.match(body, /<h1>Sign in<\/h1>/)
      const post = await fetch(`${base}/post`, { redirect: 'manual' })
      assert.equal(post.status, 303)
      assert.equal(post.headers.get('location'), '/account')
    })
  })

  await t.test('posting signs and publishes', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const form = await (await fetch(`${base}/post`)).text()
      assert.match(form, /<textarea name="text"/)
      const csrf = /name="csrf" value="([^"]+)"/.exec(form)?.[1] ?? ''
      assert.ok(csrf.length > 0, 'form must carry a csrf token')
      const res = await fetch(`${base}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: 'hello from lynx', csrf }),
      })
      const body = await res.text()
      assert.match(body, /<h1>Posted<\/h1>/)
      assert.equal(published.length, 1)
      const ev = published[0] as { kind: number; content: string }
      assert.equal(ev.kind, 1)
      assert.equal(ev.content, 'hello from lynx')
    })
  })

  await t.test('posting refuses credential-shaped content', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const csrf = await operatorCsrf(base)
      const res = await fetch(`${base}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: `bunker://x?secret=${'f'.repeat(64)}`, csrf }),
      })
      assert.match(await res.text(), /Not posting that/)
      assert.equal(published.length, 0)
    })
  })

  await t.test(
    'document publishing requires replacement consent and reports read-back',
    async (t2) => {
      const planned: Array<{ path: string; type: string; title: string; content: string }> = []
      const base = await start(t2, {
        documentPublisher: async (document) => {
          planned.push(document)
          return {
            npub,
            path: document.path,
            eventId: 'f'.repeat(64),
            relays: ['wss://one.example', 'wss://two.example'],
            acceptedBy: ['wss://one.example', 'wss://two.example'],
            readableFrom: ['wss://one.example'],
          }
        },
      })
      const csrf = await operatorCsrf(base)
      const unconfirmed = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          path: '/web.txt',
          title: 'Web document',
          type: '0',
          content: 'hello from the web',
          csrf,
        }),
      })
      assert.equal(unconfirmed.status, 400)
      assert.match(await unconfirmed.text(), /Nothing was signed/)
      assert.equal(planned.length, 0)

      const published = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          path: '/web.txt',
          title: 'Web document',
          type: '0',
          content: 'hello from the web',
          replace: 'yes',
          csrf,
        }),
      })
      assert.equal(published.status, 200)
      const body = await published.text()
      assert.match(body, /accepted by 2\/2 relays/)
      assert.match(body, /read back from 1\/2/)
      assert.match(body, new RegExp(`href="/${npub}/web\\.txt"`))
      assert.deepEqual(planned, [
        {
          path: '/web.txt',
          title: 'Web document',
          type: '0',
          content: 'hello from the web',
        },
      ])
    },
  )

  await t.test(
    'document publishing strips credential-shaped content before redisplay',
    async (t2) => {
      let calls = 0
      const base = await start(t2, {
        documentPublisher: async () => {
          calls += 1
          throw new Error('publisher should not run')
        },
      })
      const csrf = await operatorCsrf(base)
      const secret = `bunker://signer.example?secret=${'f'.repeat(64)}`
      const response = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          path: '/private.txt',
          title: 'Private',
          type: '0',
          content: secret,
          replace: 'yes',
          csrf,
        }),
      })
      assert.equal(response.status, 400)
      const body = await response.text()
      assert.match(body, /Nothing was signed or sent/)
      assert.doesNotMatch(body, /signer\.example/)
      assert.match(body, /<textarea name="content"[^>]*><\/textarea>/)
      assert.equal(calls, 0)
    },
  )

  await t.test('own note offers a delete button and deletion signs kind 5', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const view = await (await fetch(`${base}/${npub}/notes/${note.id}`)).text()
      assert.match(view, /Delete this note/)
      assert.match(view, new RegExp(`value="${note.id}"`))
      const csrf = /name="csrf" value="([^"]+)"/.exec(view)?.[1] ?? ''
      const res = await fetch(`${base}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: note.id, csrf }),
      })
      assert.match(await res.text(), /Deletion requested/)
      const ev = published[0] as { kind: number; tags: string[][] }
      assert.equal(ev.kind, 5)
      assert.ok(ev.tags.some((t3) => t3[0] === 'e' && t3[1] === note.id))
      assert.ok(ev.tags.some((t3) => t3[0] === 'k' && t3[1] === '1'))
    })
  })

  await t.test('malformed event id is rejected', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const csrf = await operatorCsrf(base)
      const res = await fetch(`${base}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: 'zz', csrf }),
      })
      assert.equal(res.status, 400)
      assert.equal(published.length, 0)
    })
  })

  await t.test("deleting someone else's event is refused", async (t2) => {
    const published: unknown[] = []
    const strangerNote = finalizeEvent(
      { kind: 1, created_at: 1_754_000_000, tags: [], content: 'not yours' },
      generateSecretKey(),
    )
    const store = makeStore(published)
    const base = await start(
      t2,
      {
        store: Object.assign(store, {
          event: async (id: string) => (id === strangerNote.id ? strangerNote : null),
        }),
      },
      published,
    )
    await withRemoteSigner(async () => {
      // the delete button must not be offered on a stranger's note
      const view = await (
        await fetch(`${base}/${nip19.npubEncode(strangerNote.pubkey)}/notes/${strangerNote.id}`)
      ).text()
      assert.doesNotMatch(view, /Delete this note/)
      // even with a valid operator token, deleting a stranger's note is refused
      const csrf = await operatorCsrf(base)
      const res = await fetch(`${base}/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: strangerNote.id, csrf }),
      })
      assert.equal(res.status, 403)
      assert.match(await res.text(), /Not yours/)
      assert.equal(published.length, 0)
    })
  })

  await t.test('a POST without the csrf token is refused', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const res = await fetch(`${base}/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: 'no token here' }),
      })
      assert.equal(res.status, 403)
      assert.equal(published.length, 0)
    })
  })

  await t.test('a cross-site Origin is refused even with a valid token', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    await withRemoteSigner(async () => {
      const csrf = await operatorCsrf(base)
      const res = await fetch(`${base}/post`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://evil.example',
        },
        body: new URLSearchParams({ text: 'from evil', csrf }),
      })
      assert.equal(res.status, 403)
      assert.equal(published.length, 0)
    })
  })

  await t.test('a loopback connection with a foreign Host is not the operator', async (t2) => {
    const base = await start(t2)
    const port = Number(new URL(base).port)
    await withRemoteSigner(async () => {
      // fetch() forbids overriding Host, so drive a raw request that can.
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/account', headers: { host: 'attacker.example' } },
          (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => resolve(data))
          },
        )
        req.on('error', reject)
        req.end()
      })
      // DNS-rebinding signature: loopback socket, foreign Host -> no operator trust
      assert.doesNotMatch(body, /Signed in as/)
      assert.match(body, /Sign in/)
    })
  })

  await t.test('responses carry security headers', async (t2) => {
    const base = await start(t2)
    const res = await fetch(`${base}/`)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/)
  })

  await t.test('feed renders follows', async (t2) => {
    const base = await start(t2)
    await withRemoteSigner(async () => {
      const body = await (await fetch(`${base}/feed`)).text()
      assert.match(body, /<h1>Your feed<\/h1>/)
      assert.match(body, new RegExp(`href="/${npub}/notes/${note.id}"`))
      assert.match(body, /testdonkey/)
    })
  })
})
