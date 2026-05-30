// SPDX-License-Identifier: Apache-2.0

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Aggregator } from '../aggregator/state.js';
import { ALL_PROVIDERS } from '../providers/registry.js';
import { registerStateRoute } from './routes/state.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { createRuntimeState, type RuntimeState } from './runtime.js';

export async function startServer(
  agg: Aggregator,
  port: number,
  runtime: RuntimeState = createRuntimeState(port),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/health', () => ({ ok: true }));
  registerStateRoute(app, agg, runtime);
  registerConfigRoutes(app, agg, ALL_PROVIDERS);
  registerRuntimeRoutes(app, runtime);

  // Serve the setup page. `public/` sits at the package root; both
  // src/server/http.ts (dev) and dist/server/http.js (build) resolve to it
  // via ../../public.
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
  await app.register(fastifyStatic, { root: publicDir });

  await app.listen({ host: '0.0.0.0', port });
  return app;
}
