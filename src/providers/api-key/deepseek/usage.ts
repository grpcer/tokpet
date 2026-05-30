// SPDX-License-Identifier: Apache-2.0
//
// Calls DeepSeek's `GET /user/balance` endpoint.
// Docs: https://api-docs.deepseek.com/api/get-user-balance
//
// DeepSeek is a pre-paid wallet model: the API returns the remaining balance
// (and a split of granted vs topped-up credits we ignore for now). There is
// no upstream "used" or "monthly cap", so the resulting ApiKeyUsage carries
// only `balance.remaining`. `is_available=false` (balance exhausted) is *not*
// treated as an error — the request succeeds with `remaining=0` and the UI
// renders the empty state itself.

import type { FetchContext } from '../../../protocol/provider.js';
import type { ApiKeyUsage, UsageBalance } from '../../../protocol/usage.js';

const BALANCE_PATH = '/user/balance';
const ALLOWED_CURRENCIES = new Set<UsageBalance['currency']>(['USD', 'CNY', 'EUR']);

interface RawBalanceInfo {
  currency?: string;
  total_balance?: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

interface RawBalanceResponse {
  is_available?: boolean;
  balance_infos?: RawBalanceInfo[];
}

export class DeepseekUsageFetchError extends Error {
  constructor(
    readonly code: 'auth-expired' | 'rate-limited' | 'network' | 'upstream-error',
    message: string,
  ) {
    super(message);
    this.name = 'DeepseekUsageFetchError';
  }
}

function parseAmount(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeCurrency(raw: string | undefined): UsageBalance['currency'] {
  const up = raw?.toUpperCase();
  if (up && (ALLOWED_CURRENCIES as Set<string>).has(up)) {
    return up as UsageBalance['currency'];
  }
  // DeepSeek 国内主账户默认 CNY；未知币种保守归一到 CNY 而不是丢错。
  return 'CNY';
}

export async function fetchDeepseekBalance(
  apiKey: string,
  baseUrl: string,
  ctx: FetchContext,
): Promise<ApiKeyUsage> {
  const url = `${baseUrl.replace(/\/+$/, '')}${BALANCE_PATH}`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: ctx.signal,
    });
  } catch (e) {
    throw new DeepseekUsageFetchError('network', (e as Error).message);
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new DeepseekUsageFetchError('auth-expired', `HTTP ${resp.status}`);
  }
  if (resp.status === 429) {
    throw new DeepseekUsageFetchError('rate-limited', 'HTTP 429');
  }
  if (!resp.ok) {
    throw new DeepseekUsageFetchError('upstream-error', `HTTP ${resp.status}`);
  }

  let raw: RawBalanceResponse;
  try {
    raw = (await resp.json()) as RawBalanceResponse;
  } catch {
    throw new DeepseekUsageFetchError('upstream-error', 'invalid JSON');
  }

  const info = raw.balance_infos?.[0];
  const remaining = parseAmount(info?.total_balance);
  if (typeof remaining !== 'number') {
    throw new DeepseekUsageFetchError('upstream-error', 'missing total_balance');
  }

  return {
    mode: 'api-key',
    fetchedAt: new Date(),
    source: 'live',
    balance: {
      remaining,
      currency: normalizeCurrency(info?.currency),
    },
  };
}
