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

// Escape XML metacharacters so a node/home path containing & < > cannot produce
// a malformed plist that `launchctl bootstrap` refuses to parse. `&` in a path
// is the realistic case.
function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render a LaunchAgent plist. Pure — same params, same XML (what the test pins). */
export function renderPlist(p: PlistParams): string {
  const label = xmlEscape(p.label);
  const nodePath = xmlEscape(p.nodePath);
  const scriptPath = xmlEscape(p.scriptPath);
  const logPath = xmlEscape(p.logPath);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Service management is launchd-specific. Bail clearly on other platforms
// rather than silently targeting the wrong launchd domain (gui/0).
function ensureMacOS(): boolean {
  if (process.platform !== 'darwin') {
    console.error('[tokpet] service management is macOS only (launchd)');
    process.exitCode = 1;
    return false;
  }
  return true;
}

function launchctl(args: string[], opts: { quiet?: boolean } = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('launchctl', args, { stdio: opts.quiet ? 'ignore' : 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

export async function installService(): Promise<void> {
  if (!ensureMacOS()) return;
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
  // Reload cleanly. `bootout` only *requests* teardown and returns immediately,
  // and tokpet's SIGTERM handler is async (it awaits mdns.stop() before exit),
  // so a prior instance may still hold the port / launchd slot when we bootstrap.
  // That races into `Bootstrap failed: 5: Input/output error`, leaving nothing
  // loaded. Retry bootstrap with a short backoff so re-install/upgrade is reliable.
  await launchctl(['bootout', `gui/${uid}/${AGENT_LABEL}`], { quiet: true });
  let code = await launchctl(['bootstrap', `gui/${uid}`, plist], { quiet: true });
  for (let attempt = 0; code !== 0 && attempt < 5; attempt++) {
    await delay(300);
    // Surface launchctl's own error on the final attempt only.
    code = await launchctl(['bootstrap', `gui/${uid}`, plist], { quiet: attempt < 4 });
  }
  if (code !== 0) {
    console.error(`[tokpet] launchctl bootstrap failed (exit ${code})`);
    process.exitCode = 1;
    return;
  }
  console.log(`[tokpet] service installed and started (${plist})`);
  console.log(`[tokpet] logs: ${log}`);
}

export async function uninstallService(): Promise<void> {
  if (!ensureMacOS()) return;
  const home = homedir();
  const plist = plistPath(home);
  const uid = process.getuid?.() ?? 0;
  await launchctl(['bootout', `gui/${uid}/${AGENT_LABEL}`]);
  await rm(plist, { force: true });
  console.log(`[tokpet] service uninstalled (${plist})`);
}

export async function serviceStatus(): Promise<void> {
  if (!ensureMacOS()) return;
  const uid = process.getuid?.() ?? 0;
  await launchctl(['print', `gui/${uid}/${AGENT_LABEL}`]);
}
