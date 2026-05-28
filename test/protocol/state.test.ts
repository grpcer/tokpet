// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { moodFromPct, STATE_PROTOCOL_VERSION } from '../../src/protocol/state.js';

describe('moodFromPct', () => {
  it.each([
    [0, 'chill'],
    [25, 'chill'],
    [49.9, 'chill'],
    [50, 'alert'],
    [75, 'alert'],
    [79.9, 'alert'],
    [80, 'stress'],
    [95, 'stress'],
    [100, 'stress'],
  ] as const)('maps %s%% to %s', (pct, expected) => {
    expect(moodFromPct(pct)).toBe(expected);
  });
});

describe('STATE_PROTOCOL_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(STATE_PROTOCOL_VERSION)).toBe(true);
    expect(STATE_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
