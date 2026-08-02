import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Gemini expects TLS with long-lived self-signed certs (clients do TOFU).
// Generate one into the state dir on first run; openssl is everywhere.
export function ensureSelfSignedCert(dir: string, cn: string): { cert: string; key: string } {
  mkdirSync(dir, { recursive: true })
  const cert = path.join(dir, 'cert.pem')
  const key = path.join(dir, 'key.pem')
  if (existsSync(cert) && existsSync(key)) return { cert, key }
  const res = spawnSync(
    'openssl',
    [
      'req', '-x509',
      '-newkey', 'ec',
      '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-keyout', key,
      '-out', cert,
      '-days', '3650',
      '-nodes',
      '-subj', `/CN=${cn}`,
    ],
    { stdio: 'ignore' },
  )
  if (res.status !== 0) {
    throw new Error('could not generate a certificate (is openssl installed?); pass --cert/--key')
  }
  return { cert, key }
}
