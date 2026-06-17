# Tokpet — macOS service distribution

- **Date**: 2026-06-17
- **Status**: Approved (design), pending spec review
- **Topic**: Ship Tokpet as a one-command macOS install that runs as a background,
  login-start service — no more keeping `npm run dev` in a terminal.

## Goal

Turn Tokpet from a foreground dev process into an end-user product on macOS: install
it once, have it run in the background, start on login, and configure it through the
existing web console. Primary distribution is Homebrew; npm is published in parallel as
a fallback for users who already have Node.

## Locked decisions (from brainstorming)

1. **Audience**: end-user product (anyone can install and run it), not just the maintainer's machine.
2. **Platform**: macOS only. Background + login-start is implemented with `launchd`.
3. **Channels**: Homebrew primary (`brew install` + `brew services`), npm published in parallel.
4. **Control**: headless background service. No GUI. Lifecycle via `brew services` (brew users)
   or `tokpet service …` (npm users); configuration via the existing web console.
5. **Scope**: implement everything in one pass. Steps that need the maintainer's credentials
   (real `npm publish`, creating the tap repo, pushing tags) are left as a documented checklist.
6. **Tap repo**: a new public repo `grpcer/homebrew-tokpet`, the standard third-party tap layout.

## Non-goals

- No Linux or Windows support (macOS only for now).
- No menu-bar app or any GUI.
- No new runtime dependencies; argv parsing is hand-written.
- No change to the `/state` JSON contract or any provider behavior.
- Fully automated release (GitHub Actions publishing + formula bumping) is out of scope for
  the first pass; see "Future work".

## Architecture

### 1. CLI command surface

Today `src/index.ts` is a single entry point that immediately starts the server. It becomes a
thin argv dispatcher. The first positional token selects a subcommand; no token defaults to `start`.

| Command | Behavior |
| --- | --- |
| `tokpet` / `tokpet start` | Run the server in the foreground. This is what `launchd`/`brew services` exec. |
| `tokpet open` | Open `http://localhost:4717` in the default browser (reuses `openBrowser`). If the service is not reachable, print a friendly hint to start it first. |
| `tokpet service install` | (npm users) Write a `launchd` LaunchAgent and load it. |
| `tokpet service uninstall` | (npm users) Unload and remove the LaunchAgent. |
| `tokpet service status` | (npm users) Report whether the agent is loaded/running. |
| `tokpet --version` | Print the version from `package.json`. |
| `tokpet --help` | Print usage. |

`brew` users do not need `tokpet service …`; `brew services` manages the agent for them. The
subcommand exists for the npm install path.

**Decomposition** (keep files small and single-purpose):

- `src/index.ts` — bin entry; argv dispatch only.
- `src/server/run.ts` (new) — `runServer()`, lifted verbatim from the current `main()` body.
- `src/cli/service.ts` (new) — `launchd` plist generation + `launchctl` calls (install/uninstall/status).
- `src/cli/open.ts` (new) — the `open` command (liveness probe + `openBrowser`).

### 2. Browser auto-open behavior change

Current `main()` opens the browser on every start unless `TOKPET_NO_OPEN` is set. A background
service must not pop a window on login. New rule:

```
open the browser only when !TOKPET_NO_OPEN && process.stdout.isTTY
```

Under `launchd`/`brew services`, stdout is redirected to a log file, so `isTTY` is false and the
browser never opens. A developer running `tokpet start` in a real terminal still gets the page.
`TOKPET_NO_OPEN` remains an explicit override; `tokpet open` is the explicit way to open it on demand.

### 3. launchd integration (two paths, one mechanism)

Both paths converge on a user-level `launchd` agent.

**Homebrew users** — the formula declares a `service` block, and `brew services start tokpet`
generates and loads the plist, manages logs, and re-runs on login.

**npm users** — `tokpet service install`:

1. Resolve absolute paths: node = `process.execPath`, script = resolved `dist/index.js`.
2. Create `~/.tokpet/logs/`.
3. Write `~/Library/LaunchAgents/com.tokpet.tokpet.plist` with:
   - `Label` = `com.tokpet.tokpet`
   - `ProgramArguments` = `[node, dist/index.js, "start"]`
   - `RunAtLoad` = true, `KeepAlive` = true
   - `StandardOutPath` / `StandardErrorPath` = `~/.tokpet/logs/tokpet.log`
   - `EnvironmentVariables` = `{ TOKPET_NO_OPEN: "1" }` (belt-and-suspenders; `isTTY` already covers it)
4. Load it: `launchctl bootout gui/<uid>/com.tokpet.tokpet` (ignore errors) then
   `launchctl bootstrap gui/<uid> <plist>`.

