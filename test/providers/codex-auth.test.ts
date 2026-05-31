// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ readFile }));

import { authMsToExpiry, loadCodexAuth } from '../../src/providers/subscription/codex/auth.js';

/** Build a minimal JWT whose payload carries the given `exp` (Unix seconds). */
function jwtWithExp(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

const OPAQUE_TOKEN = 'not-a-jwt-token';

describe('loadCodexAuth', () => {
  beforeEach(() => {
    readFile.mockReset();
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('parses access_token + account_id and derives expiresAt from the JWT exp', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    readFile.mockResolvedValue(
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: { access_token: jwtWithExp(exp), account_id: 'acct-1' },
      }),
    );

    const auth = await loadCodexAuth();
    expect(auth?.accessToken).toBe(jwtWithExp(exp));
    expect(auth?.accountId).toBe('acct-1');
    expect(auth?.expiresAt).toBe(exp * 1000);
  });

  it('treats an opaque (non-JWT) access token as non-expiring', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ tokens: { access_token: OPAQUE_TOKEN, account_id: 'acct-2' } }),
    );

    const auth = await loadCodexAuth();
    expect(auth?.accessToken).toBe(OPAQUE_TOKEN);
    expect(auth?.expiresAt).toBeUndefined();
    expect(authMsToExpiry(auth!)).toBe(Infinity);
  });

  it('returns undefined when the file is missing', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'));
    expect(await loadCodexAuth()).toBeUndefined();
  });

  it('returns undefined on malformed JSON', async () => {
    readFile.mockResolvedValue('{ not json');
    expect(await loadCodexAuth()).toBeUndefined();
  });

  it('returns undefined when access_token is missing', async () => {
    readFile.mockResolvedValue(JSON.stringify({ tokens: { account_id: 'acct-3' } }));
    expect(await loadCodexAuth()).toBeUndefined();
  });

  it('returns undefined when account_id is missing', async () => {
    readFile.mockResolvedValue(JSON.stringify({ tokens: { access_token: OPAQUE_TOKEN } }));
    expect(await loadCodexAuth()).toBeUndefined();
  });

  it('reads from $CODEX_HOME/auth.json when set', async () => {
    vi.stubEnv('CODEX_HOME', '/tmp/custom-codex');
    readFile.mockResolvedValue(
      JSON.stringify({ tokens: { access_token: OPAQUE_TOKEN, account_id: 'acct-4' } }),
    );

    await loadCodexAuth();
    expect(readFile).toHaveBeenCalledWith('/tmp/custom-codex/auth.json', 'utf8');
  });
});

describe('authMsToExpiry', () => {
  it('reports a positive remaining time for a future expiry', () => {
    const future = Date.now() + 60_000;
    expect(authMsToExpiry({ accessToken: 'x', accountId: 'y', expiresAt: future })).toBeGreaterThan(
      0,
    );
  });

  it('reports <= 0 for a past expiry', () => {
    const past = Date.now() - 60_000;
    expect(
      authMsToExpiry({ accessToken: 'x', accountId: 'y', expiresAt: past }),
    ).toBeLessThanOrEqual(0);
  });
});
