// SPDX-License-Identifier: Apache-2.0
//
// DeepSeek api-key provider.
// Reads the wallet balance from DeepSeek's open platform via a bearer key
// the user pastes in the local config UI.

import type { Provider } from '../../../protocol/provider.js';
import type { UsageResult } from '../../../protocol/usage.js';
import { deepseekConfigSchema } from './config.js';
import { DeepseekUsageFetchError, fetchDeepseekBalance } from './usage.js';

function err(code: Extract<UsageResult, { kind: 'error' }>['code'], message: string): UsageResult {
  return { kind: 'error', code, message, fetchedAt: new Date() };
}

export const deepseekProvider: Provider<'api-key'> = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  mode: 'api-key',
  configSchema: deepseekConfigSchema,

  isReady(config) {
    const cfg = deepseekConfigSchema.safeParse(config);
    return Promise.resolve(cfg.success && cfg.data.enabled && cfg.data.apiKey.length > 0);
  },

  async fetch(config, ctx) {
    const cfg = deepseekConfigSchema.parse(config);
    if (!cfg.enabled) {
      return err('not-configured', 'Provider disabled');
    }
    try {
      return await fetchDeepseekBalance(cfg.apiKey, cfg.baseUrl, ctx);
    } catch (e) {
      if (e instanceof DeepseekUsageFetchError) return err(e.code, e.message);
      return err('unknown', (e as Error).message);
    }
  },
};
