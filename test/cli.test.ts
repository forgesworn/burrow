import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const srcCli = path.join(root, 'src', 'cli.ts')
const distCli = path.join(root, 'dist', 'cli.js')

function run(entry: string, args: string[]): { status: number | null; out: string } {
  const res = spawnSync('node', [entry, ...args], {
    input: '', // not a TTY, so no-args must not drop into the interactive browser
    encoding: 'utf8',
    timeout: 15_000,
  })
  return { status: res.status, out: `${res.stdout}${res.stderr}` }
}

test('cli usage and argument validation (source)', () => {
  // no args, non-interactive stdin -> usage, non-zero exit
  const none = run(srcCli, [])
  assert.notEqual(none.status, 0)
  assert.match(none.out, /usage:/)

  // read with no target fails
  assert.notEqual(run(srcCli, ['read']).status, 0)
  // search with no query fails
  assert.notEqual(run(srcCli, ['search', 'npub1abc']).status, 0)
  // publish with no directory fails
  assert.notEqual(run(srcCli, ['publish']).status, 0)
  // recovery commands require their targets and export destination
  assert.notEqual(run(srcCli, ['inspect']).status, 0)
  assert.notEqual(run(srcCli, ['export', 'npub1abc']).status, 0)
  // an unknown command prints usage and fails
  const bogus = run(srcCli, ['definitely-not-a-command'])
  assert.notEqual(bogus.status, 0)
  assert.match(bogus.out, /usage:/)
})

test('version and help are answerable without a signer or a relay', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version: string
  }
  for (const flag of ['version', '--version', '-v']) {
    const result = run(srcCli, [flag])
    assert.equal(result.status, 0)
    assert.equal(result.out.trim(), `gopherkind ${manifest.version}`)
  }
  for (const flag of ['help', '--help', '-h']) {
    const result = run(srcCli, [flag])
    assert.equal(result.status, 0)
    assert.match(result.out, /usage:/)
  }
})

test('the built dist entry runs the same way', { skip: !existsSync(distCli) }, () => {
  // Guards against a broken shebang or import-extension rewrite in dist that
  // npx users would otherwise hit first.
  const none = run(distCli, [])
  assert.notEqual(none.status, 0)
  assert.match(none.out, /usage:/)
})

test('the built dist entry is executable', { skip: !existsSync(distCli) }, () => {
  // tsc writes 0644. `npm install` chmods a bin target on the way in, so a
  // global install hid this, but npx executes the file directly and got
  // "Permission denied". The test above could never catch it, because it runs
  // dist through `node` rather than executing it the way a bin link does.
  assert.ok(statSync(distCli).mode & 0o111, 'dist/cli.js needs its executable bit')
  const direct = spawnSync(distCli, [], { encoding: 'utf8' })
  assert.equal(direct.error, undefined, `executing dist/cli.js directly failed: ${direct.error}`)
  assert.match(`${direct.stdout}${direct.stderr}`, /usage:/)
})

test('serve defaults to loopback and exits cleanly on SIGTERM', async () => {
  const child = spawn(
    'node',
    [srcCli, 'serve', '--port', '0', '--http-port', '0', '--no-gemini', '--no-identity'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10_000)
    const collect = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      if (output.includes('gopherkind: http on 127.0.0.1:0')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', reject)
  })
  try {
    await ready
    child.kill('SIGTERM')
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => child.once('exit', (code, signal) => resolve({ code, signal })),
    )
    assert.deepEqual(result, { code: 0, signal: null })
    assert.match(output, /SIGTERM, closing listeners/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
})

test('a wildcard bind requires an advertised hostname', () => {
  const result = run(srcCli, ['serve', '--host', '0.0.0.0', '--no-gemini', '--no-http'])
  assert.notEqual(result.status, 0)
  assert.match(result.out, /--hostname is required/)
})

test('public HTTP identity requires an explicit safe proxy contract', () => {
  const noUrl = run(srcCli, [
    'serve',
    '--host',
    '0.0.0.0',
    '--hostname',
    'bridge.example',
    '--http-behind-proxy',
    '--no-local-trust',
    '--no-gemini',
  ])
  assert.notEqual(noUrl.status, 0)
  assert.match(noUrl.out, /requires an https --http-url/)

  const localTrust = run(srcCli, [
    'serve',
    '--host',
    '0.0.0.0',
    '--hostname',
    'bridge.example',
    '--http-behind-proxy',
    '--http-url',
    'https://bridge.example',
    '--no-gemini',
  ])
  assert.notEqual(localTrust.status, 0)
  assert.match(localTrust.out, /requires --no-local-trust/)

  const badOrigin = run(srcCli, [
    'serve',
    '--hostname',
    'bridge.example',
    '--http-url',
    'https://bridge.example/not-an-origin',
    '--no-gemini',
    '--no-http',
  ])
  assert.notEqual(badOrigin.status, 0)
  assert.match(badOrigin.out, /without a path/)
})

test('post accepts --as, so a note can name the identity it claims', () => {
  // The signer that answers is whichever bunker happens to be running, and a
  // note is as much an identity claim as a document is. Without --as,
  // announcing from the wrong key is silent. publish has refused a mismatch
  // since 0.16.2; post had no such guard until 0.16.7.
  //
  // Reaching the comparison needs a signer, and requireSignerIdentity is
  // covered directly in the signing tests. What this asserts is that the flag
  // is wired at all: before it was, this failed with ERR_PARSE_ARGS_UNKNOWN_OPTION.
  const result = run(srcCli, ['post', 'hello', '--as', 'npub1whatever'])
  assert.notEqual(result.status, 0)
  assert.doesNotMatch(result.out, /UNKNOWN_OPTION/)
  assert.match(result.out, /no signer/)
})
