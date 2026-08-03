import * as nip19 from 'nostr-tools/nip19'
import type { HoleStore } from './fetch.ts'
import type { Content } from './router.ts'
import type { MenuItem } from './resolve.ts'
import { info } from './resolve.ts'
import type { CliSigner } from './signing.ts'
import { findSecret } from './secretguard.ts'
import { parseProfile, displayName } from './virtual.ts'
import { NOTE_KIND, DELETE_KIND, firstLine, isoDate } from './protocol.ts'

// The personal menu, reachable only from loopback. Gopher has no
// authentication and no encryption, so nothing here may ever be exposed
// to the network: the credential is not sent over the wire at all, it is
// the fact that the request came from this machine. Writes use type 7
// items, whose search string is the only input channel RFC 1436 offers.

export const PERSONAL_ROOT = '/me'

export type PersonalRoute =
  | { kind: 'root' }
  | { kind: 'feed' }
  | { kind: 'follows' }
  | { kind: 'followers' }
  | { kind: 'notes' }
  | { kind: 'post'; text: string }
  | { kind: 'delete'; id: string; confirm: string }

export function matchPersonal(path: string, query: string): PersonalRoute | null {
  if (path === PERSONAL_ROOT || path === `${PERSONAL_ROOT}/`) return { kind: 'root' }
  if (!path.startsWith(`${PERSONAL_ROOT}/`)) return null
  const rest = path.slice(PERSONAL_ROOT.length + 1)
  if (rest === 'feed') return { kind: 'feed' }
  if (rest === 'follows') return { kind: 'follows' }
  if (rest === 'followers') return { kind: 'followers' }
  if (rest === 'notes') return { kind: 'notes' }
  if (rest === 'post') return { kind: 'post', text: query }
  const del = /^delete\/([0-9a-f]{64})$/.exec(rest)
  if (del) return { kind: 'delete', id: del[1] as string, confirm: query }
  return null
}

function selfLink(display: string, path: string, npub: string, type = '1'): MenuItem {
  return { type, display, target: { scheme: 'hole', npub, path } }
}

