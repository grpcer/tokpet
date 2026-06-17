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
