// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Aggregator, STALE_GRACE_PERIOD_MS } from '../../src/aggregator/state.js';
import type { Provider } from '../../src/protocol/provider.js';
import type { SubscriptionUsage, UsageError, UsageResult } from '../../src/protocol/usage.js';

function mockProvider(id: string): Provider {
  return {
    id,
    displayName: id,
    mode: 'subscription',
    configSchema: z.any(),
    isReady: () => Promise.resolve(true),
    fetch: (): Promise<UsageResult> =>
      Promise.resolve({ mode: 'subscription', fetchedAt: new Date(), source: 'live', windows: [] }),
  };
}

describe('Aggregator registry ops', () => {
  it('registers and reports membership', () => {
    const agg = new Aggregator();
    expect(agg.has('a')).toBe(false);
    agg.register(mockProvider('a'), {});
    expect(agg.has('a')).toBe(true);
    expect(agg.list()).toEqual([{ id: 'a', mode: 'subscription' }]);
  });

  it('unregisters', () => {
    const agg = new Aggregator();
    agg.register(mockProvider('a'), {});
    agg.unregister('a');
    expect(agg.has('a')).toBe(false);
    expect(agg.list()).toEqual([]);
  });

  it('overwrites a same-id provider instead of duplicating', () => {
    const agg = new Aggregator();
    agg.register(mockProvider('a'), {});
    agg.register(mockProvider('a'), {});
    expect(agg.list()).toEqual([{ id: 'a', mode: 'subscription' }]);
  });
});

interface StubProvider {
  provider: Provider;
  succeed: (windows?: SubscriptionUsage['windows']) => void;
  fail: (code: UsageError['code']) => void;
  callCount: () => number;
}

function stubProvider(id: string): StubProvider {
  let next: UsageResult = {
    mode: 'subscription',
    fetchedAt: new Date(),
    source: 'live',
    windows: [],
  };
  let calls = 0;
  const provider: Provider = {
    id,
    displayName: id,
    mode: 'subscription',
    configSchema: z.any(),
    isReady: () => Promise.resolve(true),
    fetch: () => {
      calls += 1;
      return Promise.resolve(next);
    },
  };
  return {
    provider,
    succeed(windows = []) {
      next = { mode: 'subscription', fetchedAt: new Date(), source: 'live', windows };
    },
    fail(code) {
      next = { kind: 'error', code, message: `mock ${code}`, fetchedAt: new Date() };
    },
    callCount: () => calls,
  };
}

describe('Aggregator stale-while-error', () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to the last successful snapshot on a transient failure', async () => {
    const agg = new Aggregator();
    const stub = stubProvider('claude');
    // Disable the TTL cache so each snapshot re-invokes fetch().
    agg.register(stub.provider, {}, 0);

    stub.succeed([{ id: '5h', label: 'Past 5 hours', usedPct: 42, durationMins: 300 }]);
    const ok = await agg.snapshot(signal);
    expect(ok.providers[0]?.result).toMatchObject({ mode: 'subscription', source: 'live' });

    stub.fail('auth-expired');
    const stale = await agg.snapshot(signal);
    const result = stale.providers[0]?.result as SubscriptionUsage;
    expect(result.mode).toBe('subscription');
    expect(result.source).toBe('stale');
    expect(result.staleSince).toBeInstanceOf(Date);
    expect(result.windows[0]?.usedPct).toBe(42);
  });

  it('escalates to error once the failure exceeds the grace period', async () => {
    const agg = new Aggregator();
    const stub = stubProvider('claude');
    agg.register(stub.provider, {}, 0);

    stub.succeed();
    await agg.snapshot(signal);

    vi.advanceTimersByTime(STALE_GRACE_PERIOD_MS + 1_000);
    stub.fail('auth-expired');
    const snap = await agg.snapshot(signal);
    const result = snap.providers[0]?.result as UsageError;
    expect(result.kind).toBe('error');
    expect(result.code).toBe('auth-expired');
  });

  it('returns to a live snapshot once the provider recovers', async () => {
    const agg = new Aggregator();
    const stub = stubProvider('claude');
    agg.register(stub.provider, {}, 0);

    stub.succeed();
    await agg.snapshot(signal);

    stub.fail('upstream-error');
    const staleSnap = await agg.snapshot(signal);
    expect((staleSnap.providers[0]?.result as SubscriptionUsage).source).toBe('stale');

    stub.succeed([{ id: '5h', label: 'Past 5 hours', usedPct: 7, durationMins: 300 }]);
    const liveSnap = await agg.snapshot(signal);
    const live = liveSnap.providers[0]?.result as SubscriptionUsage;
    expect(live.source).toBe('live');
    expect(live.staleSince).toBeUndefined();
    expect(live.windows[0]?.usedPct).toBe(7);
  });

  it('surfaces the error immediately when there is no prior success to fall back on', async () => {
    const agg = new Aggregator();
    const stub = stubProvider('claude');
    agg.register(stub.provider, {}, 0);

    stub.fail('network');
    const snap = await agg.snapshot(signal);
    const result = snap.providers[0]?.result as UsageError;
    expect(result.kind).toBe('error');
    expect(result.code).toBe('network');
  });

  it('does not fall back to stale data for terminal errors', async () => {
    const agg = new Aggregator();
    const stub = stubProvider('claude');
    agg.register(stub.provider, {}, 0);

    stub.succeed();
    await agg.snapshot(signal);

    stub.fail('not-configured');
    const snap = await agg.snapshot(signal);
    const result = snap.providers[0]?.result as UsageError;
    expect(result.kind).toBe('error');
    expect(result.code).toBe('not-configured');
  });
});
