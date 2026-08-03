import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Gemini expects TLS with long-lived self-signed certs (clients do TOFU).
// Generate one into the state dir on first run; openssl is everywhere.
export function ensureSelfSignedCert(dir: string, cn: string): { cert: string; key: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const cert = path.join(dir, 'cert.pem')
  const key = path.join(dir, 'key.pem')
  if (existsSync(cert) && existsSync(key)) return { cert, key }
  const base = [
    'req', '-x509',
    '-newkey', 'ec',
    '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-keyout', key,
    '-out', cert,
    '-days', '3650',
    '-nodes',
    '-subj', `/CN=${cn}`,
  ]
  // A subjectAltName is required by newer Gemini clients, but -addext is not
  // in every openssl/LibreSSL build; fall back to a cert without it rather
  // than failing to serve Gemini at all.
  let res = spawnSync('openssl', [...base, '-addext', `subjectAltName=DNS:${cn}`], { stdio: 'ignore' })
  if (res.status !== 0) res = spawnSync('openssl', base, { stdio: 'ignore' })
  if (res.status !== 0) {
    throw new Error('could not generate a certificate (is openssl installed?); pass --cert/--key')
  }
  // openssl's -keyout permissions vary by version and platform; the TLS key
  // is a credential (it authenticates the bridge to cert-binding clients),
  // so lock it down explicitly rather than trusting the default.
  chmodSync(key, 0o600)
  return { cert, key }
}
