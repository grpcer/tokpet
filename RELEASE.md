# Releasing Tokpet

Distribution is npm-first (the formula installs from the npm tarball), so npm is
published before the Homebrew formula is bumped.

1. Bump `version` in `package.json`; commit.
2. `npm run typecheck && npm run lint && npm run test`.
3. `npm publish` (runs `prepublishOnly` → `npm run build`; requires npm auth).
4. Get the tarball sha256:
   `curl -sL https://registry.npmjs.org/tokpet/-/tokpet-<version>.tgz | shasum -a 256`
5. Update `url` and `sha256` in `packaging/homebrew/tokpet.rb`; commit.
6. Sync the formula to the tap (first time: create the public repo
   `grpcer/homebrew-tokpet` with a `Formula/` directory):
   `cp packaging/homebrew/tokpet.rb <tap>/Formula/tokpet.rb` then commit + push the tap.
7. Verify end to end:
   `brew install grpcer/tokpet/tokpet && brew services start tokpet && tokpet open`.
