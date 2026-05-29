// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Aggregator } from '../../src/aggregator/state.js';
import type { Provider } from '../../src/protocol/provider.js';
import type { UsageResult } from '../../src/protocol/usage.js';

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
