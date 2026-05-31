// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodexUsageFetchError,
  fetchCodexUsage,
} from '../../src/providers/subscription/codex/usage.js';

const TOKEN = 'access-token-xyz';
const ACCOUNT = 'acct-uuid-123';
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

const RESET_PRIMARY = 1780211709;
const RESET_SECONDARY = 1780798509;

function happyBody() {
  return {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 5,
        limit_window_seconds: 18000,
        reset_after_seconds: 16270,
        reset_at: RESET_PRIMARY,
      },
      secondary_window: {
        used_percent: 1,
        limit_window_seconds: 604800,
        reset_after_seconds: 603070,
        reset_at: RESET_SECONDARY,
      },
    },
    credits: { has_credits: false, balance: '0' },
  };
}

describe('fetchCodexUsage', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps primary/secondary windows into 5h/7d windows (happy path)', async () => {
    mockFetch(() => jsonResponse(happyBody()));

    const usage = await fetchCodexUsage(TOKEN, ACCOUNT, ctx);
    expect(usage.mode).toBe('subscription');
    expect(usage.source).toBe('live');
    expect(usage.windows).toHaveLength(2);

    const five = usage.windows[0]!;
    const seven = usage.windows[1]!;
    expect(five).toMatchObject({
      id: '5h',
      label: 'Past 5 hours',
      usedPct: 5,
      durationMins: 300,
    });
    expect(five.resetsAt?.getTime()).toBe(RESET_PRIMARY * 1000);

    expect(seven).toMatchObject({
      id: '7d',
      label: 'This week',
      usedPct: 1,
      durationMins: 10080,
    });
    expect(seven.resetsAt?.getTime()).toBe(RESET_SECONDARY * 1000);
  });

  it('falls back to default durations when limit_window_seconds missing', async () => {
    mockFetch(() =>
      jsonResponse({
        rate_limit: {
          primary_window: { used_percent: 10 },
          secondary_window: { used_percent: 20 },
        },
      }),
    );

    const usage = await fetchCodexUsage(TOKEN, ACCOUNT, ctx);
    expect(usage.windows[0]).toMatchObject({ id: '5h', usedPct: 10, durationMins: 300 });
    expect(usage.windows[0]!.resetsAt).toBeUndefined();
    expect(usage.windows[1]).toMatchObject({ id: '7d', usedPct: 20, durationMins: 10080 });
    expect(usage.windows[1]!.resetsAt).toBeUndefined();
  });

  it('omits a window when its used_percent is not a number', async () => {
    mockFetch(() =>
      jsonResponse({
        rate_limit: {
          primary_window: { used_percent: 3, limit_window_seconds: 18000, reset_at: RESET_PRIMARY },
          secondary_window: {},
        },
      }),
    );

    const usage = await fetchCodexUsage(TOKEN, ACCOUNT, ctx);
    expect(usage.windows).toHaveLength(1);
    expect(usage.windows[0]!.id).toBe('5h');
  });

  it('sends bearer auth, account id, and codex user-agent headers', async () => {
    const stub = vi.fn(() => Promise.resolve(jsonResponse(happyBody())));
    vi.stubGlobal('fetch', stub);

    await fetchCodexUsage(TOKEN, ACCOUNT, ctx);
    expect(stub).toHaveBeenCalledTimes(1);
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['ChatGPT-Account-Id']).toBe(ACCOUNT);
    expect(headers['User-Agent']).toBe('codex_cli_rs');
  });

  it('maps 401 to auth-expired', async () => {
    mockFetch(() => new Response('unauthorized', { status: 401 }));
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
      name: 'CodexUsageFetchError',
      code: 'auth-expired',
    });
  });

  it('maps 403 to auth-expired', async () => {
    mockFetch(() => new Response('forbidden', { status: 403 }));
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
      code: 'auth-expired',
    });
  });

  it('maps 429 to rate-limited', async () => {
    mockFetch(() => new Response('slow down', { status: 429 }));
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
      code: 'rate-limited',
    });
  });

  it('maps 500 to upstream-error', async () => {
    mockFetch(() => new Response('boom', { status: 500 }));
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });

  it('wraps fetch throw as network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ENOTFOUND'))),
    );
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
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
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toMatchObject({
      code: 'upstream-error',
    });
  });

  it('maps missing rate_limit to upstream-error', async () => {
    mockFetch(() => jsonResponse({ plan_type: 'plus' }));
    await expect(fetchCodexUsage(TOKEN, ACCOUNT, ctx)).rejects.toBeInstanceOf(CodexUsageFetchError);
  });
});
