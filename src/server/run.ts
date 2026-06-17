// SPDX-License-Identifier: Apache-2.0
//
// Foreground server runtime, lifted from the original index.ts main(): restore
// activated providers, start HTTP + mDNS, and open the setup page when run
// interactively or on first run (no provider configured yet). Once providers
// exist, a background auto-start under launchd / brew services stays quiet.

import { Aggregator } from '../aggregator/state.js';
import { findProvider } from '../providers/registry.js';
import { startServer } from './http.js';
import { loadConfig, orderedProviderIds } from '../config/store.js';
import { openBrowser } from './open-browser.js';
import { publishMdns } from './mdns.js';
import { createRuntimeState, markMdnsPublished } from './runtime.js';
import { startUpdateChecks } from './update-check.js';

export const DEFAULT_PORT = 4717;

export function resolvePort(): number {
  return Number(process.env.PORT) || DEFAULT_PORT;
}

// Decide whether to pop the setup page on start. Opens for an interactive run,
// or on first run when nothing is configured yet (so a fresh `brew services
// start` lands on the console); stays quiet for a configured background
// auto-start. TOKPET_NO_OPEN always suppresses it.
export function shouldOpenBrowser(opts: {
  noOpen: boolean;
  isTTY: boolean;
  hasProviders: boolean;
}): boolean {
  return !opts.noOpen && (opts.isTTY || !opts.hasProviders);
}

export async function runServer(port: number = resolvePort()): Promise<void> {
  const agg = new Aggregator();
  const runtime = createRuntimeState(port);

  const config = await loadConfig();
  const providerIds = orderedProviderIds(config);
  // Restore in the user-chosen display order so the very first /state poll
  // already lines up with the console and the device tiles.
  for (const id of providerIds) {
    const provider = findProvider(id);
    if (!provider) {
      console.warn(`[tokpet] skipping unknown provider '${id}' from config`);
      continue;
    }
    agg.register(provider, config.providers[id]);
    console.log(`[tokpet] restored ${provider.mode}/${provider.id}`);
  }

  await startServer(agg, port, runtime);
  // Background "is there a newer tokpet?" poll; the console surfaces the hint.
  startUpdateChecks();
  const mdns = publishMdns(port, {
    onStatus: () => markMdnsPublished(runtime),
  });
  const url = `http://localhost:${port}/`;
  console.log(`[tokpet] setup page:  ${url}`);
  console.log(`[tokpet] state JSON:  ${url}state`);
  console.log(`[tokpet] mDNS:        _tokpet._tcp.local:${port}`);
  // Open the console for an interactive run, or on first run when nothing is
  // configured yet, so a fresh `brew services start` lands the user on the
  // setup page. Once providers exist, background auto-starts stay quiet.
  if (
    shouldOpenBrowser({
      noOpen: Boolean(process.env.TOKPET_NO_OPEN),
      isTTY: Boolean(process.stdout.isTTY),
      hasProviders: providerIds.length > 0,
    })
  ) {
    openBrowser(url);
  }

  const stop = async () => {
    await mdns.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
