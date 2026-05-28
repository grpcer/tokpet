// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CACHE_TTL_MS, makeTtlCache } from '../../src/cache/ttl.js';

describe('makeTtlCache', () => {
  it('returns undefined before any value is set', () => {
    const cache = makeTtlCache<number>(1_000);
    expect(cache.get()).toBeUndefined();
  });

  it('returns the value while the TTL is fresh', () => {
    const cache = makeTtlCache<number>(1_000);
    cache.set(42);
    expect(cache.get()).toBe(42);
  });

  it('returns undefined after the TTL elapses', () => {
    vi.useFakeTimers();
    try {
      const cache = makeTtlCache<number>(1_000);
      cache.set(42);
      vi.advanceTimersByTime(1_001);
      expect(cache.get()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be invalidated explicitly', () => {
    const cache = makeTtlCache<string>(60_000);
    cache.set('hello');
    cache.invalidate();
    expect(cache.get()).toBeUndefined();
  });

  it('exports a sane default TTL', () => {
    expect(DEFAULT_CACHE_TTL_MS).toBeGreaterThanOrEqual(60_000);
  });
});
