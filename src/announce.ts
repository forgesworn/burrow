import type { EventTemplate } from 'nostr-tools'
import { DOC_KIND } from './protocol.ts'

// NIP-89 handler announcement (kind 31990). A Nostr client that meets a
// kind 31436 event has no idea what to do with it; a handler announcement
// is how a bridge says "give it to me, here is the URL". The `<bech32>`
// placeholder is NIP-89's: the client substitutes the entity it is trying
// to open.
//
// Nothing here publishes. Building the template is deliberately separate
// from signing it, so the event can be inspected before it ever reaches a
// relay.

export const HANDLER_KIND = 31990

export interface AnnounceOptions {
  // Shown to users choosing a handler.
  name: string
  about: string
  // The bridge's public hostname, without a scheme.
  hostname: string
  gopherPort: number
  geminiPort: number | null
  // Full origin of the HTTP frontend, e.g. https://bridge.example.
  httpUrl: string | null
  // `d` tag: lets one operator announce more than one bridge.
  identifier: string
}

export class AnnounceError extends Error {}

function checkHostname(hostname: string): void {
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname) || !hostname.includes('.')) {
    throw new AnnounceError(
      `${hostname} is not a public hostname; announce the name visitors will use`,
    )
  }
}

function checkHttpUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AnnounceError(`bad http url: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AnnounceError(`http url must be http(s): ${raw}`)
  }
  return url.origin
}

export function handlerTemplate(opts: AnnounceOptions, now: number): EventTemplate {
  checkHostname(opts.hostname)
  const gopherHost = opts.gopherPort === 70 ? opts.hostname : `${opts.hostname}:${opts.gopherPort}`
  const tags: string[][] = [
    ['d', opts.identifier],
    ['k', String(DOC_KIND)],
    // NIP-31: something for a client with no handler support to show.
    ['alt', `gopherkind bridge for kind ${DOC_KIND} gopherholes`],
  ]

  // A bridge resolves any of these entity forms, so announce the ones a
  // client is likely to hold: the document itself, and its author's hole.
  if (opts.httpUrl !== null) {
    const origin = checkHttpUrl(opts.httpUrl)
    tags.push(['web', `${origin}/<bech32>`, 'naddr'])
    tags.push(['web', `${origin}/<bech32>`, 'npub'])
    tags.push(['web', `${origin}/<bech32>`, 'nprofile'])
  }
  // `gopher` and `gemini` are not platforms NIP-89 names, which is the
  // point: the spec lets a handler declare its own, and a client that does
  // not know them simply ignores them.
  tags.push(['gopher', `gopher://${gopherHost}/1/<bech32>`, 'npub'])
  tags.push(['gopher', `gopher://${gopherHost}/1/<bech32>`, 'naddr'])
  if (opts.geminiPort !== null) {
    const geminiHost =
      opts.geminiPort === 1965 ? opts.hostname : `${opts.hostname}:${opts.geminiPort}`
    tags.push(['gemini', `gemini://${geminiHost}/<bech32>`, 'npub'])
    tags.push(['gemini', `gemini://${geminiHost}/<bech32>`, 'naddr'])
  }

  return {
    kind: HANDLER_KIND,
    created_at: now,
    tags,
    content: JSON.stringify({ name: opts.name, about: opts.about }),
  }
}
