import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Event, EventTemplate } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46'
import type { Pairing } from './identity.ts'
import { publicRelayUrls, safeRelayUrls, trustRelayUrls } from './netguard.ts'

// NIP-46 with hard timeouts on everything. nostr-tools has no per-request
// timeout of its own, and a signer waiting for a human (or a powered-off
// ESP32) would otherwise hang the request forever. One signer per
// operation, closed straight after, so no long-lived subscriptions.

export interface PairResult {
  userPubkey: string
  clientSecretKey: string
  bunker: Pairing['bunker']
}

export interface RemoteSigner {
  pair(input: string, timeoutMs?: number): Promise<PairResult>
  startConnect(relays: string[], name: string): { uri: string; finish: Promise<PairResult> }
  sign(pairing: Pairing, template: EventTemplate, timeoutMs?: number): Promise<Event>
}

export interface Nip46ClientOptions {
  // A CLI user may deliberately resolve a bunker through NIP-05. Public HTTP
  // and Gemini pairing accept bunker:// only so an anonymous visitor cannot
  // turn the bridge's HTTPS client into an SSRF primitive.
  allowNip05?: boolean
  // CLI input is an operator decision and may deliberately name a signer on
  // the LAN. Public frontends leave this false.
  trustLocalRelays?: boolean
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    )
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

export function assertSignedTemplate(
  signed: Event,
  pairing: Pairing,
  template: EventTemplate,
): Event {
  if (
    signed.pubkey !== pairing.userPubkey ||
    signed.kind !== template.kind ||
    signed.created_at !== template.created_at ||
    signed.content !== template.content ||
    JSON.stringify(signed.tags) !== JSON.stringify(template.tags)
  ) {
    throw new Error('remote signer returned an event different from the requested template')
  }
  return signed
}

export class Nip46Client implements RemoteSigner {
  private allowNip05: boolean
  private trustLocalRelays: boolean

  constructor(opts: Nip46ClientOptions = {}) {
    this.allowNip05 = opts.allowNip05 === true
    this.trustLocalRelays = opts.trustLocalRelays === true
  }

  async pair(input: string, timeoutMs = 60_000): Promise<PairResult> {
    const raw = input.trim()
    if (!raw.startsWith('bunker://') && !this.allowNip05) {
      throw new Error('public pairing requires a bunker:// URI')
    }
    const bp = await withTimeout(parseBunkerInput(raw), 10_000, 'resolving bunker address')
    if (!bp) throw new Error('not a valid bunker:// URI or NIP-05 bunker address')
    const syntactic = safeRelayUrls(bp.relays, bp.relays.length, this.trustLocalRelays)
    const permitted = this.trustLocalRelays ? syntactic : await publicRelayUrls(bp.relays)
    if (syntactic.length !== bp.relays.length || permitted.length !== syntactic.length) {
      throw new Error('bunker relay address is not permitted')
    }
    if (this.trustLocalRelays) trustRelayUrls(permitted)
    bp.relays = permitted
    const sk = generateSecretKey()
    const signer = BunkerSigner.fromBunker(sk, bp)
    try {
      await withTimeout(signer.connect(), timeoutMs, 'bunker connect (approve it on your signer)')
      const userPubkey = await withTimeout(signer.getPublicKey(), timeoutMs, 'get_public_key')
      return { userPubkey, clientSecretKey: Buffer.from(sk).toString('hex'), bunker: signer.bp }
    } finally {
      await signer.close().catch(() => {})
    }
  }

  startConnect(relays: string[], name: string): { uri: string; finish: Promise<PairResult> } {
    trustRelayUrls(relays)
    const sk = generateSecretKey()
    const secret = Buffer.from(generateSecretKey()).toString('hex').slice(0, 16)
    const uri = createNostrConnectURI({ clientPubkey: getPublicKey(sk), relays, secret, name })
    const finish = (async (): Promise<PairResult> => {
      const signer = await BunkerSigner.fromURI(sk, uri, {}, 120_000)
      try {
        const userPubkey = await withTimeout(signer.getPublicKey(), 30_000, 'get_public_key')
        return { userPubkey, clientSecretKey: Buffer.from(sk).toString('hex'), bunker: signer.bp }
      } finally {
        await signer.close().catch(() => {})
      }
    })()
    return { uri, finish }
  }

  async sign(pairing: Pairing, template: EventTemplate, timeoutMs = 60_000): Promise<Event> {
    const sk = Uint8Array.from(Buffer.from(pairing.clientSecretKey, 'hex'))
    const signer = BunkerSigner.fromBunker(sk, pairing.bunker)
    try {
      await withTimeout(signer.connect(), timeoutMs, 'bunker connect (approve it on your signer)')
      const signed = await withTimeout(
        signer.signEvent(template),
        timeoutMs,
        'signing (approve it on your signer)',
      )
      return assertSignedTemplate(signed, pairing, template)
    } finally {
      await signer.close().catch(() => {})
    }
  }
}
