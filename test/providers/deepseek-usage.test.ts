// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeepseekUsageFetchError,
  fetchDeepseekBalance,
} from '../../src/providers/api-key/deepseek/usage.js';

const BASE = 'https://api.deepseek.com';
const KEY = 'sk-test-key';
const ctx = { signal: new AbortController().signal };

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))),
  );
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('fetchDeepseekBalance', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses total_balance into balance.remaining (happy path)', async () => {
    mockFetch(() =>
      jsonResponse({
        is_available: true,
        balance_infos: [
          {
            currency: 'CNY',
            total_balance: '110.00',
            granted_balance: '10.00',
            topped_up_balance: '100.00',
          },
        ],
      }),
    );

    const usage = await fetchDeepseekBalance(KEY, BASE, ctx);
    expect(usage.mode).toBe('api-key');
    expect(usage.source).toBe('live');
    expect(usage.balance.remaining).toBe(110);
    expect(usage.balance.currency).toBe('CNY');
    expect(usage.balance.used).toBeUndefined();
    expect(usage.balance.total).toBeUndefined();
  });

  it('returns remaining=0 for empty wallet (is_available=false) without throwing', async () => {
    mockFetch(() =>
      jsonResponse({
        is_available: false,
        balance_infos: [
          {
            currency: 'CNY',
            total_balance: '0.00',
            granted_balance: '0.00',
            topped_up_balance: '0.00',
          },
        ],
      }),
    );

    const usage = await fetchDeepseekBalance(KEY, BASE, ctx);
    expect(usage.balance.remaining).toBe(0);
    expect(usage.balance.currency).toBe('CNY');
  });

  it('uses bearer auth header', async () => {
    const stub = vi.fn(() =>
      Promise.resolve(jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '1' }] })),
    );
    vi.stubGlobal('fetch', stub);

    await fetchDeepseekBalance(KEY, BASE, ctx);
    expect(stub).toHaveBeenCalledTimes(1);
    const [, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('strips trailing slashes from baseUrl', async () => {
    const stub = vi.fn(() =>
      Promise.resolve(jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '1' }] })),
    );
    vi.stubGlobal('fetch', stub);

    await fetchDeepseekBalance(KEY, `${BASE}///`, ctx);
    const [url] = stub.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${BASE}/user/balance`);
  });

  it('normalizes an unknown currency to CNY (DeepSeek main account default)', async () => {
    mockFetch(() => jsonResponse({ balance_infos: [{ currency: 'xyz', total_balance: '5' }] }));
    const usage = await fetchDeepseekBalance(KEY, BASE, ctx);
    expect(usage.balance.currency).toBe('CNY');
  });

  it('accepts USD when DeepSeek issues a USD wallet', async () => {
    mockFetch(() => jsonResponse({ balance_infos: [{ currency: 'USD', total_balance: '12.50' }] }));
    const usage = await fetchDeepseekBalance(KEY, BASE, ctx);
    expect(usage.balance.currency).toBe('USD');
    expect(usage.balance.remaining).toBeCloseTo(12.5);
  });

  it('maps 401 to auth-expired', async () => {
    mockFetch(() => new Response('unauthorized', { status: 401 }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      name: 'DeepseekUsageFetchError',
      code: 'auth-expired',
    });
  });

  it('maps 403 to auth-expired', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'auth-expired',
    });
  });

  it('maps 429 to rate-limited', async () => {
    mockFetch(() => new Response('slow down', { status: 429 }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });

  it('maps 500 to upstream-error', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });

  it('wraps fetch throw as network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ENOTFOUND'))),
    );
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('maps invalid JSON to upstream-error', async () => {
    mockFetch(
      () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });

  it('maps missing balance_infos to upstream-error', async () => {
    mockFetch(() => jsonResponse({ is_available: true }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toBeInstanceOf(
      DeepseekUsageFetchError,
    );
  });

  it('maps missing total_balance to upstream-error', async () => {
    mockFetch(() => jsonResponse({ balance_infos: [{ currency: 'CNY' }] }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });

  it('maps non-numeric total_balance to upstream-error', async () => {
    mockFetch(() => jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: 'oops' }] }));
    await expect(fetchDeepseekBalance(KEY, BASE, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });
});
