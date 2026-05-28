// SPDX-License-Identifier: Apache-2.0
//
// Tokpet public contract — GET /state JSON.
//
// This is the only stable surface guaranteed for third-party hardware and
// clients. The version is bumped on any breaking schema change.

import type { ProviderMode, UsageResult } from './usage.js';

export const STATE_PROTOCOL_VERSION = 1 as const;

export interface StateProvider {
  readonly id: string;
  readonly displayName: string;
  readonly mode: ProviderMode;
  readonly result: UsageResult;
}

/** "Hero" metric — what the device shows by default. */
export interface Primary {
  readonly providerId: string;
  readonly windowId?: string;
  readonly usedPct: number;
  readonly mood: 'chill' | 'alert' | 'stress';
}

export interface State {
  readonly version: typeof STATE_PROTOCOL_VERSION;
  /** Server timestamp in ISO 8601. */
  readonly fetchedAt: string;
  readonly providers: readonly StateProvider[];
  readonly primary?: Primary;
}

/** Map used-percentage to a mood tier (mirrors the UI thresholds). */
export function moodFromPct(pct: number): Primary['mood'] {
  if (pct >= 80) return 'stress';
  if (pct >= 50) return 'alert';
  return 'chill';
}
