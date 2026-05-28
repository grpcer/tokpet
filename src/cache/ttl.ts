// SPDX-License-Identifier: Apache-2.0
//
// Minimal in-memory TTL cache.
// Default 180s aligns with the Claude usage endpoint guidance to avoid
// triggering its rate limiter.

export interface TtlCache<T> {
  get(): T | undefined;
  set(v: T): void;
  invalidate(): void;
}

export function makeTtlCache<T>(ttlMs: number): TtlCache<T> {
  let value: T | undefined;
  let expiresAt = 0;
  return {
    get() {
      if (value === undefined || Date.now() >= expiresAt) return undefined;
      return value;
    },
    set(v) {
      value = v;
      expiresAt = Date.now() + ttlMs;
    },
    invalidate() {
      value = undefined;
      expiresAt = 0;
    },
  };
}

export const DEFAULT_CACHE_TTL_MS = 180_000;
