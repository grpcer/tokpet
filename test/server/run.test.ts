// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { shouldOpenBrowser } from '../../src/server/run.js';

describe('shouldOpenBrowser', () => {
  it('opens for an interactive run even when providers exist', () =>
    expect(shouldOpenBrowser({ noOpen: false, isTTY: true, hasProviders: true })).toBe(true));

  it('opens on first run (no providers) even without a TTY', () =>
    expect(shouldOpenBrowser({ noOpen: false, isTTY: false, hasProviders: false })).toBe(true));

  it('stays quiet for a configured background auto-start', () =>
    expect(shouldOpenBrowser({ noOpen: false, isTTY: false, hasProviders: true })).toBe(false));

  it('TOKPET_NO_OPEN always suppresses, regardless of TTY or config', () => {
    expect(shouldOpenBrowser({ noOpen: true, isTTY: true, hasProviders: false })).toBe(false);
    expect(shouldOpenBrowser({ noOpen: true, isTTY: false, hasProviders: false })).toBe(false);
  });
});
