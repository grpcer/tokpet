// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createRuntimeState } from '../../src/server/runtime.js';
import { registerRuntimeRoutes } from '../../src/server/routes/runtime.js';

describe('runtime routes', () => {
  it('returns local console runtime state', async () => {
    const runtime = createRuntimeState(4717);
    runtime.mdns.status = 'published';
    runtime.devices.push({
      ip: '192.168.1.42',
      userAgent: 'Tokpet-ESP32S3/1.0',
      lastSeenAt: new Date(),
      pollCount: 3,
    });
    const app = Fastify();
    registerRuntimeRoutes(app, runtime);

    const res = await app.inject({ method: 'GET', url: '/api/runtime' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: {
        status: 'running',
        localUrl: 'http://localhost:4717/',
        statePath: '/state',
      },
      mdns: {
        service: '_tokpet._tcp.local',
        port: 4717,
        path: '/state',
        protocol: '1',
        status: 'published',
      },
      devices: [
        {
          ip: '192.168.1.42',
          userAgent: 'Tokpet-ESP32S3/1.0',
          pollCount: 3,
          status: 'connected',
        },
      ],
    });
  });

  it('rejects non-loopback callers', async () => {
    const app = Fastify();
    registerRuntimeRoutes(app, createRuntimeState(4717));

    const res = await app.inject({
      method: 'GET',
      url: '/api/runtime',
      remoteAddress: '192.168.1.50',
    });

    expect(res.statusCode).toBe(403);
  });
});
