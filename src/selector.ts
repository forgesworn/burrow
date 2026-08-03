import * as nip19 from 'nostr-tools/nip19'

export type Route =
  | { kind: 'welcome' }
  | { kind: 'doc'; pubkey: string; npub: string; path: string }
  | { kind: 'search'; pubkey: string; npub: string; path: string; query: string }

export class SelectorError extends Error {}

// Selectors are `/<npub>/<path>`; an empty selector is the bridge welcome
// menu. A tab-separated second field is a type 7 search query (gopher+
// probes `\t+` and `\t$` are ignored).
export function parseSelector(raw: string): Route {
  const parts = raw.split('\t')
  const sel = (parts[0] ?? '').trim()
  const extra = (parts[1] ?? '').trim()
  const query = extra.startsWith('+') || extra.startsWith('$') ? '' : extra

  const trimmed = sel.replace(/^\/+/, '')
  if (trimmed === '') return { kind: 'welcome' }

  const segments = trimmed.split('/')
  const bech = segments[0] ?? ''
  let pubkey: string
  try {
    const decoded = nip19.decode(bech)
    if (decoded.type !== 'npub') throw new Error('not an npub')
    pubkey = decoded.data
  } catch {
    throw new SelectorError(`not a gopherhole: ${bech}`)
  }

  const rest = segments.slice(1)
  if (rest.some((s) => s === '..')) throw new SelectorError('bad path')
  const path = `/${rest.join('/')}`.replace(/\/+$/, '') || '/'

  if (query !== '') return { kind: 'search', pubkey, npub: bech, path, query }
  return { kind: 'doc', pubkey, npub: bech, path }
}
