// SPDX-License-Identifier: Apache-2.0
//
// Claude.ai subscription provider.
// Reads OAuth credentials from the local Claude Code login state and reports
// the 5-hour rolling and 7-day rolling utilization windows.

import type { Provider } from '../../../protocol/provider.js';
import type { UsageResult } from '../../../protocol/usage.js';
import { authHasRequiredScopes, authMsToExpiry, loadClaudeAuth } from './auth.js';
import { ClaudeUsageFetchError, fetchClaudeUsage } from './usage.js';
import { claudeConfigSchema } from './config.js';

function err(code: Extract<UsageResult, { kind: 'error' }>['code'], message: string): UsageResult {
  return { kind: 'error', code, message, fetchedAt: new Date() };
}

export const claudeProvider: Provider<'subscription'> = {
  id: 'claude',
  displayName: 'Claude',
  mode: 'subscription',
  configSchema: claudeConfigSchema,

  async isReady(config) {
    const cfg = claudeConfigSchema.parse(config);
    if (!cfg.enabled) return false;
    const auth = await loadClaudeAuth();
    if (!auth) return false;
    if (authMsToExpiry(auth) <= 0) return false;
    return authHasRequiredScopes(auth);
  },

  async fetch(config, ctx) {
    const cfg = claudeConfigSchema.parse(config);
    if (!cfg.enabled) {
      return err('not-configured', 'Provider disabled');
    }
    const auth = await loadClaudeAuth();
    if (!auth) {
      return err('not-configured', 'No Claude OAuth credentials found locally');
    }
    if (authMsToExpiry(auth) <= 0) {
      return err('auth-expired', 'Token expired (refresh flow not yet implemented)');
    }
    if (!authHasRequiredScopes(auth)) {
      return err('not-configured', "Token missing 'user:profile' + 'user:inference' scopes");
    }
    try {
      return await fetchClaudeUsage(auth.accessToken, ctx);
    } catch (e) {
      if (e instanceof ClaudeUsageFetchError) return err(e.code, e.message);
      return err('unknown', (e as Error).message);
    }
  },
};
