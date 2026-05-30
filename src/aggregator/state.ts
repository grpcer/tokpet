// SPDX-License-Identifier: Apache-2.0
//
// Aggregates provider results into a single State snapshot.
// Each provider is wrapped in a TTL cache to keep upstream call volume low.
//
// Stale-while-error: a short upstream blip (token refresh, vendor 5xx, sleep
// wake) shouldn't immediately flip a provider to `error` in /state — that
// would panic the device UI and red-flag the web console for a problem that
// usually resolves itself in seconds. Instead, on a transient failure we
// fall back to the last successful snapshot for up to STALE_GRACE_PERIOD_MS
// and mark it `source: 'stale'`. Only once the grace period elapses (or the
// failure is terminal, e.g. user disabled the provider) does the aggregator
// surface the underlying error.

import type { Provider } from '../protocol/provider.js';
import type { State, StateProvider } from '../protocol/state.js';
import { STATE_PROTOCOL_VERSION } from '../protocol/state.js';
import {
  isTransientErrorCode,
  isUsageError,
  type ProviderMode,
  type Usage,
  type UsageResult,
} from '../protocol/usage.js';
import { DEFAULT_CACHE_TTL_MS, makeTtlCache, type TtlCache } from '../cache/ttl.js';
import { computePrimary } from './pressure.js';

/** Window during which a transient fetch failure keeps serving the last
 *  successful snapshot as `source: 'stale'` instead of `kind: 'error'`. */
export const STALE_GRACE_PERIOD_MS = 15 * 60 * 1000;

interface ProviderEntry {
  provider: Provider;
  config: unknown;
  cache: TtlCache<UsageResult>;
  /** Last successful Usage observed for this provider, or undefined if we
   *  have never seen one (or it was discarded by a terminal error). */
  lastSuccess?: Usage;
}

export class Aggregator {
  private readonly entries: ProviderEntry[] = [];

  /** Register a provider. Re-registering the same id overwrites the prior entry. */
  register(provider: Provider, config: unknown, cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    this.unregister(provider.id);
    this.entries.push({
      provider,
      config,
      cache: makeTtlCache<UsageResult>(cacheTtlMs),
    });
  }

  /** Remove a provider (and its cache) by id. No-op if absent. */
  unregister(id: string) {
    const i = this.entries.findIndex((e) => e.provider.id === id);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /** Whether a provider with this id is currently registered. */
  has(id: string): boolean {
    return this.entries.some((e) => e.provider.id === id);
  }

  /** The currently registered providers, in current display order. */
  list(): { id: string; mode: ProviderMode }[] {
    return this.entries.map((e) => ({ id: e.provider.id, mode: e.provider.mode }));
  }

  /** Reorder registered providers to match `ids`. Unknown ids are ignored;
   *  registered providers missing from `ids` keep their relative order and
   *  trail the listed ones. The TTL caches and `lastSuccess` snapshots are
   *  preserved — reordering must not invalidate fresh data. */
  reorder(ids: readonly string[]): void {
    const byId = new Map<string, ProviderEntry>();
    for (const e of this.entries) byId.set(e.provider.id, e);

    const next: ProviderEntry[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const entry = byId.get(id);
      if (entry && !seen.has(id)) {
        next.push(entry);
        seen.add(id);
      }
    }
    for (const e of this.entries) if (!seen.has(e.provider.id)) next.push(e);

    this.entries.splice(0, this.entries.length, ...next);
  }

  async snapshot(signal: AbortSignal): Promise<State> {
    const ctx = { signal };

    const results = await Promise.all(
      this.entries.map(async (e): Promise<StateProvider> => {
        const cached = e.cache.get();
        let result: UsageResult;

        if (cached) {
          result = isUsageError(cached) ? cached : { ...cached, source: 'cached' };
        } else {
          const fresh = await e.provider.fetch(e.config, ctx);
          if (!isUsageError(fresh)) {
            e.cache.set(fresh);
            e.lastSuccess = fresh;
            result = fresh;
          } else if (isTransientErrorCode(fresh.code) && e.lastSuccess) {
            const ageMs = Date.now() - e.lastSuccess.fetchedAt.getTime();
            if (ageMs <= STALE_GRACE_PERIOD_MS) {
              result = {
                ...e.lastSuccess,
                source: 'stale',
                staleSince: e.lastSuccess.fetchedAt,
              };
            } else {
              result = fresh;
            }
          } else {
            // Terminal error (e.g. provider disabled) or no prior success
            // to fall back on. Drop any cached success so a later recovery
            // starts fresh rather than resurrecting old data.
            if (!isTransientErrorCode(fresh.code)) e.lastSuccess = undefined;
            result = fresh;
          }
        }

        return {
          id: e.provider.id,
          displayName: e.provider.displayName,
          mode: e.provider.mode,
          result,
        };
      }),
    );

    return {
      version: STATE_PROTOCOL_VERSION,
      fetchedAt: new Date().toISOString(),
      providers: results,
      primary: computePrimary(results),
    };
  }
}
