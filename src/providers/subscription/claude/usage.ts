// SPDX-License-Identifier: Apache-2.0
//
// Calls the undocumented `GET /api/oauth/usage` endpoint.
// The endpoint is not part of any public contract and may change without
// notice; consumers must fall back gracefully when it errors.

import type { FetchContext } from '../../../protocol/provider.js';
import type { SubscriptionUsage, UsageWindow } from '../../../protocol/usage.js';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';

interface RawWindow {
  utilization?: number;
  resets_at?: string;
}

interface RawUsage {
  five_hour?: RawWindow;
  seven_day?: RawWindow;
  // Additional vendor-internal fields are ignored on purpose.
}

export class ClaudeUsageFetchError extends Error {
  constructor(
    readonly code: 'auth-expired' | 'rate-limited' | 'network' | 'upstream-error',
    message: string,
  ) {
    super(message);
    this.name = 'ClaudeUsageFetchError';
  }
}

export async function fetchClaudeUsage(
  accessToken: string,
  ctx: FetchContext,
): Promise<SubscriptionUsage> {
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': BETA_HEADER,
        'Content-Type': 'application/json',
      },
      signal: ctx.signal,
    });
  } catch (e) {
    throw new ClaudeUsageFetchError('network', (e as Error).message);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new ClaudeUsageFetchError('auth-expired', `HTTP ${resp.status}`);
  }
  if (resp.status === 429) {
    throw new ClaudeUsageFetchError('rate-limited', 'HTTP 429');
  }
  if (!resp.ok) {
    throw new ClaudeUsageFetchError('upstream-error', `HTTP ${resp.status}`);
  }

  const raw = (await resp.json()) as RawUsage;
  const windows: UsageWindow[] = [];

  if (typeof raw.five_hour?.utilization === 'number') {
    windows.push({
      id: '5h',
      label: 'Past 5 hours',
      usedPct: raw.five_hour.utilization,
      resetsAt: raw.five_hour.resets_at ? new Date(raw.five_hour.resets_at) : undefined,
      durationMins: 5 * 60,
    });
  }
  if (typeof raw.seven_day?.utilization === 'number') {
    windows.push({
      id: '7d',
      label: 'This week',
      usedPct: raw.seven_day.utilization,
      resetsAt: raw.seven_day.resets_at ? new Date(raw.seven_day.resets_at) : undefined,
      durationMins: 7 * 24 * 60,
    });
  }

  return {
    mode: 'subscription',
    fetchedAt: new Date(),
    source: 'live',
    windows,
  };
}
