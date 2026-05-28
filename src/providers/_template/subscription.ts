// SPDX-License-Identifier: Apache-2.0
//
// Starter template — SUBSCRIPTION provider (rolling-window quotas).
//
// Steps to adopt:
//   1. Copy this file to `src/providers/subscription/<your-id>/index.ts`.
//   2. Update id, displayName, configSchema.
//   3. Implement fetch() so it returns a SubscriptionUsage.
//   4. Register the provider in `src/providers/registry.ts`.

import { z } from 'zod';
import type { Provider } from '../../protocol/provider.js';
import type { UsageResult } from '../../protocol/usage.js';

const configSchema = z.object({
  enabled: z.boolean().default(true),
  // TODO: add provider-specific fields (apiKey, accountId, ...).
});

export const exampleSubscriptionProvider: Provider<'subscription'> = {
  id: 'example-sub',
  displayName: 'Example Subscription',
  mode: 'subscription',
  configSchema,

  async isReady(config) {
    const cfg = configSchema.parse(config);
    return cfg.enabled;
    // Real implementations should also verify credentials.
  },

  async fetch(_config, _ctx): Promise<UsageResult> {
    // TODO: call upstream and map to SubscriptionUsage.
    return {
      mode: 'subscription',
      fetchedAt: new Date(),
      source: 'live',
      windows: [{ id: '5h', label: 'Past 5 hours', usedPct: 0, durationMins: 5 * 60 }],
    };
  },
};
