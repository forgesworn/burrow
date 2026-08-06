# Releasing gopherkind

Release tags are `v` followed by the exact package version. The release
workflow rejects a mismatch, runs the full quality gates, builds the npm
tarball, writes `SHA256SUMS`, and attaches both files to the GitHub release.
This path works without npm registry credentials.

```sh
npm version 0.16.2 --no-git-tag-version
# update CHANGELOG.md, review and merge
git tag -a v0.16.2 -m 'gopherkind 0.16.2'
git push origin v0.16.2
gh release create v0.16.2 --verify-tag --generate-notes
```

Publishing the GitHub release starts the workflow. Manual dispatch is the
rerun path for an existing release whose assets need rebuilding.

## The one-time bootstrap, and how it actually went

`gopherkind` was bootstrapped on the registry at `0.16.1` on 2026-08-06.
Recorded here because the steps are not repeatable and the reasoning is worth
keeping: the earlier trusted-publishing attempt returned 404 because the
package did not yet exist under the publisher's ownership, despite valid
GitHub provenance. A package must exist before a trusted publisher can be
attached to it, so exactly one workstation publish is unavoidable.

The intended path was to publish the checksummed release asset rather than a
local rebuild:

```sh
gh release download v0.16.1 \
  --pattern 'gopherkind-*.tgz' --pattern SHA256SUMS \
  --dir gopherkind-0.16.1-release
cd gopherkind-0.16.1-release
shasum -a 256 -c SHA256SUMS
npm login
npm publish ./gopherkind-0.16.1.tgz --access public --provenance=false
```

That is still the right path. It was not the one taken: GitHub Actions was in
a major outage for the whole of that day, and the release workflow was
cancelled at the queue timeout on every attempt without executing a step, so
no asset was ever attached. The tarball was instead built from a clean shallow
clone of the tag, running the same sequence the workflow runs (`npm ci`, lint,
typecheck, coverage, `npm audit --audit-level=high`, tag/version check,
`npm pack`, `sha256sum`), and published from there. It is byte-identical to
what the registry now serves:

```
7626b8a3b99f0c4544739ecc9f3f6eea6a33a1c03f23018855c16df47f807520
```

Anyone repeating a bootstrap should prefer the release asset. Building locally
trades away the ephemeral build environment, and is only defensible when the
alternative is waiting out someone else's outage and the checksum is recorded
where others can check it, as above.

`--provenance=false` is required and is not optional tidying.
`publishConfig.provenance` is `true` in `package.json`, which is correct for
every release that goes through `release.yml`, but provenance can only be
attested by a supported CI provider holding an OIDC token. Run from a
workstation there is no provider, and npm fails before uploading anything:

```
npm error code EUSAGE
npm error Automatic provenance generation not supported for provider: null
```

So the bootstrap publication carries no provenance attestation. That is
unavoidable rather than a shortcut: the package must exist before a trusted
publisher can be attached to it, and nothing outside CI can sign that
attestation. Every release after this one gets provenance normally.

The npm account must have two-factor authentication enabled. Check the package
page and install `gopherkind@0.16.1` in a clean temporary directory before
configuring its trusted publisher. npm 11.11 or later can do that directly:

```sh
npm trust github gopherkind \
  --file release.yml \
  --repo forgesworn/gopherkind \
  --env npm-publish
npm trust list gopherkind
gh variable set NPM_PUBLISH_ENABLED --body true
```

The equivalent npm website fields are:

- provider: GitHub Actions
- organisation: `forgesworn`
- repository: `gopherkind`
- workflow filename: `release.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

Future releases will run the pinned ForgeSworn anvil workflow after the GitHub
tarball is safely attached. Do not add a long-lived npm token and do not publish
subsequent releases from a workstation.
