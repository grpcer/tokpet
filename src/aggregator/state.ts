// SPDX-License-Identifier: Apache-2.0
//
// Aggregates provider results into a single State snapshot.
// Each provider is wrapped in a TTL cache to keep upstream call volume low.

import type { Provider } from '../protocol/provider.js';
import type { State, StateProvider } from '../protocol/state.js';
import { STATE_PROTOCOL_VERSION } from '../protocol/state.js';
import { isUsageError, type ProviderMode, type UsageResult } from '../protocol/usage.js';
import { DEFAULT_CACHE_TTL_MS, makeTtlCache, type TtlCache } from '../cache/ttl.js';
import { computePrimary } from './pressure.js';

interface ProviderEntry {
  provider: Provider;
  config: unknown;
  cache: TtlCache<UsageResult>;
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

  /** The currently registered providers, in registration order. */
  list(): { id: string; mode: ProviderMode }[] {
    return this.entries.map((e) => ({ id: e.provider.id, mode: e.provider.mode }));
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
          result = await e.provider.fetch(e.config, ctx);
          if (!isUsageError(result)) e.cache.set(result);
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
