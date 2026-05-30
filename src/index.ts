#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Tokpet CLI entry point. Restores activated providers from the config store,
// starts the local HTTP service (GET /state + the setup page) and opens the
// browser to the setup page.

import { Aggregator } from './aggregator/state.js';
import { findProvider } from './providers/registry.js';
import { startServer } from './server/http.js';
import { loadConfig } from './config/store.js';
import { openBrowser } from './server/open-browser.js';
import { publishMdns } from './server/mdns.js';
import { createRuntimeState, markMdnsPublished } from './server/runtime.js';

const PORT = Number(process.env.PORT) || 4717;

async function main() {
  const agg = new Aggregator();
  const runtime = createRuntimeState(PORT);

  const config = await loadConfig();
  for (const [id, providerConfig] of Object.entries(config.providers)) {
    const provider = findProvider(id);
    if (!provider) {
      console.warn(`[tokpet] skipping unknown provider '${id}' from config`);
      continue;
    }
    agg.register(provider, providerConfig);
    console.log(`[tokpet] restored ${provider.mode}/${provider.id}`);
  }

  await startServer(agg, PORT, runtime);
  const mdns = publishMdns(PORT, {
    onStatus: () => markMdnsPublished(runtime),
  });
  const url = `http://localhost:${PORT}/`;
  console.log(`[tokpet] setup page:  ${url}`);
  console.log(`[tokpet] state JSON:  ${url}state`);
  console.log(`[tokpet] mDNS:        _tokpet._tcp.local:${PORT}`);
  if (!process.env.TOKPET_NO_OPEN) openBrowser(url);

  const stop = async () => {
    await mdns.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

main().catch((e) => {
  console.error('[tokpet] fatal:', e);
  process.exit(1);
});
