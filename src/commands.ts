import * as nip19 from 'nostr-tools/nip19'
import path from 'node:path'
import { HoleStore } from './fetch.ts'
import type { PairingStore } from './identity.ts'
import { resolveRoute } from './router.ts'
import { renderForTerminal } from './cliview.ts'
import { browseGopher } from './gopherclient.ts'
import { resolveClientTarget } from './target.ts'
import { findSecret } from './secretguard.ts'
import { resolveSigner, pairCli, CLI_PAIRING_KEY, type CliSigner } from './signing.ts'
import { parseProfile, displayName } from './virtual.ts'
import { NOTE_KIND, DELETE_KIND, DOC_KIND, firstLine, isoDate } from './protocol.ts'
import { handlerTemplate, HANDLER_KIND, type AnnounceOptions } from './announce.ts'
import { formatHoleInspection, inspectHole, writeHoleExport } from './recovery.ts'

// The CLI client. Everything the Gemini frontend can do, without a GUI or
// a client certificate: read any hole, post through your signer, see your
// feed. Reading needs no identity at all.

export async function cmdRead(target: string, relays: string[], virtual: boolean): Promise<string> {
  const parsed = await resolveClientTarget(target)
  if (parsed.kind === 'gopher') return renderForTerminal(await browseGopher(parsed))
  const store = new HoleStore(relays)
  if (parsed.relays) store.addRelayHints(parsed.pubkey, parsed.relays)
  try {
    const content = await resolveRoute(
      { kind: 'doc', pubkey: parsed.pubkey, npub: parsed.npub, path: parsed.path },
      store,
      { virtual },
    )
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
  const parsed = await resolveClientTarget(target)
  if (parsed.kind === 'gopher') {
    if (parsed.type !== '7') {
      throw new Error(
        'gopher search needs a type 7 selector, e.g. gopher://gopher.floodgap.com/7/v2/vs',
      )
    }
    return renderForTerminal(await browseGopher(parsed, query))
  }
  const store = new HoleStore(relays)
  if (parsed.relays) store.addRelayHints(parsed.pubkey, parsed.relays)
  try {
    const content = await resolveRoute(
      { kind: 'search', pubkey: parsed.pubkey, npub: parsed.npub, path: '/', query },
      store,
      { virtual },
    )
    return renderForTerminal(content)
  } finally {
    store.close()
  }
}

export async function cmdExport(
  target: string,
  outputDir: string,
  relays: string[],
  force: boolean,
): Promise<string> {
  const parsed = await resolveClientTarget(target)
  if (parsed.kind === 'gopher') throw new Error('export needs an npub, nprofile or NIP-05 name')
  if (parsed.path !== '/') throw new Error('export takes a hole root, not an individual path')
  const store = new HoleStore(relays)
  if (parsed.relays) store.addRelayHints(parsed.pubkey, parsed.relays)
  try {
    const manifest = writeHoleExport(await store.hole(parsed.pubkey), parsed.pubkey, outputDir, {
      force,
    })
    return [
      `exported ${manifest.documents.length} document(s) for ${manifest.npub}`,
      `snapshot: ${path.resolve(outputDir)}`,
      `recover:  gopherkind publish ${path.resolve(outputDir)}`,
      '',
    ].join('\n')
  } finally {
    store.close()
  }
}

export async function cmdInspect(target: string, relays: string[]): Promise<string> {
  const parsed = await resolveClientTarget(target)
  if (parsed.kind === 'gopher') throw new Error('inspect needs an npub, nprofile or NIP-05 name')
  if (parsed.path !== '/') throw new Error('inspect takes a hole root, not an individual path')
  return formatHoleInspection(await inspectHole(parsed.pubkey, relays, parsed.relays ?? []))
}

export async function cmdPost(
  text: string,
  relays: string[],
  pairings: PairingStore,
  dryRun: boolean,
  signerOverride?: CliSigner,
): Promise<string> {
  const content = text.trim()
  if (content === '') throw new Error('nothing to post')
  const leak = findSecret(content)
  if (leak) {
    throw new Error(
      `that note contains what looks like ${leak}; refusing to sign it. ` +
        'If you meant to pair a signer, use `gopherkind pair`.',
    )
  }
  const signer = signerOverride ?? (await resolveSigner(pairings))
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
      `read it: gopherkind read ${npub}/notes/${signed.id}`,
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
  signerOverride?: CliSigner,
): Promise<string> {
  const signer = signerOverride ?? (await resolveSigner(pairings))
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
      out.push(`  gopherkind read ${authorNpub}/notes/${ev.id}`)
      out.push('')
    }
    return out.join('\n')
  } finally {
    store.close()
  }
}

