import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { BunkerPointer } from 'nostr-tools/nip46'

// A pairing binds a Gemini client certificate (by SHA-256 fingerprint) to
// a NIP-46 bunker. clientSecretKey is the bridge's own key for talking to
// that bunker; the user's key never exists here.

export interface Pairing {
  fingerprint: string
  userPubkey: string
  clientSecretKey: string
  bunker: BunkerPointer
  pairedAt: number
}

export class PairingStore {
  private file: string
  private map = new Map<string, Pairing>()

  constructor(file: string) {
    this.file = file
    if (existsSync(file)) {
      try {
        const arr = JSON.parse(readFileSync(file, 'utf8')) as Pairing[]
        for (const p of arr) this.map.set(p.fingerprint, p)
      } catch {
        // corrupt file: start empty rather than crash the bridge
      }
    }
  }

  get(fingerprint: string): Pairing | null {
    return this.map.get(fingerprint) ?? null
  }

  set(pairing: Pairing): void {
    this.map.set(pairing.fingerprint, pairing)
    this.save()
  }

  delete(fingerprint: string): boolean {
    const had = this.map.delete(fingerprint)
    if (had) this.save()
    return had
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify([...this.map.values()], null, 2) + '\n', {
      mode: 0o600,
    })
  }
}
