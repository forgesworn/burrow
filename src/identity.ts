import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync } from 'node:fs'
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
    const dir = path.dirname(this.file)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // Write to a temp file and rename so a crash mid-write cannot truncate
    // the store and lose every pairing. writeFileSync's mode only applies on
    // creation, so chmod explicitly in case the destination already exists.
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify([...this.map.values()], null, 2)}\n`, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.file)
    chmodSync(this.file, 0o600)
  }
}
