import test from 'node:test'
import assert from 'node:assert/strict'
import type { EventTemplate } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  assertBrowserSignedTemplate,
  HTTP_BROWSER_SCRIPT,
  nip98Authorization,
  NIP98_KIND,
  parseSignedEvent,
} from '../src/nip07.ts'

const secret = generateSecretKey()
const pubkey = getPublicKey(secret)
const url = 'https://bridge.example/nip07/connect'

test('the HTTP browser enhancement is valid standalone JavaScript', () => {
  assert.doesNotThrow(() => new Function(HTTP_BROWSER_SCRIPT))
  assert.match(HTTP_BROWSER_SCRIPT, /window\.history\.back\(\)/)
})

function exerciseBackLink(options: {
  navigation?: { canGoBack: boolean }
  historyLength: number
  ctrlKey?: boolean
}): { prevented: boolean; backCalls: number } {
  let click: (event: Record<string, unknown>) => void = () => {
    throw new Error('back handler was not registered')
  }
  let backCalls = 0
  const link = {
    addEventListener: (_name: string, handler: (event: Record<string, unknown>) => void) => {
      click = handler
    },
  }
  const browserWindow = {
    navigation: options.navigation,
    history: { length: options.historyLength, back: () => (backCalls += 1) },
    nostr: undefined,
  }
  const document = {
    querySelector: (selector: string) => (selector === '[data-history-back]' ? link : null),
    querySelectorAll: () => [],
  }
  new Function('window', 'document', 'HTMLFormElement', HTTP_BROWSER_SCRIPT)(
    browserWindow,
    document,
    class {},
  )
  let prevented = false
  click({
    button: 0,
    metaKey: false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => {
      prevented = true
    },
  })
  return { prevented, backCalls }
}

test('back uses browser history, preserves modified clicks and falls back to home', () => {
  assert.deepEqual(exerciseBackLink({ navigation: { canGoBack: true }, historyLength: 2 }), {
    prevented: true,
    backCalls: 1,
  })
  assert.deepEqual(exerciseBackLink({ navigation: { canGoBack: false }, historyLength: 1 }), {
    prevented: false,
    backCalls: 0,
  })
  assert.deepEqual(
    exerciseBackLink({ navigation: { canGoBack: true }, historyLength: 2, ctrlKey: true }),
    { prevented: false, backCalls: 0 },
  )
  assert.deepEqual(exerciseBackLink({ historyLength: 2 }), {
    prevented: true,
    backCalls: 1,
  })
})

function authorization(template: EventTemplate): string {
  const event = finalizeEvent(template, secret)
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

test('NIP-98 authorizes the exact fresh connection request', () => {
  const header = authorization({
    kind: NIP98_KIND,
    created_at: 1_000,
    tags: [
      ['u', url],
      ['method', 'POST'],
    ],
    content: '',
  })
  const event = nip98Authorization(header, url, 'POST', 1_030)
  assert.equal(event.pubkey, pubkey)
})

test('NIP-98 refuses stale, replayable-looking or mis-scoped requests', () => {
  const template = {
    kind: NIP98_KIND,
    created_at: 1_000,
    tags: [
      ['u', url],
      ['method', 'POST'],
    ],
    content: '',
  }
  const header = authorization(template)
  assert.throws(() => nip98Authorization(header, `${url}?wrong=yes`, 'POST', 1_030), /wrong URL/)
  assert.throws(() => nip98Authorization(header, url, 'GET', 1_030), /wrong method/)
  assert.throws(() => nip98Authorization(header, url, 'POST', 1_061), /stale/)
  assert.throws(
    () =>
      nip98Authorization(
        authorization({ ...template, tags: [...template.tags, ['u', url]] }),
        url,
        'POST',
        1_030,
      ),
    /wrong URL/,
  )
})

test('signed browser events require a valid signature, author and exact template', () => {
  const template = { kind: 1, created_at: 2_000, tags: [], content: 'hello' }
  const event = finalizeEvent(template, secret)
  assert.equal(parseSignedEvent(JSON.stringify(event)).id, event.id)
  assert.equal(assertBrowserSignedTemplate(event, pubkey, template, 2_010), event)
  assert.throws(
    () => assertBrowserSignedTemplate(event, 'f'.repeat(64), template, 2_010),
    /wrong author/,
  )
  assert.throws(
    () => assertBrowserSignedTemplate(event, pubkey, { ...template, content: 'changed' }, 2_010),
    /different from/,
  )
  assert.throws(() => assertBrowserSignedTemplate(event, pubkey, template, 2_301), /stale/)
  assert.throws(
    () => parseSignedEvent(JSON.stringify({ ...event, content: 'tampered' })),
    /invalid/,
  )
})
