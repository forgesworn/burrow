# Releasing gopherkind

Release tags are `v` followed by the exact package version. The release
workflow rejects a mismatch, runs the full quality gates, builds the npm
tarball, writes `SHA256SUMS`, and attaches both files to the GitHub release.
This path works without npm registry credentials.

```sh
npm version 0.9.1 --no-git-tag-version
# update CHANGELOG.md, review and merge
git tag -a v0.9.1 -m 'gopherkind 0.9.1'
git push origin v0.9.1
gh release create v0.9.1 --verify-tag --generate-notes
```

Publishing the GitHub release starts the workflow. Manual dispatch is the
rerun path for an existing release whose assets need rebuilding.

The registry name `gopherkind` has not had its first npm publication. The
earlier trusted-publishing attempt returned 404 because the package did not
yet exist under the publisher's ownership, despite valid GitHub provenance.
An npm owner must perform the one-time package bootstrap. This is the sole
workstation-publish exception: publish the exact checksummed GitHub release
asset, rather than rebuilding the package locally.

```sh
gh release download v0.9.1 \
  --pattern 'gopherkind-*.tgz' --pattern SHA256SUMS \
  --dir gopherkind-0.9.1-release
cd gopherkind-0.9.1-release
shasum -a 256 -c SHA256SUMS
npm login
npm publish ./gopherkind-0.9.1.tgz --access public
```

The npm account must have two-factor authentication enabled. Check the package
page and install `gopherkind@0.9.1` in a clean temporary directory before
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
