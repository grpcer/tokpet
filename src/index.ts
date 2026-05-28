#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Tokpet CLI entry point. Starts the local HTTP service that exposes
// `GET /state` for the Tokpet device or any other compatible client.
//
// MVP behaviour: every registered provider is enabled with its schema
// defaults. A configuration store + companion web UI will be added later.

import { Aggregator } from './aggregator/state.js';
import { ALL_PROVIDERS } from './providers/registry.js';
import { startServer } from './server/http.js';

const PORT = Number(process.env.PORT) || 4717;

async function main() {
  const agg = new Aggregator();

  for (const p of ALL_PROVIDERS) {
    const defaultCfg: unknown = p.configSchema.parse({});
    agg.register(p, defaultCfg);
    console.log(`[tokpet] registered ${p.mode}/${p.id}`);
  }

  await startServer(agg, PORT);
  console.log(`[tokpet] listening at http://localhost:${PORT}/state`);
}

main().catch((e) => {
  console.error('[tokpet] fatal:', e);
  process.exit(1);
});
