# macOS Service Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tokpet as a one-command macOS install that runs as a background, login-start service, controlled by a small CLI plus the existing web console.

**Architecture:** `src/index.ts` becomes a thin argv dispatcher. The server runtime moves to `src/server/run.ts`. A new `src/cli/` holds the `open` command and the launchd `service` integration. Homebrew (primary) ships a formula with a `service` block; npm (parallel) ships the same package, and npm users run `tokpet service install` to write a per-user LaunchAgent.

**Tech Stack:** Node ≥ 20, TypeScript (ESM, NodeNext), Fastify, Vitest, launchd, Homebrew.

## Global Constraints

- Node `>=20`; TypeScript ESM with NodeNext — **all relative imports end in `.js`**.
- macOS only for the service features (`launchd`). No Linux/Windows service code.
- **No new runtime dependencies** — argv parsing is hand-written.
- Every source file starts with `// SPDX-License-Identifier: Apache-2.0`.
- **English only** in everything committed (code, comments, docs, commit messages).
- Comments explain _why_, not _what_; match surrounding style.
- Conventional Commits (`<type>(<scope>): <summary>`).
- PR gate must stay green: `npm run typecheck && npm run lint && npm run test`.
- Do **not** change the `/state` JSON schema or any provider behavior.
- Default port stays `4717`, overridable via `PORT`.

## File Structure

| Path                                    | Responsibility                                             |
| --------------------------------------- | ---------------------------------------------------------- |
| `src/index.ts` (modify)                 | Bin entry; argv dispatch only.                             |
| `src/cli/commands.ts` (create)          | Pure argv → command resolver.                              |
| `src/server/run.ts` (create)            | `runServer()` + port resolution + isTTY browser rule.      |
| `src/cli/service.ts` (create)           | launchd plist rendering (pure) + install/uninstall/status. |
| `src/cli/open.ts` (create)              | `open` command (liveness probe + browser).                 |
| `package.json` (modify)                 | `prepublishOnly` + `publishConfig`.                        |
| `packaging/homebrew/tokpet.rb` (create) | Formula source of truth (synced to tap on release).        |
| `README.md` (modify)                    | End-user Setup (brew + npm), keep Develop section.         |
| `RELEASE.md` (create)                   | Maintainer release + formula-bump + tap-push checklist.    |
| `ai.md` (modify)                        | Add CLI subcommands to Commands.                           |
| `test/cli/commands.test.ts` (create)    | Unit tests for the resolver.                               |
| `test/cli/service.test.ts` (create)     | Unit tests for plist content + paths.                      |

---

### Task 1: CLI command resolver

**Files:**

- Create: `src/cli/commands.ts`
- Test: `test/cli/commands.test.ts`

**Interfaces:**

- Produces: `type Command` (discriminated union) and `resolveCommand(argv: readonly string[]): Command`.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/commands.test.ts
import { describe, expect, it } from 'vitest';
import { resolveCommand } from '../../src/cli/commands.js';

