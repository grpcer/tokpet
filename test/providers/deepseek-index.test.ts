// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest';
import { deepseekProvider } from '../../src/providers/api-key/deepseek/index.js';
import { isUsageError } from '../../src/protocol/usage.js';

const ctx = { signal: new AbortController().signal };

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('deepseekProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is registered as id=deepseek with mode=api-key', () => {
    expect(deepseekProvider.id).toBe('deepseek');
    expect(deepseekProvider.mode).toBe('api-key');
    expect(deepseekProvider.displayName).toBe('DeepSeek');
  });

  it('isReady=true when apiKey present and enabled', async () => {
    expect(await deepseekProvider.isReady({ apiKey: 'sk-x', enabled: true })).toBe(true);
  });

  it('isReady=false when apiKey missing', async () => {
    expect(await deepseekProvider.isReady({ enabled: true })).toBe(false);
  });

  it('isReady=false when disabled', async () => {
    expect(await deepseekProvider.isReady({ apiKey: 'sk-x', enabled: false })).toBe(false);
  });

  it('fetch returns ApiKeyUsage on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            is_available: true,
            balance_infos: [{ currency: 'CNY', total_balance: '88.00' }],
          }),
        ),
      ),
    );
    const result = await deepseekProvider.fetch({ apiKey: 'sk-x', enabled: true }, ctx);
    expect(isUsageError(result)).toBe(false);
    if (!isUsageError(result) && result.mode === 'api-key') {
      expect(result.balance.remaining).toBe(88);
    }
  });

  it('fetch returns not-configured when disabled', async () => {
    const result = await deepseekProvider.fetch({ apiKey: 'sk-x', enabled: false }, ctx);
    expect(isUsageError(result)).toBe(true);
    if (isUsageError(result)) {
      expect(result.code).toBe('not-configured');
    }
  });

  it('fetch maps fetch errors to UsageError without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 401 }))),
    );
    const result = await deepseekProvider.fetch({ apiKey: 'sk-bad', enabled: true }, ctx);
    expect(isUsageError(result)).toBe(true);
    if (isUsageError(result)) {
      expect(result.code).toBe('auth-expired');
    }
  });

  it('configSchema rejects empty apiKey', () => {
    const parsed = deepseekProvider.configSchema.safeParse({ apiKey: '', enabled: true });
    expect(parsed.success).toBe(false);
  });

  it('configSchema defaults enabled=true and baseUrl=official endpoint', () => {
    expect(deepseekProvider.configSchema.parse({ apiKey: 'sk-x' })).toMatchObject({
      apiKey: 'sk-x',
      enabled: true,
      baseUrl: 'https://api.deepseek.com',
    });
  });
});