// Relays worth telling about a deletion even if you never read from them.
// Deletion requests only work where the content spread, so this list is
// deliberately wider than the read set.
export const WIDE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://relayable.org',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://relay.nostr.bg',
  'wss://relay.mostr.pub',
  'wss://nostr.bitcoiner.social',
  'wss://relay.noswhere.com',
]

export function parseEventId(input: string): string {
  const raw = input.trim().replace(/^nostr:/, '')
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
  try {
    const decoded = nip19.decode(raw)
    if (decoded.type === 'note') return decoded.data
    if (decoded.type === 'nevent') return decoded.data.id
  } catch {
    // fall through to the shared error below
  }
  throw new Error(`not an event id, note1... or nevent1...: ${input}`)
}

export async function cmdDelete(
  target: string,
  relays: string[],
  pairings: PairingStore,
  opts: { dryRun: boolean; wide: boolean; reason?: string },
  signerOverride?: CliSigner,
): Promise<string> {
  const id = parseEventId(target)
  const signer = signerOverride ?? (await resolveSigner(pairings))
  const mine = await signer.pubkey()
  const readStore = new HoleStore(relays)
  let kind = NOTE_KIND
  try {
    const existing = await readStore.event(id)
    if (existing) {
      if (existing.pubkey !== mine) {
        throw new Error(
          `that event was written by ${nip19.npubEncode(existing.pubkey)}, not you; ` +
            'you can only request deletion of your own events',
        )
      }
      kind = existing.kind
    }
  } finally {
    readStore.close()
  }

  const signed = await signer.sign({
    kind: DELETE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', id],
      ['k', String(kind)],
    ],
    content: opts.reason ?? 'deleted by author',
  })
  if (opts.dryRun) return `${JSON.stringify(signed, null, 2)}\nnot published (dry run)\n`

  const targets = opts.wide ? [...new Set([...relays, ...WIDE_RELAYS])] : relays
  const store = new HoleStore(targets)
  try {
    const accepted = await store.publish(signed)
    return [
      `deletion request for kind ${kind} event ${id.slice(0, 16)}...`,
      `accepted by ${accepted}/${targets.length} relays`,
      '',
      'Deletion is a request, not a guarantee: relays may ignore it and',
      'clients may keep a local copy. If the event contained a secret,',
      'rotate the secret as well.',
      '',
    ].join('\n')
  } finally {
    store.close()
  }
}

// Tell Nostr clients that this bridge opens kind 31436 (NIP-89). Publishing
// is opt-in the same way `post` is: `--dry-run` prints the event and stops.
export async function cmdAnnounce(
  opts: AnnounceOptions,
  relays: string[],
  pairings: PairingStore,
  dryRun: boolean,
): Promise<string> {
  const template = handlerTemplate(opts, Math.floor(Date.now() / 1000))
  if (dryRun) {
    return `${JSON.stringify(template, null, 2)}\nnot signed or published (dry run)\n`
  }
  const signer = await resolveSigner(pairings)
  const signed = await signer.sign(template)
  const store = new HoleStore(relays)
  try {
    const accepted = await store.publish(signed)
    const naddr = nip19.naddrEncode({
      kind: HANDLER_KIND,
      pubkey: signed.pubkey,
      identifier: opts.identifier,
    })
    return [
      `announced this bridge via ${signer.describe}`,
      `accepted by ${accepted}/${relays.length} relays`,
      `naddr: ${naddr}`,
      '',
      'Clients that support NIP-89 can now offer this bridge for kind',
      `${DOC_KIND}. Re-run announce whenever the bridge address changes.`,
      '',
    ].join('\n')
  } finally {
    store.close()
  }
}

export async function cmdPair(uri: string, pairings: PairingStore): Promise<string> {
  const pubkey = await pairCli(pairings, uri)
  return `paired as ${nip19.npubEncode(pubkey)}\nstored for future commands; \`gopherkind unpair\` to remove\n`
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
    return [
      `signer: ${signer.describe}`,
      `name:   ${displayName(profile, npub)}`,
      `npub:   ${npub}`,
      '',
    ].join('\n')
  } finally {
    store.close()
  }
}
