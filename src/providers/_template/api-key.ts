// SPDX-License-Identifier: Apache-2.0
//
// Starter template — API-KEY provider (direct API with cumulative balance).

import { z } from 'zod';
import type { Provider } from '../../protocol/provider.js';
import type { UsageResult } from '../../protocol/usage.js';

const configSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().min(1),
  // Some vendors also need baseUrl, organization, etc.
});

export const exampleApiKeyProvider: Provider<'api-key'> = {
  id: 'example-api',
  displayName: 'Example API',
  mode: 'api-key',
  configSchema,

  async isReady(config) {
    const cfg = configSchema.safeParse(config);
    return cfg.success && cfg.data.enabled && cfg.data.apiKey.length > 0;
  },

  async fetch(_config, _ctx): Promise<UsageResult> {
    // TODO: call upstream with apiKey and map to ApiKeyUsage.
    return {
      mode: 'api-key',
      fetchedAt: new Date(),
      source: 'live',
      balance: {
        used: 0,
        total: 100,
        currency: 'USD',
        period: 'monthly',
      },
    };
  },
};
