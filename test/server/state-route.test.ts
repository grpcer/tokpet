// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import Fastify from 'fastify';
import { Aggregator } from '../../src/aggregator/state.js';
import { registerStateRoute } from '../../src/server/routes/state.js';
import { createRuntimeState } from '../../src/server/runtime.js';
import type { Provider } from '../../src/protocol/provider.js';
import type { UsageResult } from '../../src/protocol/usage.js';

const provider: Provider = {
  id: 'claude',
  displayName: 'Claude',
  mode: 'subscription',
  configSchema: z.any(),
  isReady: () => Promise.resolve(true),
  fetch: (): Promise<UsageResult> =>
    Promise.resolve({
      mode: 'subscription',
      fetchedAt: new Date(),
      source: 'live',
      windows: [{ id: '5h', label: 'Past 5 hours', usedPct: 42, durationMins: 300 }],
    }),
};

interface StateBody {
  version: number;
  providers: Array<{ id: string }>;
}

describe('GET /state', () => {
  it('returns a versioned, no-store snapshot of registered providers', async () => {
    const agg = new Aggregator();
    agg.register(provider, {});
    const app = Fastify();
    registerStateRoute(app, agg);

    const res = await app.inject({ method: 'GET', url: '/state' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<StateBody>();
    expect(body.version).toBe(1);
    expect(body.providers[0]?.id).toBe('claude');
  });

  it('records non-loopback device polls for the console', async () => {
    const agg = new Aggregator();
    const runtime = createRuntimeState(4717);
    const app = Fastify();
    registerStateRoute(app, agg, runtime);

    await app.inject({
      method: 'GET',
      url: '/state',
      remoteAddress: '192.168.1.42',
      headers: { 'user-agent': 'Tokpet-ESP32S3/1.0' },
    });

    expect(runtime.devices).toHaveLength(1);
    expect(runtime.devices[0]).toMatchObject({
      ip: '192.168.1.42',
      userAgent: 'Tokpet-ESP32S3/1.0',
      pollCount: 1,
    });
  });
});
