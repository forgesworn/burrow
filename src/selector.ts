import * as nip19 from 'nostr-tools/nip19'
import { isValidDocPath } from './protocol.ts'

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
  const sel = parts[0] ?? ''
  const extra = parts[1] ?? ''
  const query = extra.startsWith('+') || extra.startsWith('$') ? '' : extra

  if (sel === '' || sel === '/') return { kind: 'welcome' }
  const addressed = sel.startsWith('/') ? sel.slice(1) : sel
  const slash = addressed.indexOf('/')
  const bech = slash === -1 ? addressed : addressed.slice(0, slash)
  let pubkey: string
  try {
    const decoded = nip19.decode(bech)
    if (decoded.type !== 'npub') throw new Error('not an npub')
    pubkey = decoded.data
  } catch {
    throw new SelectorError(`not a gopherhole: ${bech}`)
  }

  const path = slash === -1 ? '/' : addressed.slice(slash)
  if (!isValidDocPath(path)) throw new SelectorError('bad path')

  if (query !== '') return { kind: 'search', pubkey, npub: bech, path, query }
  return { kind: 'doc', pubkey, npub: bech, path }
}
