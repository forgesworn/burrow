import type { Event, EventTemplate } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools/pure'

export const NIP98_KIND = 27235
const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/

function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    typeof event['id'] === 'string' &&
    HEX_32.test(event['id']) &&
    typeof event['pubkey'] === 'string' &&
    HEX_32.test(event['pubkey']) &&
    typeof event['sig'] === 'string' &&
    HEX_64.test(event['sig']) &&
    Number.isSafeInteger(event['created_at']) &&
    Number.isSafeInteger(event['kind']) &&
    typeof event['content'] === 'string' &&
    Array.isArray(event['tags']) &&
    event['tags'].every(
      (tag) =>
        Array.isArray(tag) && tag.length > 0 && tag.every((part) => typeof part === 'string'),
    )
  )
}

export function parseSignedEvent(raw: string): Event {
  if (Buffer.byteLength(raw, 'utf8') > 128 * 1024) throw new Error('signed event is too large')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('signed event is not valid JSON')
  }
  if (!isEvent(parsed)) throw new Error('signed event is malformed')
  if (!verifyEvent(parsed)) throw new Error('signed event has an invalid id or signature')
  return parsed
}

function onlyTag(event: Event, name: string): string | null {
  const matches = event.tags.filter((tag) => tag[0] === name)
  return matches.length === 1 && matches[0]?.length === 2 ? (matches[0][1] ?? null) : null
}

export function nip98Authorization(
  authorization: string | undefined,
  url: string,
  method: string,
  now = Math.floor(Date.now() / 1000),
): Event {
  const encoded = /^Nostr ([A-Za-z0-9+/]+={0,2})$/.exec(authorization ?? '')?.[1]
  if (encoded === undefined || encoded.length % 4 !== 0) {
    throw new Error('missing or malformed NIP-98 authorization')
  }
  const event = parseSignedEvent(Buffer.from(encoded, 'base64').toString('utf8'))
  if (event.kind !== NIP98_KIND) throw new Error('NIP-98 authorization has the wrong kind')
  if (event.content !== '') throw new Error('NIP-98 authorization content must be empty')
  if (Math.abs(now - event.created_at) > 60) throw new Error('NIP-98 authorization is stale')
  if (onlyTag(event, 'u') !== url) throw new Error('NIP-98 authorization has the wrong URL')
  if (onlyTag(event, 'method') !== method.toUpperCase()) {
    throw new Error('NIP-98 authorization has the wrong method')
  }
  return event
}

export function assertBrowserSignedTemplate(
  event: Event,
  pubkey: string,
  template: EventTemplate,
  now = Math.floor(Date.now() / 1000),
): Event {
  if (event.pubkey !== pubkey) throw new Error('browser signer returned the wrong author')
  if (Math.abs(now - event.created_at) > 5 * 60) throw new Error('browser-signed event is stale')
  if (
    event.kind !== template.kind ||
    event.created_at !== template.created_at ||
    event.content !== template.content ||
    JSON.stringify(event.tags) !== JSON.stringify(template.tags)
  ) {
    throw new Error('browser signer returned an event different from the requested template')
  }
  return event
}

