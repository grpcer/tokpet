// SPDX-License-Identifier: Apache-2.0
//
// Configuration API consumed by the local setup page: list providers, test a
// provider by fetching once, activate (persist + hot-register) and deactivate.
//
// Security: the service binds 0.0.0.0 so devices on the LAN can read GET /state,
// but these endpoints read and mutate local configuration and must never be
// reachable from the network. They live in an encapsulated scope guarded to
// loopback callers only; /state and /health are registered outside it.

import type { FastifyInstance } from 'fastify';
import type { Aggregator } from '../../aggregator/state.js';
import type { Provider } from '../../protocol/provider.js';
import { isUsageError } from '../../protocol/usage.js';
import { loadConfig, removeProvider, saveOrder, saveProvider } from '../../config/store.js';

function isLoopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Bound each upstream usage fetch so a hung provider can't hang the request.
const FETCH_TIMEOUT_MS = 15_000;

export function registerConfigRoutes(
  app: FastifyInstance,
  agg: Aggregator,
  providers: readonly Provider[],
) {
  const find = (id: string) => providers.find((p) => p.id === id);

  void app.register((instance, _opts, done) => {
    // Local-only guard: these routes mutate configuration; the LAN must not reach them.
    instance.addHook('onRequest', (req, reply, next) => {
      if (!isLoopback(req.ip)) {
        void reply.code(403).send({ ok: false, error: 'configuration API is local-only' });
        return;
      }
      next();
    });

    // Activated providers are returned in the user-chosen order kept by the
    // aggregator (the order behind /state and the device tiles); unactivated
    // ones trail in registry order. Without this, the dashboard's optimistic
    // ↑/↓ reorder would be immediately overwritten by the next refresh —
    // because `providers` here is registry order, not user order.
    instance.get('/api/providers', () => {
      const order = new Map<string, number>();
      agg.list().forEach((e, i) => order.set(e.id, i));
      const sorted = [...providers].sort((a, b) => {
        const ia = order.has(a.id) ? (order.get(a.id) as number) : Infinity;
        const ib = order.has(b.id) ? (order.get(b.id) as number) : Infinity;
        if (ia !== ib) return ia - ib;
        return providers.indexOf(a) - providers.indexOf(b);
      });
      return sorted.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        mode: p.mode,
        available: true,
        activated: agg.has(p.id),
      }));
    });

    instance.get('/api/config', () => loadConfig());

    instance.post('/api/providers/:id/test', async (req, reply) => {
      const { id } = req.params as { id: string };
      const provider = find(id);
      if (!provider) return reply.code(404).send({ ok: false, error: 'unknown provider' });

      let config: unknown;
      try {
        config = provider.configSchema.parse(req.body ?? {});
      } catch {
        return reply.code(400).send({ ok: false, error: 'invalid config' });
      }

      const result = await provider.fetch(config, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return isUsageError(result) ? { ok: false, error: result } : { ok: true, usage: result };
    });

    instance.post('/api/providers/:id/activate', async (req, reply) => {
      const { id } = req.params as { id: string };
      const provider = find(id);
      if (!provider) return reply.code(404).send({ ok: false, error: 'unknown provider' });

      // The dashboard's Reconnect button posts an empty body so api-key
      // providers (e.g. DeepSeek's required apiKey) can re-test the stored
      // credentials without re-prompting. Fall back to the persisted config
      // when the request body has no fields to merge.
      let effectiveBody: unknown = req.body;
      if (
        effectiveBody == null ||
        (typeof effectiveBody === 'object' &&
          !Array.isArray(effectiveBody) &&
          Object.keys(effectiveBody).length === 0)
      ) {
        const stored = (await loadConfig()).providers[id];
        if (stored !== undefined) {
          effectiveBody = stored;
        }
      }

      let config: unknown;
      try {
        config = provider.configSchema.parse(effectiveBody ?? {});
      } catch {
        return reply.code(400).send({ ok: false, error: 'invalid config' });
      }

      // Confirm the credentials work before persisting, so activation can't
      // leave a broken provider enabled.
      const result = await provider.fetch(config, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (isUsageError(result)) return { ok: false, error: result };

      await saveProvider(id, config);
      agg.register(provider, config);
      return { ok: true, usage: result };
    });

    instance.delete('/api/providers/:id', async (req) => {
      const { id } = req.params as { id: string };
      await removeProvider(id);
      agg.unregister(id);
      return { ok: true };
    });

    // Reorder the activated provider cards. The body must shape as
    // `{ order: string[] }` where every id is currently activated; any id
    // not yet activated (or unknown) is silently dropped by saveOrder and the
    // aggregator alike. This is what backs the console's up/down arrows and
    // is what the device tiles render in.
    instance.post('/api/providers/reorder', async (req, reply) => {
      const body = req.body as { order?: unknown } | null;
      const raw = body?.order;
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) {
        return reply.code(400).send({ ok: false, error: 'order must be a string[]' });
      }
      await saveOrder(raw);
      agg.reorder(raw);
      return { ok: true, order: agg.list().map((e) => e.id) };
    });

    done();
  });
}
