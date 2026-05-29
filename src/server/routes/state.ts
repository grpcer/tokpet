// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance } from 'fastify';
import type { Aggregator } from '../../aggregator/state.js';

// Cap a snapshot so one hung provider can't stall the device's poll forever.
const SNAPSHOT_TIMEOUT_MS = 15_000;

export function registerStateRoute(app: FastifyInstance, agg: Aggregator) {
  app.get('/state', async (req, reply) => {
    // Cancel the snapshot if the client disconnects, or after a hard timeout.
    const onClose = new AbortController();
    req.raw.on('close', () => onClose.abort());
    const signal = AbortSignal.any([onClose.signal, AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)]);
    const snap = await agg.snapshot(signal);
    reply.header('Cache-Control', 'no-store');
    return snap;
  });
}
