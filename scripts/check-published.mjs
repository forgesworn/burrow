// Every release tag since the first npm publish must have a version on npm.
//
// v0.16.2 was tagged, released on GitHub, and never published: the release
// event was dropped and release.yml never ran. Nothing went red, because a
// workflow that does not fire cannot fail. So this check lives outside that
// workflow and compares what is tagged against what is actually installable.
//
// Tags older than the first published version are ignored. The package was
// published for the first time at 0.16.1, and the twenty-five tags before it
// were never meant to be on the registry.
//
// usage: node scripts/check-published.mjs [package-name]

import { execFileSync } from 'node:child_process'

const pkg = process.argv[2] ?? 'gopherkind'

// Tags deliberately left unpublished, each with its reason. An entry here is a
// decision on the record, not a way to quiet the check: anything not listed
// still has to be on the registry.
//
// v0.16.2 carried only documentation, and by the time the dropped release was
// noticed its code also carried the menu control-character bug fixed in
// 0.16.3. Publishing it to satisfy this check would have put a known-bad
// version on the registry to make a green tick, so its content ships in 0.16.3
// instead.
const ABANDONED = new Set(['v0.16.2'])

function parse(version) {
  const parts = version.split('.').map(Number)
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

const published = JSON.parse(
  execFileSync('npm', ['view', pkg, 'versions', '--json'], {
    encoding: 'utf8',
  }),
)
// npm collapses a single-version list to a bare string.
const versions = (Array.isArray(published) ? published : [published]).filter(
  (v) => parse(v) !== null,
)

if (versions.length === 0) {
  console.log(`${pkg} has no published versions, nothing to compare`)
  process.exit(0)
}

const floor = versions.map(parse).sort(compare)[0]

// A tag is pushed before the release workflow finishes publishing, so for a few
// minutes a perfectly healthy release is tagged and not yet on npm. Failing
// then would redden every build started in that window, and a check that cries
// wolf at every release is one nobody reads. The daily run is what catches a
// release that stays missing.
const GRACE_SECONDS = 45 * 60

const ages = new Map(
  execFileSync(
    'git',
    ['for-each-ref', '--format=%(refname:short) %(creatordate:unix)', 'refs/tags/v*'],
    {
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [tag, seconds] = line.trim().split(' ')
      return [tag, Number(seconds)]
    }),
)

const now = Math.floor(Date.now() / 1000)
const tags = [...ages.keys()]

const absent = tags.filter((tag) => {
  if (ABANDONED.has(tag)) return false
  const version = parse(tag.slice(1))
  return version !== null && compare(version, floor) >= 0 && !versions.includes(tag.slice(1))
})

const inFlight = absent.filter((tag) => now - (ages.get(tag) ?? 0) < GRACE_SECONDS)
const missing = absent.filter((tag) => !inFlight.includes(tag))

for (const tag of inFlight) {
  console.log(`${tag} is not on npm yet, tagged less than 45 minutes ago; treating as in flight`)
}

if (missing.length > 0) {
  console.error(`tagged but absent from npm: ${missing.join(' ')}`)
  console.error('re-run release.yml with workflow_dispatch for each, then re-run this check')
  process.exit(1)
}

console.log(
  `every release tag from v${floor.join('.')} onward is installable from npm (${tags.length} tags, ${versions.length} versions)`,
)