`uninstall` runs `launchctl bootout` and deletes the plist. `status` uses
`launchctl print gui/<uid>/com.tokpet.tokpet`. The label `com.tokpet.tokpet` is distinct from
brew's `homebrew.mxcl.tokpet`, so the two install paths never collide.

### 4. Homebrew formula + tap

A new public tap repo `grpcer/homebrew-tokpet` holds `Formula/tokpet.rb`. The formula's
source-of-truth lives in the main repo at `packaging/homebrew/tokpet.rb` and is copied to the tap
on release. The formula installs from the **npm tarball** (dist is prebuilt in the package, so the
formula only needs `node` + `npm install`, never `tsc`):

```ruby
class Tokpet < Formula
  desc "Desktop pet that surfaces real-time AI usage/quota/balance across providers"
  homepage "https://github.com/grpcer/tokpet"
  url "https://registry.npmjs.org/tokpet/-/tokpet-0.1.0.tgz"
  sha256 "<filled per release>"
  license "Apache-2.0"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  service do
    run [opt_bin/"tokpet", "start"]
    keep_alive true
    log_path var/"log/tokpet.log"
    error_log_path var/"log/tokpet.log"
  end

  def caveats
    <<~EOS
      Start the service and configure providers:
        brew services start tokpet
        tokpet open   # or visit http://localhost:4717
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tokpet --version")
  end
end
```

User flow: `brew install grpcer/tokpet/tokpet` → `brew services start tokpet` → `tokpet open`.

### 5. npm publishing

- `package.json`: add `scripts.prepublishOnly: "npm run build"` and
  `publishConfig: { "access": "public" }`. `files` already includes `dist` and `public`.
- The package name `tokpet` is unclaimed on the registry (verified: 404), so it can be published as-is.
- **Ordering matters**: `npm publish` happens first; the formula then references that tarball's URL
  and sha256. So the release sequence is: build → publish → compute sha256 → update formula → push tap.

## File-level change plan

| Path | Change |
| --- | --- |
| `src/index.ts` | Replace direct-start body with argv dispatch over subcommands. |
| `src/server/run.ts` | New: `runServer()` lifted from current `main()`; apply the `isTTY` open rule. |
| `src/cli/service.ts` | New: plist generation + `launchctl` install/uninstall/status. |
| `src/cli/open.ts` | New: `open` command (liveness probe + `openBrowser`). |
| `package.json` | Add `prepublishOnly` + `publishConfig`. |
| `packaging/homebrew/tokpet.rb` | New: formula source of truth (sha256 placeholder). |
| `README.md` | Rewrite "Setup" for end-user brew/npm install + background service; keep the develop section. |
| `RELEASE.md` | New: maintainer release + formula-bump + tap-push checklist. |
| `ai.md` | Add the new CLI subcommands to the Commands section. |
| `test/cli/service.test.ts` | New: unit tests for plist content and resolved paths. |

## Testing

- Unit-test the plist generator: given fixed node/script paths and uid, assert the produced plist
  string contains the expected `Label`, `ProgramArguments`, `RunAtLoad`, `KeepAlive`, and log paths.
- Unit-test argv dispatch: each token routes to the right handler; unknown tokens print help and
  exit non-zero.
- Keep `launchctl` calls behind a thin seam so tests cover string/path generation without spawning
  real processes.
- `npm run typecheck && npm run lint && npm run test` must stay green (the PR gate from `ai.md`).

## Documentation updates

- `README.md` "Setup" → end-user instructions: brew (primary) and npm (fallback), then `tokpet open`.
- `ai.md` "Commands" → list `tokpet start | open | service install/uninstall/status`.
- `RELEASE.md` → the maintainer checklist below.

## Maintainer release checklist (credential steps, left to the maintainer)

1. Bump `version` in `package.json`.
2. `npm run build && npm publish` (requires npm auth).
3. `sha256` of the tarball: `curl -sL https://registry.npmjs.org/tokpet/-/tokpet-<version>.tgz | shasum -a 256`.
4. Update `url` + `sha256` in `packaging/homebrew/tokpet.rb`.
5. Create the public repo `grpcer/homebrew-tokpet` (once), copy the formula to `Formula/tokpet.rb`, push.
6. Verify: `brew install grpcer/tokpet/tokpet && brew services start tokpet && tokpet open`.

## Future work (out of scope for this pass)

- GitHub Actions release workflow (tag → build → `npm publish` via `NPM_TOKEN` secret, then open a
  PR to the tap repo bumping `url`/`sha256`).
- Linux (`systemd` user unit) and Windows service support.

## Open questions

None — all decisions are locked above.
