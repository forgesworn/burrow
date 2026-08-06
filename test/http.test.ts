import test from 'node:test'
import assert from 'node:assert/strict'
import type net from 'node:net'
import http from 'node:http'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { Event } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { createHttpServer, type HttpOptions } from '../src/http.ts'
import { PairingStore } from '../src/identity.ts'
import { esc } from '../src/html.ts'
import { RateLimiter } from '../src/ratelimit.ts'
import { docToTemplate } from '../src/publish.ts'
import { NIP98_KIND } from '../src/nip07.ts'
import { makeStore, npub, note, pubkey, sk, testSigner } from './helpers.ts'

// The loopback operator's forms carry a server-lifetime CSRF token; grab it
// from the /post form to drive the write endpoints the way lynx would.
async function operatorCsrf(base: string): Promise<string> {
  const form = await (await fetch(`${base}/post`)).text()
  return /name="csrf" value="([^"]+)"/.exec(form)?.[1] ?? ''
}

function csrfFrom(html: string): string {
  return /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? ''
}

function nip07Authorization(base: string, secret = sk): { event: unknown; header: string } {
  const event = finalizeEvent(
    {
      kind: NIP98_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', `${base}/nip07/connect`],
        ['method', 'POST'],
      ],
      content: '',
    },
    secret,
  )
  return {
    event,
    header: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
  }
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

  await t.test(
    'explicit proxy mode rate-limits validated visitor addresses separately',
    async (t2) => {
      const base = await start(t2, {
        trustedProxy: true,
        limiter: new RateLimiter(1, 0),
      })
      const first = await fetch(base, { headers: { 'x-forwarded-for': '198.51.100.10' } })
      assert.equal(first.status, 200)
      const repeated = await fetch(base, { headers: { 'x-forwarded-for': '198.51.100.10' } })
      assert.equal(repeated.status, 429)
      const other = await fetch(base, { headers: { 'x-forwarded-for': '198.51.100.11' } })
      assert.equal(other.status, 200)
      const malformed = await fetch(base, { headers: { 'x-forwarded-for': 'not-an-address' } })
      assert.equal(malformed.status, 200)
      const chain = await fetch(base, {
        headers: { 'x-forwarded-for': '198.51.100.12, 198.51.100.13' },
      })
      assert.equal(chain.status, 429)
    },
  )

  await t.test('ordinary listeners ignore forwarded visitor addresses', async (t2) => {
    const base = await start(t2, { limiter: new RateLimiter(1, 0) })
    const first = await fetch(base, { headers: { 'x-forwarded-for': '198.51.100.20' } })
    assert.equal(first.status, 200)
    const spoofed = await fetch(base, { headers: { 'x-forwarded-for': '198.51.100.21' } })
    assert.equal(spoofed.status, 429)
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
    assert.match(body, /Edit and republish/)
    assert.match(body, /All my pages/)
    const text = await (await fetch(`${base}/${npub}/about.txt`)).text()
    assert.match(text, /<pre>[\s\S]*kind 31436/)
  })

  await t.test(
    'signed kindmap terminal colours render without leaking control syntax',
    async (t2) => {
      const styledRoot = finalizeEvent(
        docToTemplate(
          {
            path: '/',
            type: '1',
            title: 'Styled root',
            content: '\x1b[38;5;214mDonkey\x1b[0m\n',
          },
          1_754_000_010,
        ),
        sk,
      )
      const store = makeStore()
      store.doc = async (pk: string, documentPath: string) =>
        pk === pubkey && documentPath === '/' ? styledRoot : null
      const base = await start(t2, { store, publicUrl: 'https://bridge.example' })
      const body = await (await fetch(`${base}/${npub}`)).text()
      assert.match(body, /<span style="color:#ffaf00">Donkey<\/span>/)
      assert.doesNotMatch(body, /\[38;5;214m/)
      assert.ok(!body.includes(String.fromCharCode(27)))
    },
  )

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
      assert.match(body, /href="\/me">My pages<\/a>/)
      const home = await (await fetch(base)).text()
      assert.match(home, /href="\/me">Manage my pages<\/a>/)
      const mine = await fetch(`${base}/me`, { redirect: 'manual' })
      assert.equal(mine.status, 200)
      const pages = await mine.text()
      assert.match(pages, /<h1>Your pages<\/h1>/)
      assert.match(pages, new RegExp(`href="/${npub}">View your public hole`))
      assert.match(pages, /edit and republish/)
    })
  })

  await t.test('page manager supports create, edit, view and confirmed deletion', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, {}, published)
    const manager = await (await fetch(`${base}/me`)).text()
    assert.match(manager, /href="\/publish">Add a new page<\/a>/)
    assert.match(manager, /href="\/publish\?path=%2F">edit and republish<\/a>/)
    assert.match(manager, /href="\/me\/delete\?path=%2F">request deletion<\/a>/)

    const edit = await (await fetch(`${base}/publish?path=%2F`)).text()
    assert.match(edit, /<h1>Edit \/<\/h1>/)
    assert.match(edit, /name="path"[^>]*value="\/"[^>]*readonly/)
    assert.match(edit, /Sign and republish/)
    assert.match(edit, /Welcome to the example gopherkind/)

    const confirmation = await (await fetch(`${base}/me/delete?path=%2F`)).text()
    assert.match(confirmation, /Request page deletion/)
    assert.match(confirmation, /leave your hole without a home page/)
    assert.match(confirmation, /name="confirm" pattern="DELETE"/)
    const id = /name="id" value="([0-9a-f]{64})"/.exec(confirmation)?.[1] ?? ''
    const address = /name="address" value="([^"]+)"/.exec(confirmation)?.[1] ?? ''
    const csrf = csrfFrom(confirmation)

    const unconfirmed = await fetch(`${base}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id, kind: '31436', path: '/', address, csrf }),
    })
    assert.equal(unconfirmed.status, 400)
    assert.equal(published.length, 0)

    const deleted = await fetch(`${base}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id,
        kind: '31436',
        path: '/',
        address,
        confirm: 'DELETE',
        csrf,
      }),
    })
    assert.equal(deleted.status, 200)
    assert.match(await deleted.text(), /Back to your pages/)
    const event = published[0] as Event
    assert.equal(event.kind, 5)
    assert.ok(event.tags.some((tag) => tag[0] === 'e' && tag[1] === id))
    assert.ok(event.tags.some((tag) => tag[0] === 'k' && tag[1] === '31436'))
    assert.ok(event.tags.some((tag) => tag[0] === 'a' && tag[1] === address))
  })

  await t.test('local trust can be turned off', async (t2) => {
    const base = await start(t2, { localTrust: false })
    await withRemoteSigner(async () => {
      const body = await (await fetch(`${base}/account`)).text()
      assert.match(body, /<h1>Sign in<\/h1>/)
      const post = await fetch(`${base}/post`, { redirect: 'manual' })
      assert.equal(post.status, 303)
      assert.equal(post.headers.get('location'), '/account')
      const mine = await fetch(`${base}/me`, { redirect: 'manual' })
      assert.equal(mine.status, 303)
      assert.equal(mine.headers.get('location'), '/account')
    })
  })

  await t.test(
    'NIP-07 connects a browser session and signs every write in the extension',
    async (t2) => {
      const published: unknown[] = []
      const browserDocuments: Array<{ document: unknown; event: unknown }> = []
      const base = await start(
        t2,
        {
          localTrust: false,
          signedDocumentPublisher: async (document, event) => {
            browserDocuments.push({ document, event })
            return {
              npub,
              path: document.path,
              eventId: event.id,
              relays: ['wss://stub.invalid'],
              acceptedBy: ['wss://stub.invalid'],
              readableFrom: ['wss://stub.invalid'],
            }
          },
        },
        published,
      )

      const anonymous = await (await fetch(`${base}/account`)).text()
      assert.match(anonymous, /Browser extension \(NIP-07\)/)
      assert.match(anonymous, /data-nip07-connect/)
      assert.match(anonymous, /Remote signer \(NIP-46\)/)
      const script = await fetch(`${base}/browser.js`)
      assert.match(script.headers.get('content-type') ?? '', /^text\/javascript/)
      const scriptBody = await script.text()
      assert.match(scriptBody, /window\.nostr/)
      assert.match(scriptBody, /nostr\.getPublicKey\(\)/)
      assert.match(scriptBody, /nostr\.signEvent\(template\)/)
      assert.match(
        scriptBody,
        /This page is too large for the safe 20 KiB remote-signing request limit/,
      )
      assert.match(scriptBody, /window\.history\.back\(\)/)

      const auth = nip07Authorization(base)
      const connected = await fetch(`${base}/nip07/connect`, {
        method: 'POST',
        headers: { authorization: auth.header, origin: base },
      })
      assert.equal(connected.status, 204)
      const cookie = connected.headers.get('set-cookie')?.split(';')[0] ?? ''
      assert.match(cookie, /^gopherkind=/)

      const account = await (await fetch(`${base}/account`, { headers: { cookie } })).text()
      assert.match(account, /Signed in as/)
      assert.match(account, /NIP-07 browser extension/)
      assert.match(account, /Disconnect/)

      const postForm = await (await fetch(`${base}/post`, { headers: { cookie } })).text()
      assert.match(postForm, /data-nip07-action="post"/)
      assert.match(postForm, new RegExp(`data-nip07-pubkey="${pubkey}"`))
      const signedNote = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: 'hello from a Chrome extension',
        },
        sk,
      )
      const posted = await fetch(`${base}/post`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
          origin: base,
        },
        body: new URLSearchParams({
          csrf: csrfFrom(postForm),
          event: JSON.stringify(signedNote),
        }),
      })
      assert.equal(posted.status, 200)
      assert.match(await posted.text(), /<h1>Posted<\/h1>/)
      assert.deepEqual(published[0], signedNote)

      const publishForm = await (await fetch(`${base}/publish`, { headers: { cookie } })).text()
      assert.match(publishForm, /data-nip07-action="publish"/)
      const document = {
        path: '/chrome.txt',
        type: '0' as const,
        title: 'Chrome',
        content: 'signed by window.nostr',
      }
      const signedDocument = finalizeEvent(
        docToTemplate(document, Math.floor(Date.now() / 1000)),
        sk,
      )
      const publishedDocument = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
          origin: base,
        },
        body: new URLSearchParams({
          csrf: csrfFrom(publishForm),
          replace: 'yes',
          event: JSON.stringify(signedDocument),
        }),
      })
      assert.equal(publishedDocument.status, 200)
      assert.match(await publishedDocument.text(), /<h1>Published<\/h1>/)
      assert.deepEqual(browserDocuments, [{ document, event: signedDocument }])

      const notePage = await (
        await fetch(`${base}/${npub}/notes/${note.id}`, { headers: { cookie } })
      ).text()
      assert.match(notePage, /data-nip07-action="delete"/)
      const signedDeletion = finalizeEvent(
        {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', note.id],
            ['k', '1'],
          ],
          content: 'deleted by author',
        },
        sk,
      )
      const deleted = await fetch(`${base}/delete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
          origin: base,
        },
        body: new URLSearchParams({
          csrf: csrfFrom(notePage),
          event: JSON.stringify(signedDeletion),
        }),
      })
      assert.equal(deleted.status, 200)
      assert.match(await deleted.text(), /Deletion requested/)
      assert.deepEqual(published[1], signedDeletion)

      const documentDeleteForm = await (
        await fetch(`${base}/me/delete?path=%2F`, { headers: { cookie } })
      ).text()
      const documentId = /name="id" value="([0-9a-f]{64})"/.exec(documentDeleteForm)?.[1] ?? ''
      const documentAddress = /name="address" value="([^"]+)"/.exec(documentDeleteForm)?.[1] ?? ''
      const signedDocumentDeletion = finalizeEvent(
        {
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', documentId],
            ['k', '31436'],
            ['a', documentAddress],
          ],
          content: 'deleted by author',
        },
        sk,
      )
      const documentDeleted = await fetch(`${base}/delete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie,
          origin: base,
        },
        body: new URLSearchParams({
          csrf: csrfFrom(documentDeleteForm),
          confirm: 'DELETE',
          event: JSON.stringify(signedDocumentDeletion),
        }),
      })
      assert.equal(documentDeleted.status, 200)
      assert.match(await documentDeleted.text(), /Back to your pages/)
      assert.deepEqual(published[2], signedDocumentDeletion)

      const feed = await (await fetch(`${base}/feed`, { headers: { cookie } })).text()
      assert.match(feed, /<h1>Your feed<\/h1>/)

      const replay = await fetch(`${base}/nip07/connect`, {
        method: 'POST',
        headers: { authorization: auth.header, origin: base },
      })
      assert.equal(replay.status, 401)
      assert.match(await replay.text(), /already used/)
    },
  )

  await t.test('NIP-07 rejects a different extension account and disabled identity', async (t2) => {
    const published: unknown[] = []
    const base = await start(t2, { localTrust: false }, published)
    const auth = nip07Authorization(base)
    const connected = await fetch(`${base}/nip07/connect`, {
      method: 'POST',
      headers: { authorization: auth.header, origin: base },
    })
    const cookie = connected.headers.get('set-cookie')?.split(';')[0] ?? ''
    const form = await (await fetch(`${base}/post`, { headers: { cookie } })).text()
    const wrongAuthor = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'wrong account',
      },
      generateSecretKey(),
    )
    const refused = await fetch(`${base}/post`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie,
        origin: base,
      },
      body: new URLSearchParams({
        csrf: csrfFrom(form),
        event: JSON.stringify(wrongAuthor),
      }),
    })
    assert.match(await refused.text(), /wrong author/)
    assert.equal(published.length, 0)

    const disabled = await start(t2, { identity: false, localTrust: false })
    const disabledAuth = nip07Authorization(disabled)
    const noIdentity = await fetch(`${disabled}/nip07/connect`, {
      method: 'POST',
      headers: { authorization: disabledAuth.header, origin: disabled },
    })
    assert.equal(noIdentity.status, 404)
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
      assert.match(body, /link to it from a menu page/)
      assert.match(body, new RegExp(`href="/${npub}">Open your hole`))

      const menuPublished = await fetch(`${base}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          path: '/',
          title: 'Home',
          type: '1',
          content: '0Web document\t/web.txt',
          replace: 'yes',
          csrf,
        }),
      })
      assert.equal(menuPublished.status, 200)
      assert.match(await menuPublished.text(), /publish any same-hole pages this menu links to/)
      assert.deepEqual(planned, [
        {
          path: '/web.txt',
          title: 'Web document',
          type: '0',
          content: 'hello from the web',
        },
        {
          path: '/',
          title: 'Home',
          type: '1',
          content: '0Web document\t/web.txt',
        },
      ])
    },
  )

  await t.test('document publisher explains page types, paths and menu syntax', async (t2) => {
    const base = await start(t2)
    const body = await (await fetch(`${base}/publish`)).text()

    assert.match(body, /<h1>Publish to your hole<\/h1>/)
    assert.match(body, /Text page:<\/strong> write an about page/)
    assert.match(body, /Menu page:<\/strong> make a home page/)
    assert.match(body, /Menu page \(kindmap\)/)
    assert.match(body, /Use <code>\/<\/code> for your home page/)
    assert.match(body, /one tab, then the destination/)
    assert.match(body, /0About me\t\/about\.txt/)
    assert.match(body, /adding a menu link does not create its destination/)
    assert.match(body, /Relays and readers may retain old copies/)
  })

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
      assert.match(body, /Nothing was sent to a relay/)
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
    const csp = res.headers.get('content-security-policy') ?? ''
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /script-src 'self'/)
    assert.match(csp, /connect-src 'self'/)
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/)
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

test('a failed proxy fetch carries no "read it directly" note', async (t) => {
  // The proxy exists because browsers stopped speaking gopher. The page must
  // still tell the reader whose it is and how to reach it without us.
  const base = await start(t, {
    resolveTarget: async () => {
      throw new Error('unused')
    },
  })
  const res = await fetch(`${base}/gopher/example.invalid/0/thing.txt`)
  const body = await res.text()
  // The fetch fails (no such host), so the note must not appear on an error.
  assert.equal(res.status, 502)
  assert.doesNotMatch(body, /Proxied from gopherspace/)
})
