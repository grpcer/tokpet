// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { computePrimary } from '../../src/aggregator/pressure.js';
import type { StateProvider } from '../../src/protocol/state.js';

const fetchedAt = new Date('2026-01-01T00:00:00Z');

describe('computePrimary', () => {
  it('returns undefined when no providers are present', () => {
    expect(computePrimary([])).toBeUndefined();
  });

  it('returns undefined when every provider has only errors', () => {
    const providers: StateProvider[] = [
      {
        id: 'claude',
        displayName: 'Claude',
        mode: 'subscription',
        result: { kind: 'error', code: 'auth-expired', message: '', fetchedAt },
      },
    ];
    expect(computePrimary(providers)).toBeUndefined();
  });

  it('picks the highest window across all subscription providers', () => {
    const providers: StateProvider[] = [
      {
        id: 'claude',
        displayName: 'Claude',
        mode: 'subscription',
        result: {
          mode: 'subscription',
          fetchedAt,
          source: 'live',
          windows: [
            { id: '5h', label: '5h', usedPct: 30 },
            { id: '7d', label: '7d', usedPct: 60 },
          ],
        },
      },
      {
        id: 'codex',
        displayName: 'Codex',
        mode: 'subscription',
        result: {
          mode: 'subscription',
          fetchedAt,
          source: 'live',
          windows: [{ id: '5h', label: '5h', usedPct: 85 }],
        },
      },
    ];

    const primary = computePrimary(providers);
    expect(primary).toEqual({
      providerId: 'codex',
      windowId: '5h',
      usedPct: 85,
      mood: 'stress',
    });
  });

  it('considers api-key balance utilization when total is known', () => {
    const providers: StateProvider[] = [
      {
        id: 'openai-api',
        displayName: 'OpenAI API',
        mode: 'api-key',
        result: {
          mode: 'api-key',
          fetchedAt,
          source: 'live',
          balance: { used: 70, total: 100, currency: 'USD', period: 'monthly' },
        },
      },
    ];
    const primary = computePrimary(providers);
    expect(primary?.providerId).toBe('openai-api');
    expect(primary?.usedPct).toBe(70);
    expect(primary?.mood).toBe('alert');
  });

  it('ignores api-key providers without a total', () => {
    const providers: StateProvider[] = [
      {
        id: 'openai-api',
        displayName: 'OpenAI API',
        mode: 'api-key',
        result: {
          mode: 'api-key',
          fetchedAt,
          source: 'live',
          balance: { used: 70, currency: 'USD' },
        },
      },
    ];
    expect(computePrimary(providers)).toBeUndefined();
  });
});
