// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance } from 'fastify';
import type { Aggregator } from '../../aggregator/state.js';

export function registerStateRoute(app: FastifyInstance, agg: Aggregator) {
  app.get('/state', async (req, reply) => {
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    const snap = await agg.snapshot(ac.signal);
    reply.header('Cache-Control', 'no-store');
    return snap;
  });
}
