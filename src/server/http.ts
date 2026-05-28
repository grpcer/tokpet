// SPDX-License-Identifier: Apache-2.0

import Fastify, { type FastifyInstance } from 'fastify';
import type { Aggregator } from '../aggregator/state.js';
import { registerStateRoute } from './routes/state.js';

export async function startServer(agg: Aggregator, port: number): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/health', () => ({ ok: true }));
  registerStateRoute(app, agg);

  await app.listen({ host: '0.0.0.0', port });
  return app;
}
