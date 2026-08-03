import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
  // an unknown command prints usage and fails
  const bogus = run(srcCli, ['definitely-not-a-command'])
  assert.notEqual(bogus.status, 0)
  assert.match(bogus.out, /usage:/)
})

test('the built dist entry runs the same way', { skip: !existsSync(distCli) }, () => {
  // Guards against a broken shebang or import-extension rewrite in dist that
  // npx users would otherwise hit first.
  const none = run(distCli, [])
  assert.notEqual(none.status, 0)
  assert.match(none.out, /usage:/)
})
