// SPDX-License-Identifier: Apache-2.0
//
// Starter template — RELAY provider (third-party gateways and proxies).
// `custom` is a free-form envelope for vendor-specific fields; the device
// UI keys off `provider.id` to choose a renderer.

import { z } from 'zod';
import type { Provider } from '../../protocol/provider.js';
import type { UsageResult } from '../../protocol/usage.js';

const configSchema = z.object({
  enabled: z.boolean().default(true),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
});

export const exampleRelayProvider: Provider<'relay'> = {
  id: 'example-relay',
  displayName: 'Example Relay',
  mode: 'relay',
  configSchema,

  async isReady(config) {
    return configSchema.safeParse(config).success;
  },

  async fetch(_config, _ctx): Promise<UsageResult> {
    // TODO: call the relay's usage endpoint and map fields.
    return {
      mode: 'relay',
      fetchedAt: new Date(),
      source: 'live',
      balance: { used: 0, total: 100, currency: 'USD' },
      custom: {
        // Vendor-specific fields go here.
      },
    };
  },
};
