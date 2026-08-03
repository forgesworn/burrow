// One crawl policy, served on both the HTTP and Gemini frontends.
//
// A bridge is a window onto relays, not an origin. Two things make it a bad
// crawl target: the gopherspace proxy would turn one bridge into a crawler's
// route into all of gopherspace, and the account paths are per-visitor state
// with nothing to index. Hole documents themselves are fine to index, and a
// bridge that wants them found is the point, so those stay allowed.

// Paths no crawler should walk, on either frontend.
const DISALLOWED = [
  '/gopher/',
  '/go',
  '/account',
  '/pair',
  '/nip07',
  '/unpair',
  '/post',
  '/publish',
  '/feed',
  '/delete',
]

// The Gemini companion spec has no wildcard agent token in practice: crawlers
// look for their own virtual agent name and fall back to `*`.
const GEMINI_AGENTS = ['*', 'indexer', 'archiver', 'researcher', 'webproxy']

export function robotsTxt(): string {
  return ['User-agent: *', ...DISALLOWED.map((p) => `Disallow: ${p}`), ''].join('\n')
}

export function geminiRobotsTxt(): string {
  const lines: string[] = []
  for (const agent of GEMINI_AGENTS) {
    lines.push(`User-agent: ${agent}`)
    for (const p of DISALLOWED) lines.push(`Disallow: ${p}`)
    lines.push('')
  }
  return lines.join('\n')
}
