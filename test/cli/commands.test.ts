// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import { resolveCommand } from '../../src/cli/commands.js';

describe('resolveCommand', () => {
  it('defaults to start with no args', () => expect(resolveCommand([])).toEqual({ kind: 'start' }));
  it('maps start', () => expect(resolveCommand(['start'])).toEqual({ kind: 'start' }));
  it('maps open', () => expect(resolveCommand(['open'])).toEqual({ kind: 'open' }));
  it('maps service actions', () => {
    expect(resolveCommand(['service', 'install'])).toEqual({ kind: 'service', action: 'install' });
    expect(resolveCommand(['service', 'uninstall'])).toEqual({
      kind: 'service',
      action: 'uninstall',
    });
    expect(resolveCommand(['service', 'status'])).toEqual({ kind: 'service', action: 'status' });
  });
  it('rejects an unknown service action as help+error', () => {
    expect(resolveCommand(['service', 'frobnicate']).kind).toBe('help');
  });
  it('maps version flags', () =>
    expect(resolveCommand(['--version'])).toEqual({ kind: 'version' }));
  it('unknown command falls to help with an error', () => {
    const c = resolveCommand(['wat']);
    expect(c).toMatchObject({ kind: 'help' });
    expect((c as { error?: string }).error).toBeTruthy();
  });
});