// Graphical-browser navigation and NIP-07 are progressive enhancements. The
// base pages and NIP-46 forms remain ordinary HTML and continue to work in
// lynx. NIP-07 stays in the browser: connect uses NIP-98, and each write
// submits only a public signed event for server-side verification and
// publication.
export const HTTP_BROWSER_SCRIPT = `(() => {
  'use strict'

  const statusText = (node, text) => {
    if (node) node.textContent = text
  }

  const provider = () => {
    const candidate = window.nostr
    return candidate && typeof candidate.getPublicKey === 'function' &&
      typeof candidate.signEvent === 'function' ? candidate : null
  }

  const eventLooksSigned = (event, pubkey) => event && event.pubkey === pubkey &&
    /^[0-9a-f]{64}$/.test(event.id || '') && /^[0-9a-f]{128}$/.test(event.sig || '')

  const hiddenInput = (form, name, value) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }

  const enableBackNavigation = () => {
    const link = document.querySelector('[data-history-back]')
    if (!link) return
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const navigationCanGoBack = window.navigation && window.navigation.canGoBack
      if (navigationCanGoBack || (!window.navigation && window.history.length > 1)) {
        event.preventDefault()
        window.history.back()
      }
    })
  }

  const enableTheme = () => {
    const root = document.documentElement
    const button = document.querySelector('[data-theme-toggle]')
    if (!root || !button) return
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)') : null
    let stored = null
    try {
      stored = window.localStorage.getItem('gopherkind-theme')
    } catch {
      // A blocked storage API should not prevent the system theme from working.
    }
    if (stored === 'dark' || stored === 'light') root.dataset.theme = stored

    const activeTheme = () => root.dataset.theme || (media && media.matches ? 'dark' : 'light')
    const render = () => {
      const active = activeTheme()
      const next = active === 'dark' ? 'light' : 'dark'
      button.textContent = next + ' mode'
      button.setAttribute('aria-label', 'Switch to ' + next + ' mode')
      button.hidden = false
    }
    button.addEventListener('click', () => {
      const next = activeTheme() === 'dark' ? 'light' : 'dark'
      root.dataset.theme = next
      try {
        window.localStorage.setItem('gopherkind-theme', next)
      } catch {
        // The explicit choice still applies for this page when storage is blocked.
      }
      render()
    })
    if (!stored && media && typeof media.addEventListener === 'function') {
      media.addEventListener('change', render)
    }
    render()
  }

  const signedTemplate = (form) => {
    const data = new FormData(form)
    const created_at = Math.floor(Date.now() / 1000)
    switch (form.dataset.nip07Action) {
      case 'post':
        return { kind: 1, created_at, tags: [], content: String(data.get('text') || '').trim() }
      case 'publish': {
        const path = String(data.get('path') || '').trim()
        const title = String(data.get('title') || '').trim() || path
        const type = data.get('type') === '1' ? '1' : '0'
        return {
          kind: 31436,
          created_at,
          tags: [['d', path], ['type', type], ['title', title]],
          content: String(data.get('content') || ''),
        }
      }
      case 'delete':
        return {
          kind: 5,
          created_at,
          tags: [['e', String(data.get('id') || '')], ['k', String(data.get('kind') || '')]],
          content: 'deleted by author',
        }
      default:
        throw new Error('unknown browser signing action')
    }
  }

  const connect = async (button, status) => {
    const nostr = provider()
    if (!nostr) throw new Error('No NIP-07 browser extension was found.')
    button.disabled = true
    try {
      statusText(status, 'Check your browser extension and approve access to your public key.')
      const pubkey = await nostr.getPublicKey()
      if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('The extension returned a bad public key.')
      const url = new URL('/nip07/connect', window.location.origin).href
      statusText(status, 'Approve the gopherkind connection request in your browser extension.')
      const event = await nostr.signEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', url], ['method', 'POST']],
        content: '',
      })
      if (!eventLooksSigned(event, pubkey)) throw new Error('The extension returned a bad signature.')
      const authorization = 'Nostr ' + btoa(JSON.stringify(event))
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { authorization },
      })
      if (!response.ok) throw new Error((await response.text()) || 'The bridge refused the connection.')
      window.location.assign('/account')
    } finally {
      button.disabled = false
    }
  }

  const enableConnect = () => {
    const section = document.querySelector('[data-nip07-connect]')
    if (!section) return
    const button = section.querySelector('button')
    const status = section.querySelector('[aria-live]')
    let attempts = 0
    const detect = () => {
      if (provider()) {
        button.hidden = false
        statusText(status, 'NIP-07 browser extension detected. Your key stays in the extension.')
        button.addEventListener('click', () => {
          connect(button, status).catch((error) => {
            statusText(status, 'Connection failed: ' + (error && error.message ? error.message : String(error)))
          })
        })
        return
      }
      attempts += 1
      if (attempts < 20) window.setTimeout(detect, 100)
      else statusText(status, 'No NIP-07 extension found. Install or unlock one, then reload this page.')
    }
    detect()
  }

  const enableSigningForms = () => {
    for (const form of document.querySelectorAll('form[data-nip07-action]')) {
      const status = form.querySelector('[aria-live]')
      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        const submit = form.querySelector('[type="submit"]')
        if (submit) submit.disabled = true
        try {
          const nostr = provider()
          if (!nostr) throw new Error('No NIP-07 browser extension was found.')
          statusText(status, 'Check your browser extension and approve this signature.')
          const pubkey = await nostr.getPublicKey()
          if (pubkey !== form.dataset.nip07Pubkey) throw new Error('The extension account has changed. Sign out and connect again.')
          const template = signedTemplate(form)
          if (template.content === '' && form.dataset.nip07Action === 'post') throw new Error('Write something before signing.')
          const signed = await nostr.signEvent(template)
          if (!eventLooksSigned(signed, pubkey)) throw new Error('The extension returned a bad signature.')

          const submission = document.createElement('form')
          submission.method = 'post'
          submission.action = form.action
          hiddenInput(submission, 'csrf', String(new FormData(form).get('csrf') || ''))
          hiddenInput(submission, 'event', JSON.stringify(signed))
          if (form.dataset.nip07Action === 'publish') hiddenInput(submission, 'replace', 'yes')
          document.body.appendChild(submission)
          HTMLFormElement.prototype.submit.call(submission)
        } catch (error) {
          statusText(status, 'Signing failed: ' + (error && error.message ? error.message : String(error)))
          if (submit) submit.disabled = false
        }
      })
    }
  }

  enableBackNavigation()
  enableTheme()
  enableConnect()
  enableSigningForms()
})()
`
