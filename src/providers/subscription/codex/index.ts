// SPDX-License-Identifier: Apache-2.0
//
// Codex (ChatGPT subscription) provider.
// Reuses the local Codex CLI login state and reports the 5-hour rolling and
// 7-day rolling rate-limit windows.

import type { Provider } from '../../../protocol/provider.js';
import type { UsageResult } from '../../../protocol/usage.js';
import { authMsToExpiry, loadCodexAuth } from './auth.js';
import { CodexUsageFetchError, fetchCodexUsage } from './usage.js';
import { codexConfigSchema } from './config.js';

function err(code: Extract<UsageResult, { kind: 'error' }>['code'], message: string): UsageResult {
  return { kind: 'error', code, message, fetchedAt: new Date() };
}

function providerErrorMessage(e: CodexUsageFetchError): string {
  if (e.code === 'rate-limited') {
    return 'Codex usage is temporarily rate limited. Wait a few minutes, then refresh.';
  }
  return e.message;
}

export const codexProvider: Provider<'subscription'> = {
  id: 'codex',
  displayName: 'Codex',
  mode: 'subscription',
  configSchema: codexConfigSchema,

  async isReady(config) {
    const cfg = codexConfigSchema.parse(config);
    if (!cfg.enabled) return false;
    const auth = await loadCodexAuth();
    if (!auth) return false;
    return authMsToExpiry(auth) > 0;
  },

  async fetch(config, ctx) {
    const cfg = codexConfigSchema.parse(config);
    if (!cfg.enabled) {
      return err('not-configured', 'Provider disabled');
    }
    const auth = await loadCodexAuth();
    if (!auth) {
      return err('not-configured', 'No Codex CLI credentials found locally');
    }
    if (authMsToExpiry(auth) <= 0) {
      return err('auth-expired', 'Token expired (refresh flow not yet implemented)');
    }
    try {
      return await fetchCodexUsage(auth.accessToken, auth.accountId, ctx);
    } catch (e) {
      if (e instanceof CodexUsageFetchError) return err(e.code, providerErrorMessage(e));
      return err('unknown', (e as Error).message);
    }
  },
};
