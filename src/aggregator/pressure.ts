// SPDX-License-Identifier: Apache-2.0
//
// Computes the "hero" metric: the highest used-percentage across all
// providers. The device shows this by default; users can flip pages to view
// individual provider cards.

import type { Primary, StateProvider } from '../protocol/state.js';
import { moodFromPct } from '../protocol/state.js';
import { isUsageError } from '../protocol/usage.js';

export function computePrimary(stateProviders: readonly StateProvider[]): Primary | undefined {
  let best: { providerId: string; windowId?: string; usedPct: number } | undefined;

  for (const sp of stateProviders) {
    const r = sp.result;
    if (isUsageError(r)) continue;

    if (r.mode === 'subscription') {
      for (const w of r.windows) {
        if (!best || w.usedPct > best.usedPct) {
          best = { providerId: sp.id, windowId: w.id, usedPct: w.usedPct };
        }
      }
    } else if (
      r.balance &&
      typeof r.balance.used === 'number' &&
      typeof r.balance.total === 'number' &&
      r.balance.total > 0
    ) {
      // Pre-paid providers (DeepSeek, etc.) only report `remaining` and have no
      // meaningful "percent used" — they cannot participate in primary
      // selection and are surfaced only on their own provider card / screen.
      const pct = (r.balance.used / r.balance.total) * 100;
      if (!best || pct > best.usedPct) {
        best = { providerId: sp.id, usedPct: pct };
      }
    }
  }

  if (!best) return undefined;
  return { ...best, mood: moodFromPct(best.usedPct) };
}
