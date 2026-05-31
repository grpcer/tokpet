// SPDX-License-Identifier: Apache-2.0
//
// Codex CLI token loader.
//
// The Codex CLI logs in with a ChatGPT subscription and stores its tokens
// in a plain JSON file at `${CODEX_HOME:-~/.codex}/auth.json`. We reuse that
// login state directly (no keychain involved on any platform).

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CodexAuth {
  readonly accessToken: string;
  readonly accountId: string;
  /** Unix milliseconds. Undefined means "never expires" (treat as valid). */
  readonly expiresAt?: number;
}

interface AuthPayload {
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

function authFilePath(): string {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  return join(home, 'auth.json');
}

export async function loadCodexAuth(): Promise<CodexAuth | undefined> {
  let raw: string;
  try {
    raw = await readFile(authFilePath(), 'utf8');
  } catch {
    return undefined;
  }

  let parsed: AuthPayload;
  try {
    parsed = JSON.parse(raw) as AuthPayload;
  } catch {
    return undefined;
  }

  const accessToken = parsed.tokens?.access_token;
  const accountId = parsed.tokens?.account_id;
  if (!accessToken || !accountId) return undefined;

  return { accessToken, accountId, expiresAt: jwtExpiryMs(accessToken) };
}

/**
 * Best-effort `exp` claim from a JWT access token, in Unix milliseconds.
 * Returns undefined when the token is opaque / unparsable — callers then
 * treat the credential as non-expiring rather than rejecting it outright.
 */
function jwtExpiryMs(token: string): number | undefined {
  const claims = token.split('.')[1];
  if (!claims) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp !== 'number') return undefined;
    return payload.exp * 1000;
  } catch {
    return undefined;
  }
}

/** Time-to-expiry in ms. Infinity = no expiry; ≤ 0 = expired. */
export function authMsToExpiry(auth: CodexAuth): number {
  if (auth.expiresAt == null) return Infinity;
  return auth.expiresAt - Date.now();
}
