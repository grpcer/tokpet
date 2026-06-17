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
