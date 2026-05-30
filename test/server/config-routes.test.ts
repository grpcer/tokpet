// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import Fastify from 'fastify';
import { Aggregator } from '../../src/aggregator/state.js';
import { registerConfigRoutes } from '../../src/server/routes/config.js';
import type { Provider } from '../../src/protocol/provider.js';
import type { UsageResult } from '../../src/protocol/usage.js';

interface ApiResponse {
  ok: boolean;
  usage?: { windows: Array<{ usedPct: number }> };
  error?: { code: string };
}

const okProvider: Provider = {
  id: 'ok',
  displayName: 'OK',
  mode: 'subscription',
  configSchema: z.object({ enabled: z.boolean().default(true) }),
  isReady: () => Promise.resolve(true),
  fetch: (): Promise<UsageResult> =>
    Promise.resolve({
      mode: 'subscription',
      fetchedAt: new Date(),
      source: 'live',
      windows: [{ id: '5h', label: 'Past 5 hours', usedPct: 42, durationMins: 300 }],
    }),
};
// Stand-in for api-key providers (DeepSeek-style) where the schema has a
// required field with no default — confirmReconnect()'s empty-body POST must
// recover the stored credentials instead of failing schema validation.
const apiKeyProvider: Provider = {
  id: 'apikey',
  displayName: 'ApiKey',
  mode: 'api-key',
  configSchema: z.object({
    apiKey: z.string().min(1),
    enabled: z.boolean().default(true),
  }),
  isReady: () => Promise.resolve(true),
  fetch: (config): Promise<UsageResult> => {
    const cfg = config as { apiKey: string };
    return Promise.resolve({
      mode: 'api-key',
      fetchedAt: new Date(),
      source: 'live',
      balance: { remaining: cfg.apiKey === 'sk-stored' ? 8.81 : 0, currency: 'CNY' },
    });
  },
};
const errProvider: Provider = {
  id: 'err',
  displayName: 'Err',
  mode: 'subscription',
  configSchema: z.object({ enabled: z.boolean().default(true) }),
  isReady: () => Promise.resolve(false),
  fetch: (): Promise<UsageResult> =>
    Promise.resolve({
      kind: 'error',
      code: 'not-configured',
      message: 'nope',
      fetchedAt: new Date(),
    }),
};

function makeApp() {
  const agg = new Aggregator();
  const app = Fastify();
  registerConfigRoutes(app, agg, [okProvider, errProvider, apiKeyProvider]);
  return { app, agg };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tokpet-routes-'));
  process.env.TOKPET_CONFIG_DIR = dir;
});
afterEach(async () => {
  delete process.env.TOKPET_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('config routes', () => {
  it('lists providers with availability + activation flags', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(res.json()).toEqual([
      { id: 'ok', displayName: 'OK', mode: 'subscription', available: true, activated: false },
      { id: 'err', displayName: 'Err', mode: 'subscription', available: true, activated: false },
      { id: 'apikey', displayName: 'ApiKey', mode: 'api-key', available: true, activated: false },
    ]);
  });

  it('marks restored providers as active', async () => {
    const { app, agg } = makeApp();
    agg.register(okProvider, { enabled: true });
    const res = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(res.json()).toEqual([
      { id: 'ok', displayName: 'OK', mode: 'subscription', available: true, activated: true },
      { id: 'err', displayName: 'Err', mode: 'subscription', available: true, activated: false },
      { id: 'apikey', displayName: 'ApiKey', mode: 'api-key', available: true, activated: false },
    ]);
  });

  it('test returns usage on success', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/providers/ok/test', payload: {} });
    const body = res.json<ApiResponse>();
    expect(body.ok).toBe(true);
    expect(body.usage?.windows[0]?.usedPct).toBe(42);
  });

  it('test returns error payload on failure', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/providers/err/test', payload: {} });
    const body = res.json<ApiResponse>();
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('not-configured');
  });

  it('activate persists config and registers in the aggregator', async () => {
    const { app, agg } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/ok/activate',
      payload: {},
    });
    expect(res.json<ApiResponse>().ok).toBe(true);
    expect(agg.has('ok')).toBe(true);
  });

  // The dashboard's Reconnect button posts an empty body; an api-key provider
  // whose schema requires a non-empty apiKey would otherwise fail Zod validation
  // and return "invalid config". /activate must fall back to the stored config.
  it('reconnect with empty body recovers stored api-key config', async () => {
    const { app, agg } = makeApp();
    await app.inject({
      method: 'POST',
      url: '/api/providers/apikey/activate',
      payload: { apiKey: 'sk-stored', enabled: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/apikey/activate',
      payload: {},
    });
    const body = res.json<ApiResponse>();
    expect(body.ok).toBe(true);
    expect(agg.has('apikey')).toBe(true);
  });

  it('reconnect with empty body still 400s when no stored config exists', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/apikey/activate',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiResponse>().ok).toBe(false);
  });

  it('lists activated providers in aggregator order, unactivated trail in registry order', async () => {
    const { app, agg } = makeApp();
    // Activate ok first, then apikey — registry order is [ok, err, apikey],
    // user order so far should be [ok, apikey] then [err] trailing.
    agg.register(okProvider, { enabled: true });
    agg.register(apiKeyProvider, { apiKey: 'sk', enabled: true });
    let res = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(res.json<{ id: string }[]>().map((p) => p.id)).toEqual(['ok', 'apikey', 'err']);

    // Reorder via the route — apikey should now lead.
    await app.inject({
      method: 'POST',
      url: '/api/providers/reorder',
      payload: { order: ['apikey', 'ok'] },
    });
    res = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(res.json<{ id: string }[]>().map((p) => p.id)).toEqual(['apikey', 'ok', 'err']);
  });

  it('reorder persists the new sequence and reorders the aggregator', async () => {
    const { app, agg } = makeApp();
    await app.inject({
      method: 'POST',
      url: '/api/providers/ok/activate',
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: '/api/providers/apikey/activate',
      payload: { apiKey: 'sk-stored', enabled: true },
    });

    expect(agg.list().map((e) => e.id)).toEqual(['ok', 'apikey']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/reorder',
      payload: { order: ['apikey', 'ok'] },
    });
    const body = res.json<ApiResponse & { order?: string[] }>();
    expect(body.ok).toBe(true);
    expect(body.order).toEqual(['apikey', 'ok']);
    expect(agg.list().map((e) => e.id)).toEqual(['apikey', 'ok']);
  });

  it('reorder rejects a missing or malformed order body with 400', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/reorder',
      payload: { order: 'not-an-array' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiResponse>().ok).toBe(false);
  });

  it('delete unregisters', async () => {
    const { app, agg } = makeApp();
    await app.inject({ method: 'POST', url: '/api/providers/ok/activate', payload: {} });
    const res = await app.inject({ method: 'DELETE', url: '/api/providers/ok' });
    expect(res.json<ApiResponse>().ok).toBe(true);
    expect(agg.has('ok')).toBe(false);
  });

  it('404s on unknown provider', async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/providers/nope/test', payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it('rejects non-loopback callers with 403', async () => {
    const { app } = makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      remoteAddress: '192.168.1.50',
    });
    expect(res.statusCode).toBe(403);
  });
});
