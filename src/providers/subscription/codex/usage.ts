// SPDX-License-Identifier: Apache-2.0
//
// Calls the undocumented `GET /backend-api/wham/usage` endpoint that the
// Codex CLI uses for its ChatGPT-subscription rate-limit display. The
// endpoint is not part of any public contract and may change without notice;
// consumers must fall back gracefully when it errors.

import type { FetchContext } from '../../../protocol/provider.js';
import type { SubscriptionUsage, UsageWindow } from '../../../protocol/usage.js';

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

interface RawWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface RawUsage {
  rate_limit?: {
    primary_window?: RawWindow;
    secondary_window?: RawWindow;
  };
  // Additional vendor-internal fields are ignored on purpose.
}

export class CodexUsageFetchError extends Error {
  constructor(
    readonly code: 'auth-expired' | 'rate-limited' | 'network' | 'upstream-error',
    message: string,
  ) {
    super(message);
    this.name = 'CodexUsageFetchError';
  }
}

export async function fetchCodexUsage(
  accessToken: string,
  accountId: string,
  ctx: FetchContext,
): Promise<SubscriptionUsage> {
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        'User-Agent': 'codex_cli_rs',
      },
      signal: ctx.signal,
    });
  } catch (e) {
    throw new CodexUsageFetchError('network', (e as Error).message);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new CodexUsageFetchError('auth-expired', `HTTP ${resp.status}`);
  }
  if (resp.status === 429) {
    throw new CodexUsageFetchError('rate-limited', 'HTTP 429');
  }
  if (!resp.ok) {
    throw new CodexUsageFetchError('upstream-error', `HTTP ${resp.status}`);
  }

  let raw: RawUsage;
  try {
    raw = (await resp.json()) as RawUsage;
  } catch (e) {
    throw new CodexUsageFetchError('upstream-error', `Invalid JSON: ${(e as Error).message}`);
  }

  if (!raw.rate_limit) {
    throw new CodexUsageFetchError('upstream-error', 'Missing rate_limit in response');
  }

  const windows: UsageWindow[] = [];
  const primary = raw.rate_limit.primary_window;
  const secondary = raw.rate_limit.secondary_window;

  if (typeof primary?.used_percent === 'number') {
    windows.push({
      id: '5h',
      label: 'Past 5 hours',
      usedPct: primary.used_percent,
      resetsAt:
        typeof primary.reset_at === 'number' ? new Date(primary.reset_at * 1000) : undefined,
      durationMins:
        typeof primary.limit_window_seconds === 'number'
          ? Math.round(primary.limit_window_seconds / 60)
          : 5 * 60,
    });
  }
  if (typeof secondary?.used_percent === 'number') {
    windows.push({
      id: '7d',
      label: 'This week',
      usedPct: secondary.used_percent,
      resetsAt:
        typeof secondary.reset_at === 'number' ? new Date(secondary.reset_at * 1000) : undefined,
      durationMins:
        typeof secondary.limit_window_seconds === 'number'
          ? Math.round(secondary.limit_window_seconds / 60)
          : 7 * 24 * 60,
    });
  }

  return {
    mode: 'subscription',
    fetchedAt: new Date(),
    source: 'live',
    windows,
  };
}
