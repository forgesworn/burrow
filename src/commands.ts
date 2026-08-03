import * as nip19 from 'nostr-tools/nip19'
import { HoleStore } from './fetch.ts'
import { PairingStore } from './identity.ts'
import { parseSelector } from './selector.ts'
import { resolveRoute } from './router.ts'
import { renderForTerminal } from './cliview.ts'
import { findSecret } from './secretguard.ts'
import { resolveSigner, pairCli, CLI_PAIRING_KEY, type CliSigner } from './signing.ts'
import { parseProfile, displayName } from './virtual.ts'
import { NOTE_KIND, firstLine, isoDate } from './protocol.ts'

// The CLI client. Everything the Gemini frontend can do, without a GUI or
// a client certificate: read any hole, post through your signer, see your
// feed. Reading needs no identity at all.

export async function cmdRead(target: string, relays: string[], virtual: boolean): Promise<string> {
  const store = new HoleStore(relays)
  try {
    const route = parseSelector(normaliseTarget(target))
    if (route.kind === 'welcome') throw new Error('give an npub, e.g. burrow read npub1...')
    const content = await resolveRoute(route, store, { virtual })
    return renderForTerminal(content)
  } finally {
    store.close()
  }
}

export async function cmdSearch(
  target: string,
  query: string,
  relays: string[],
  virtual: boolean,
): Promise<string> {
  const store = new HoleStore(relays)
  try {
    const route = parseSelector(normaliseTarget(target))
    if (route.kind !== 'doc') throw new Error('give an npub to search')
    const content = await resolveRoute(
      { kind: 'search', pubkey: route.pubkey, npub: route.npub, path: '/', query },
      store,
      { virtual },
    )
    return renderForTerminal(content)
  } finally {
    store.close()
  }
}

export async function cmdPost(
  text: string,
  relays: string[],
  pairings: PairingStore,
  dryRun: boolean,
): Promise<string> {
  const content = text.trim()
  if (content === '') throw new Error('nothing to post')
  const leak = findSecret(content)
  if (leak) {
    throw new Error(
      `that note contains what looks like ${leak}; refusing to sign it. ` +
        'If you meant to pair a signer, use `burrow pair`.',
    )
  }
  const signer = await resolveSigner(pairings)
  const signed = await signer.sign({
    kind: NOTE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content,
  })
  if (dryRun) return `${JSON.stringify(signed, null, 2)}\nnot published (dry run)\n`
  const store = new HoleStore(relays)
  try {
    const accepted = await store.publish(signed)
    const npub = nip19.npubEncode(signed.pubkey)
    return [
      `posted via ${signer.describe}`,
      `accepted by ${accepted}/${relays.length} relays`,
      `nevent: ${nip19.neventEncode({ id: signed.id, author: signed.pubkey })}`,
      `read it: burrow read ${npub}/notes/${signed.id}`,
      '',
    ].join('\n')
  } finally {
    store.close()
  }
}

export async function cmdFeed(
  relays: string[],
  pairings: PairingStore,
  limit: number,
): Promise<string> {
  const signer = await resolveSigner(pairings)
  const pubkey = await signer.pubkey()
  const store = new HoleStore(relays)
  try {
    const follows = await store.contacts(pubkey)
    if (follows.length === 0) return 'no follows found (kind 3 empty or unreachable)\n'
    const notes = (await store.feedNotes(follows.slice(0, 100))).slice(0, limit)
    if (notes.length === 0) return 'nothing recent from your follows on these relays\n'
    const profiles = await store.profilesBatch(notes.map((n) => n.pubkey))
    const out: string[] = [`feed for ${nip19.npubEncode(pubkey)} (${follows.length} follows)`, '']
    for (const ev of notes) {
      const authorNpub = nip19.npubEncode(ev.pubkey)
      const name = displayName(parseProfile(profiles.get(ev.pubkey) ?? null), authorNpub)
      out.push(`${isoDate(ev.created_at)}  ${name}`)
      out.push(`  ${firstLine(ev.content, 76)}`)
      out.push(`  burrow read ${authorNpub}/notes/${ev.id}`)
      out.push('')
    }
    return out.join('\n')
  } finally {
    store.close()
  }
}

export async function cmdPair(uri: string, pairings: PairingStore): Promise<string> {
  const pubkey = await pairCli(pairings, uri)
  return `paired as ${nip19.npubEncode(pubkey)}\nstored for future commands; \`burrow unpair\` to remove\n`
}

export function cmdUnpair(pairings: PairingStore): string {
  return pairings.delete(CLI_PAIRING_KEY)
    ? 'unpaired; revoke the session on your signer too\n'
    : 'no stored pairing\n'
}

export async function cmdWhoami(relays: string[], pairings: PairingStore): Promise<string> {
  let signer: CliSigner
  try {
    signer = await resolveSigner(pairings)
  } catch (err) {
    return `${err instanceof Error ? err.message : String(err)}\n`
  }
  const pubkey = await signer.pubkey()
  const npub = nip19.npubEncode(pubkey)
  const store = new HoleStore(relays)
  try {
    const profile = parseProfile(await store.profile(pubkey))
    return [`signer: ${signer.describe}`, `name:   ${displayName(profile, npub)}`, `npub:   ${npub}`, ''].join('\n')
  } finally {
    store.close()
  }
}

// Accepts npub, npub/path, or a full gopher://host/1/npub/path selector.
function normaliseTarget(target: string): string {
  let t = target.trim()
  if (t.startsWith('gopher://')) {
    try {
      const url = new URL(t)
      t = url.pathname.length > 2 ? decodeURIComponent(url.pathname.slice(2)) : ''
    } catch {
      // leave as-is and let the selector parser complain
    }
  }
  if (t.startsWith('nostr:')) t = t.slice(6)
  return t.startsWith('/') ? t : `/${t}`
}
