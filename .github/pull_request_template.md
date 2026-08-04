## What this changes

<!-- One paragraph. What behaviour is different afterwards? -->

## Why

<!-- The problem, or the issue number. -->

## Checks

- [ ] `npm run check` passes (lint, typecheck, coverage)
- [ ] A test covers the behaviour change
- [ ] Docs updated where behaviour is documented (README, `docs/`, SPEC.md)
- [ ] British English, no em dashes, commit style `type: description`

## Constraints this respects

- [ ] The bridge still never holds a user secret key
- [ ] No credential can cross gopher
- [ ] No long-lived relay subscription; every signer call has a hard timeout
- [ ] HTTP pages still work in lynx without JavaScript
- [ ] Signed `d` paths are still compared byte-exactly
