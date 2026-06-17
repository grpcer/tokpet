// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance } from 'fastify';
import type { RuntimeState } from '../runtime.js';
import { deviceStatus, lanStateUrls } from '../runtime.js';
import { getUpdateInfo } from '../update-check.js';

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registerRuntimeRoutes(app: FastifyInstance, runtime: RuntimeState) {
  app.get('/api/runtime', (req, reply) => {
    if (!isLoopback(req.ip)) {
      return reply.code(403).send({ ok: false, error: 'runtime API is local-only' });
    }

    const now = new Date();
    return {
      ok: true,
      update: getUpdateInfo(),
      service: {
        status: 'running',
        startedAt: runtime.startedAt.toISOString(),
        localUrl: `http://localhost:${runtime.port}/`,
        statePath: '/state',
        lanStateUrls: lanStateUrls(runtime.port),
      },
      mdns: runtime.mdns,
      devices: runtime.devices.map((device) => ({
        ip: device.ip,
        userAgent: device.userAgent,
        lastSeenAt: device.lastSeenAt.toISOString(),
        pollCount: device.pollCount,
        status: deviceStatus(device, now),
      })),
    };
  });
}