export async function resolvePersonal(
  route: PersonalRoute,
  store: HoleStore,
  signer: CliSigner,
  relayCount: number,
): Promise<Content> {
  const pubkey = await signer.pubkey()
  const npub = nip19.npubEncode(pubkey)

  switch (route.kind) {
    case 'root': {
      const profile = parseProfile(await store.profile(pubkey))
      const items: MenuItem[] = [
        info(displayName(profile, npub)),
        info(npub),
        info(''),
        info(`signing with: ${signer.describe}`),
        info(''),
        { type: '7', display: 'Post a note (type it at the prompt)', target: { scheme: 'hole', npub, path: `${PERSONAL_ROOT}/post` } },
        info(''),
        selfLink('Your feed', `${PERSONAL_ROOT}/feed`, npub),
        selfLink('Your notes (with delete links)', `${PERSONAL_ROOT}/notes`, npub),
        selfLink('Who you follow', `${PERSONAL_ROOT}/follows`, npub),
        selfLink('Your followers', `${PERSONAL_ROOT}/followers`, npub),
        info(''),
        selfLink('Your public hole', '/', npub),
      ]
      return { kind: 'menu', title: 'burrow: you', items }
    }

    case 'feed': {
      const follows = await store.contacts(pubkey)
      if (follows.length === 0) {
        return { kind: 'menu', title: 'Your feed', items: [info('No follows found.')] }
      }
      const notes = await store.feedNotes(follows.slice(0, 100))
      const profiles = await store.profilesBatch(notes.map((n) => n.pubkey))
      const items = notes.map((ev) => {
        const authorNpub = nip19.npubEncode(ev.pubkey)
        const name = displayName(parseProfile(profiles.get(ev.pubkey) ?? null), authorNpub)
        return {
          type: '0',
          display: `${isoDate(ev.created_at)}  ${name}: ${firstLine(ev.content, 60)}`,
          target: { scheme: 'hole' as const, npub: authorNpub, path: `/notes/${ev.id}` },
        }
      })
      return {
        kind: 'menu',
        title: 'Your feed',
        items: items.length > 0 ? items : [info('Nothing recent from your follows.')],
      }
    }

    case 'follows':
    case 'followers': {
      const pubkeys =
        route.kind === 'follows' ? await store.contacts(pubkey) : await store.followers(pubkey)
      const capped = pubkeys.slice(0, 200)
      const profiles = await store.profilesBatch(capped)
      const people = capped
        .map((pk) => {
          const theirNpub = nip19.npubEncode(pk)
          const profile = parseProfile(profiles.get(pk) ?? null)
          return { npub: theirNpub, name: displayName(profile, theirNpub) }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      const items: MenuItem[] = people.map((p) => ({
        type: '1',
        display: p.name,
        target: { scheme: 'hole', npub: p.npub, path: '/' },
      }))
      if (pubkeys.length > capped.length) {
        items.unshift(info(`(showing ${capped.length} of ${pubkeys.length})`))
      }
      const title = route.kind === 'follows' ? 'Who you follow' : 'Your followers'
      return {
        kind: 'menu',
        title,
        items: items.length > 0 ? items : [info('Nobody found on these relays.')],
      }
    }

    case 'notes': {
      const notes = await store.notes(pubkey)
      if (notes.length === 0) {
        return { kind: 'menu', title: 'Your notes', items: [info('No notes found.')] }
      }
      const items: MenuItem[] = []
      for (const ev of notes) {
        items.push({
          type: '0',
          display: `${isoDate(ev.created_at)}  ${firstLine(ev.content, 60)}`,
          target: { scheme: 'hole', npub, path: `/notes/${ev.id}` },
        })
        items.push({
          type: '7',
          display: `      delete this note (type: delete)`,
          target: { scheme: 'hole', npub, path: `${PERSONAL_ROOT}/delete/${ev.id}` },
        })
      }
      return { kind: 'menu', title: 'Your notes', items }
    }

    case 'post': {
      const text = route.text.trim()
      if (text === '') {
        return {
          kind: 'menu',
          title: 'Post a note',
          items: [
            info('Nothing typed, nothing posted.'),
            selfLink('Back', PERSONAL_ROOT, npub),
          ],
        }
      }
      const leak = findSecret(text)
      if (leak) {
        return {
          kind: 'menu',
          title: 'Not posting that',
          items: [
            info(`That note contains what looks like ${leak}.`),
            info('Nothing was signed and nothing was sent.'),
            info('If you leaked a bunker secret, rotate it on the signer.'),
            selfLink('Back', PERSONAL_ROOT, npub),
          ],
        }
      }
      try {
        const signed = await signer.sign({
          kind: NOTE_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: text,
        })
        const accepted = await store.publish(signed)
        return {
          kind: 'menu',
          title: 'Posted',
          items: [
            info(`Accepted by ${accepted}/${relayCount} relays.`),
            {
              type: '0',
              display: 'View your note',
              target: { scheme: 'hole', npub, path: `/notes/${signed.id}` },
            },
            selfLink('Back', PERSONAL_ROOT, npub),
          ],
        }
      } catch (err) {
        return {
          kind: 'menu',
          title: 'Posting failed',
          items: [
            info(err instanceof Error ? err.message : 'unknown error'),
            selfLink('Back', PERSONAL_ROOT, npub),
          ],
        }
      }
    }

    case 'delete': {
      if (route.confirm.trim().toLowerCase() !== 'delete') {
        return {
          kind: 'menu',
          title: 'Not deleted',
          items: [
            info('Type the word "delete" at the prompt to confirm.'),
            selfLink('Back to your notes', `${PERSONAL_ROOT}/notes`, npub),
          ],
        }
      }
      const existing = await store.event(route.id)
      if (existing && existing.pubkey !== pubkey) {
        return {
          kind: 'menu',
          title: 'Not yours',
          items: [info('You can only delete your own events.')],
        }
      }
      const signed = await signer.sign({
        kind: DELETE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', route.id],
          ['k', String(existing?.kind ?? NOTE_KIND)],
        ],
        content: 'deleted by author',
      })
      const accepted = await store.publish(signed)
      return {
        kind: 'menu',
        title: 'Deletion requested',
        items: [
          info(`Accepted by ${accepted}/${relayCount} relays.`),
          info('Relays may ignore it and clients keep local caches.'),
          selfLink('Back to your notes', `${PERSONAL_ROOT}/notes`, npub),
        ],
      }
    }
  }
}