describe('resolveCommand', () => {
  it('defaults to start with no args', () => expect(resolveCommand([])).toEqual({ kind: 'start' }));
  it('maps start', () => expect(resolveCommand(['start'])).toEqual({ kind: 'start' }));
  it('maps open', () => expect(resolveCommand(['open'])).toEqual({ kind: 'open' }));
  it('maps service actions', () => {
    expect(resolveCommand(['service', 'install'])).toEqual({ kind: 'service', action: 'install' });
    expect(resolveCommand(['service', 'uninstall'])).toEqual({
      kind: 'service',
      action: 'uninstall',
    });
    expect(resolveCommand(['service', 'status'])).toEqual({ kind: 'service', action: 'status' });
  });
  it('rejects an unknown service action as help+error', () => {
    expect(resolveCommand(['service', 'frobnicate']).kind).toBe('help');
  });
  it('maps version flags', () =>
    expect(resolveCommand(['--version'])).toEqual({ kind: 'version' }));
  it('unknown command falls to help with an error', () => {
    const c = resolveCommand(['wat']);
    expect(c).toMatchObject({ kind: 'help' });
    expect((c as { error?: string }).error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run test/cli/commands.test.ts`
Expected: FAIL — cannot find `src/cli/commands.js`.

- [ ] **Step 3: Implement**

```ts
// src/cli/commands.ts
// SPDX-License-Identifier: Apache-2.0
//
// Maps argv into a single command token. Pure and side-effect free so the
// dispatcher in index.ts stays a thin shell and routing is unit-testable.

export type Command =
  | { kind: 'start' }
  | { kind: 'open' }
  | { kind: 'service'; action: 'install' | 'uninstall' | 'status' }
  | { kind: 'version' }
  | { kind: 'help'; error?: string };

export function resolveCommand(argv: readonly string[]): Command {
  const [first, second] = argv;
  if (first === undefined || first === 'start') return { kind: 'start' };
  if (first === 'open') return { kind: 'open' };
  if (first === '--version' || first === '-v') return { kind: 'version' };
  if (first === '--help' || first === '-h' || first === 'help') return { kind: 'help' };
  if (first === 'service') {
    if (second === 'install' || second === 'uninstall' || second === 'status') {
      return { kind: 'service', action: second };
    }
    return { kind: 'help', error: `unknown service action: ${second ?? '(none)'}` };
  }
  return { kind: 'help', error: `unknown command: ${first}` };
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `npx vitest run test/cli/commands.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(cli): add argv command resolver`

---

### Task 2: Extract `runServer` into `src/server/run.ts`

**Files:**

- Create: `src/server/run.ts`
- (Body is lifted verbatim from the current `src/index.ts` `main()`.)

**Interfaces:**

- Produces: `DEFAULT_PORT: number`, `resolvePort(): number`, `runServer(port?: number): Promise<void>`.
- Consumes: existing `startServer`, `publishMdns`, `createRuntimeState`, `markMdnsPublished`, `loadConfig`, `orderedProviderIds`, `findProvider`, `Aggregator`, `openBrowser`.

- [ ] **Step 1: Create the module**

```ts
// src/server/run.ts
// SPDX-License-Identifier: Apache-2.0
//
// Foreground server runtime, lifted from the original index.ts main(): restore
// activated providers, start HTTP + mDNS, and — only on an interactive TTY —
// open the setup page. Under launchd / brew services stdout is a log file, so
// isTTY is false and no browser window is popped on login.

import { Aggregator } from '../aggregator/state.js';
import { findProvider } from '../providers/registry.js';
import { startServer } from './http.js';
import { loadConfig, orderedProviderIds } from '../config/store.js';
import { openBrowser } from './open-browser.js';
import { publishMdns } from './mdns.js';
import { createRuntimeState, markMdnsPublished } from './runtime.js';

export const DEFAULT_PORT = 4717;

export function resolvePort(): number {
  return Number(process.env.PORT) || DEFAULT_PORT;
}

export async function runServer(port: number = resolvePort()): Promise<void> {
  const agg = new Aggregator();
  const runtime = createRuntimeState(port);

  const config = await loadConfig();
  // Restore in the user-chosen display order so the very first /state poll
  // already lines up with the console and the device tiles.
  for (const id of orderedProviderIds(config)) {
    const provider = findProvider(id);
    if (!provider) {
      console.warn(`[tokpet] skipping unknown provider '${id}' from config`);
      continue;
    }
    agg.register(provider, config.providers[id]);
    console.log(`[tokpet] restored ${provider.mode}/${provider.id}`);
  }

  await startServer(agg, port, runtime);
  const mdns = publishMdns(port, {
    onStatus: () => markMdnsPublished(runtime),
  });
  const url = `http://localhost:${port}/`;
  console.log(`[tokpet] setup page:  ${url}`);
  console.log(`[tokpet] state JSON:  ${url}state`);
  console.log(`[tokpet] mDNS:        _tokpet._tcp.local:${port}`);
  // Only pop the browser for an interactive foreground run. Under a background
  // service manager stdout is redirected, so isTTY is false and we stay quiet.
  if (!process.env.TOKPET_NO_OPEN && process.stdout.isTTY) openBrowser(url);

  const stop = async () => {
    await mdns.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → no errors.
- [ ] **Step 3: Commit** — `refactor(server): extract runServer with an isTTY browser rule`

---

### Task 3: launchd service module

**Files:**

- Create: `src/cli/service.ts`
- Test: `test/cli/service.test.ts`

**Interfaces:**

- Produces: `AGENT_LABEL: string`, `PlistParams`, `renderPlist(p: PlistParams): string`, `plistPath(home?: string): string`, `logFilePath(home?: string): string`, `resolveEntryScript(): string`, `installService(): Promise<void>`, `uninstallService(): Promise<void>`, `serviceStatus(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli/service.test.ts
import { describe, expect, it } from 'vitest';
import { AGENT_LABEL, logFilePath, plistPath, renderPlist } from '../../src/cli/service.js';

describe('renderPlist', () => {
  const xml = renderPlist({
    label: AGENT_LABEL,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/opt/tokpet/dist/index.js',
    logPath: '/home/u/.tokpet/logs/tokpet.log',
  });
  it('embeds the label', () => expect(xml).toContain(`<string>${AGENT_LABEL}</string>`));
  it('passes node, script and the start subcommand', () => {
    expect(xml).toContain('<string>/usr/local/bin/node</string>');
    expect(xml).toContain('<string>/opt/tokpet/dist/index.js</string>');
    expect(xml).toContain('<string>start</string>');
  });
  it('runs at load and keeps alive', () => {
    expect(xml).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(xml).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });
  it('routes stdout and stderr to the log path', () => {
    expect(xml).toMatch(
      /<key>StandardOutPath<\/key>\s*<string>\/home\/u\/\.tokpet\/logs\/tokpet\.log<\/string>/,
    );
    expect(xml).toMatch(
      /<key>StandardErrorPath<\/key>\s*<string>\/home\/u\/\.tokpet\/logs\/tokpet\.log<\/string>/,
    );
  });
  it('sets TOKPET_NO_OPEN so a background start never pops a browser', () => {
    expect(xml).toContain('<key>TOKPET_NO_OPEN</key>');
  });
});

describe('paths', () => {
  it('plist lives in ~/Library/LaunchAgents', () =>
    expect(plistPath('/home/u')).toBe('/home/u/Library/LaunchAgents/com.tokpet.tokpet.plist'));
  it('log lives under ~/.tokpet/logs', () =>
    expect(logFilePath('/home/u')).toBe('/home/u/.tokpet/logs/tokpet.log'));
});
```

- [ ] **Step 2: Run it, confirm it fails** — `npx vitest run test/cli/service.test.ts` → cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/cli/service.ts
// SPDX-License-Identifier: Apache-2.0
//
// macOS launchd integration for the npm install path. Homebrew users get a
// service from the formula's `service` block; everyone else runs
// `tokpet service install`, which writes a per-user LaunchAgent so tokpet runs
// in the background and restarts on login. Plist rendering is a pure function
// so it is unit-testable without touching launchctl or the disk.

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_LABEL = 'com.tokpet.tokpet';

export interface PlistParams {
  readonly label: string;
  readonly nodePath: string;
  readonly scriptPath: string;
  readonly logPath: string;
}

/** Render a LaunchAgent plist. Pure — same params, same XML (what the test pins). */
export function renderPlist(p: PlistParams): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${p.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${p.nodePath}</string>
    <string>${p.scriptPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${p.logPath}</string>
  <key>StandardErrorPath</key>
  <string>${p.logPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKPET_NO_OPEN</key>
    <string>1</string>
  </dict>
</dict>
</plist>
`;
}

export function plistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
}

export function logFilePath(home: string = homedir()): string {
  return join(home, '.tokpet', 'logs', 'tokpet.log');
}

/** Resolve the installed entry script from this module's location:
 *  dist/cli/service.js -> dist/index.js. */
export function resolveEntryScript(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
}

function launchctl(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('launchctl', args, { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

export async function installService(): Promise<void> {
  const home = homedir();
  const log = logFilePath(home);
  const plist = plistPath(home);
  const uid = process.getuid?.() ?? 0;
  await mkdir(dirname(log), { recursive: true });
  await mkdir(dirname(plist), { recursive: true });
  await writeFile(
    plist,
    renderPlist({
      label: AGENT_LABEL,
      nodePath: process.execPath,
      scriptPath: resolveEntryScript(),
      logPath: log,
    }),
    { mode: 0o644 },
  );
  // Reload cleanly: bootout any prior instance (ignore failure), then bootstrap.
  await launchctl(['bootout', `gui/${uid}/${AGENT_LABEL}`]);
  const code = await launchctl(['bootstrap', `gui/${uid}`, plist]);
  if (code !== 0) {
    console.error(`[tokpet] launchctl bootstrap failed (exit ${code})`);
    process.exitCode = 1;
    return;
  }
  console.log(`[tokpet] service installed and started (${plist})`);
  console.log(`[tokpet] logs: ${log}`);
}

export async function uninstallService(): Promise<void> {
  const home = homedir();
  const plist = plistPath(home);
  const uid = process.getuid?.() ?? 0;
  await launchctl(['bootout', `gui/${uid}/${AGENT_LABEL}`]);
  await rm(plist, { force: true });
  console.log(`[tokpet] service uninstalled (${plist})`);
}

export async function serviceStatus(): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await launchctl(['print', `gui/${uid}/${AGENT_LABEL}`]);
}
```

- [ ] **Step 4: Run it, confirm it passes** — `npx vitest run test/cli/service.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(cli): add launchd service install/uninstall/status`

---

### Task 4: `open` command

**Files:**

- Create: `src/cli/open.ts`

**Interfaces:**

- Produces: `openConsole(port?: number): Promise<void>`.
- Consumes: `openBrowser` from `src/server/open-browser.js`, `resolvePort` from `src/server/run.js`.

- [ ] **Step 1: Implement**

```ts
// src/cli/open.ts
// SPDX-License-Identifier: Apache-2.0
//
// `tokpet open` — open the setup/console page in the browser. Probes the local
// service first so that, when it is not running, we print a helpful hint
// instead of opening a dead tab.

import { openBrowser } from '../server/open-browser.js';
import { resolvePort } from '../server/run.js';

export async function openConsole(port: number = resolvePort()): Promise<void> {
  const url = `http://localhost:${port}/`;
  let reachable = false;
  try {
    const res = await fetch(`${url}health`, { signal: AbortSignal.timeout(1000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.error(`[tokpet] service not reachable at ${url}`);
    console.error('[tokpet] start it first:  brew services start tokpet');
    console.error('[tokpet]            or:   tokpet service install');
    process.exitCode = 1;
    return;
  }
  openBrowser(url);
  console.log(`[tokpet] opened ${url}`);
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → no errors.
- [ ] **Step 3: Commit** — `feat(cli): add open command with a liveness probe`

---

### Task 5: Wire up the dispatcher in `src/index.ts`

**Files:**

- Modify: `src/index.ts` (replace the whole file)

**Interfaces:**

- Consumes: `resolveCommand` (Task 1), `runServer` (Task 2), `installService`/`uninstallService`/`serviceStatus` (Task 3), `openConsole` (Task 4).

- [ ] **Step 1: Replace the file**

```ts
#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Tokpet CLI entry point. Dispatches argv to a subcommand; with no arguments it
// runs the foreground server (what launchd / brew services exec).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCommand } from './cli/commands.js';
import { runServer } from './server/run.js';
import { openConsole } from './cli/open.js';
import { installService, serviceStatus, uninstallService } from './cli/service.js';

function printVersion(): void {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  console.log(pkg.version);
}

function printHelp(error?: string): void {
  if (error) console.error(`[tokpet] ${error}\n`);
  console.log(`tokpet — desktop pet AI usage companion

Usage:
  tokpet [start]              Run the companion service in the foreground
  tokpet open                 Open the setup/console page in your browser
  tokpet service install      Install a launchd background service (npm users)
  tokpet service uninstall    Remove the launchd background service
  tokpet service status       Show the launchd service status
  tokpet --version            Print the version
  tokpet --help               Show this help

Homebrew users manage the service with: brew services start|stop tokpet`);
}

async function main(): Promise<void> {
  const cmd = resolveCommand(process.argv.slice(2));
  switch (cmd.kind) {
    case 'start':
      await runServer();
      return;
    case 'open':
      await openConsole();
      return;
    case 'service':
      if (cmd.action === 'install') await installService();
      else if (cmd.action === 'uninstall') await uninstallService();
      else await serviceStatus();
      return;
    case 'version':
      printVersion();
      return;
    case 'help':
      printHelp(cmd.error);
      if (cmd.error) process.exitCode = 1;
      return;
  }
}

main().catch((e) => {
  console.error('[tokpet] fatal:', e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck + lint + full test** — `npm run typecheck && npm run lint && npm run test` → all green.
- [ ] **Step 3: Smoke test the foreground start**

Run: `TOKPET_NO_OPEN=1 PORT=4799 node --import tsx src/index.ts start &` then `curl -s localhost:4799/health` → `{"ok":true}`; kill the process.

- [ ] **Step 4: Smoke test help/version** — `node --import tsx src/index.ts --version` prints the version; `--help` prints usage; `bogus` prints help to stderr and exits non-zero.
- [ ] **Step 5: Commit** — `feat(cli): dispatch subcommands from the bin entry`

---

### Task 6: npm publish configuration

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add the publish fields**

Add to `scripts`: `"prepublishOnly": "npm run build"`. Add a top-level key:

```json
"publishConfig": {
  "access": "public"
}
```

- [ ] **Step 2: Verify the packed contents** — `npm pack --dry-run` lists `dist/`, `public/`, `package.json`, `README.md`, `LICENSE`, `NOTICE`; no `src/` or `test/`.
- [ ] **Step 3: Commit** — `build(npm): add prepublishOnly build and public publish access`

---

### Task 7: Homebrew formula

**Files:**

- Create: `packaging/homebrew/tokpet.rb`

- [ ] **Step 1: Write the formula**

```ruby
class Tokpet < Formula
  desc "Desktop pet that surfaces real-time AI usage/quota/balance across providers"
  homepage "https://github.com/grpcer/tokpet"
  url "https://registry.npmjs.org/tokpet/-/tokpet-0.1.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256_ON_RELEASE"
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

- [ ] **Step 2: Lint the Ruby syntax** — `ruby -c packaging/homebrew/tokpet.rb` → "Syntax OK".
- [ ] **Step 3: Commit** — `build(brew): add Homebrew formula source`

---

### Task 8: README Setup rewrite

**Files:**

- Modify: `README.md` (the "Setup" section; keep "Develop" and everything else)

- [ ] **Step 1: Replace the Setup section body** with end-user instructions:

````markdown
## Install

**Homebrew (recommended)**

```bash
brew install grpcer/tokpet/tokpet
brew services start tokpet     # runs in the background, restarts on login
tokpet open                    # configure providers in your browser
```
````

**npm**

```bash
npm install -g tokpet
tokpet service install         # background launchd service, restarts on login
tokpet open
```

Either way, Tokpet opens a setup page where you pick how a provider exposes
usage (subscription / API key / relay), choose a provider, and hit **Test** —
on success it activates and starts appearing in `GET /state`. Choices are saved
to `~/.tokpet/config.json` and restored on the next launch.

The setup/configuration API is bound to loopback only; `GET /state` stays
reachable on your LAN so the device (or any client) can poll it.

Manage the service:

|        | Homebrew                     | npm                        |
| ------ | ---------------------------- | -------------------------- |
| start  | `brew services start tokpet` | `tokpet service install`   |
| stop   | `brew services stop tokpet`  | `tokpet service uninstall` |
| status | `brew services info tokpet`  | `tokpet service status`    |

````

- [ ] **Step 2: Keep the existing "Develop" section** (`npm run dev`, build & run). It stays valid.
- [ ] **Step 3: Commit** — `docs(readme): document brew/npm install and the background service`

---

### Task 9: RELEASE.md

**Files:**
- Create: `RELEASE.md`

- [ ] **Step 1: Write the maintainer checklist**

```markdown
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
````

- [ ] **Step 2: Commit** — `docs: add release checklist`

---

### Task 10: ai.md Commands

**Files:**

- Modify: `ai.md` (the "Commands" section)

- [ ] **Step 1: Add a CLI subcommands block** after the existing npm-script list:

````markdown
Once built/installed, the CLI exposes subcommands:

```bash
tokpet                       # or `tokpet start` — run the service in the foreground
tokpet open                  # open the setup/console page in the browser
tokpet service install       # install a launchd background service (npm users)
tokpet service uninstall     # remove it
tokpet service status        # show launchd status
tokpet --version | --help
```
````

Homebrew users manage the lifecycle with `brew services start|stop tokpet`.

```

- [ ] **Step 2: Commit** — `docs(ai): document the tokpet CLI subcommands`

---

## Self-Review

**Spec coverage:** CLI surface (T1,T4,T5) · isTTY browser change (T2) · launchd two paths (T3 npm, T7 brew `service` block) · formula + tap (T7,T9) · npm publish config (T6) · README (T8) · ai.md (T10) · RELEASE checklist (T9) · tests (T1,T3). All spec sections map to a task.

**Placeholder scan:** The only intentional placeholder is the formula `sha256`, filled per release (documented in RELEASE.md Step 4). No TODO/TBD elsewhere.

**Type consistency:** `Command` union (T1) is consumed by the `switch` in T5 with matching `kind`/`action` values. `resolvePort` (T2) is reused by T4. `renderPlist`/`AGENT_LABEL`/`plistPath`/`logFilePath` (T3) match their test usage. `runServer()` (T2) is called arg-less in T5.

**Verification gate:** After all tasks, `npm run typecheck && npm run lint && npm run test` must be green, plus the two smoke tests in Task 5.
```
