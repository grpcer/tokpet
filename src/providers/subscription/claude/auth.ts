// SPDX-License-Identifier: Apache-2.0
//
// Claude OAuth token loader.
//
//   macOS:      Keychain item 'Claude Code-credentials' (generic-password).
//   Linux/WSL:  ~/.claude/.credentials.json (plain file, mode 0600).

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readKeychainItem } from '../../../utils/keychain.js';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const REQUIRED_SCOPES = ['user:profile', 'user:inference'] as const;

export interface ClaudeAuth {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Unix milliseconds. Undefined means "never expires" (treat as valid). */
  readonly expiresAt?: number;
  readonly scopes?: readonly string[];
}

interface CredentialsPayload {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
}

export async function loadClaudeAuth(): Promise<ClaudeAuth | undefined> {
  const raw = await readRawCredentials();
  if (!raw) return undefined;

  let parsed: CredentialsPayload;
  try {
    parsed = JSON.parse(raw) as CredentialsPayload;
  } catch {
    return undefined;
  }

  const tok = parsed.claudeAiOauth?.accessToken;
  if (!tok) return undefined;

  return {
    accessToken: tok,
    refreshToken: parsed.claudeAiOauth?.refreshToken,
    expiresAt: parsed.claudeAiOauth?.expiresAt,
    scopes: parsed.claudeAiOauth?.scopes,
  };
}

async function readRawCredentials(): Promise<string | undefined> {
  if (process.platform === 'darwin') {
    try {
      return await readKeychainItem(KEYCHAIN_SERVICE);
    } catch {
      return undefined;
    }
  }
  try {
    const path = join(homedir(), '.claude', '.credentials.json');
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Both scopes must be present for the usage endpoint to accept the token. */
export function authHasRequiredScopes(auth: ClaudeAuth): boolean {
  if (!auth.scopes) return false;
  return REQUIRED_SCOPES.every((s) => auth.scopes!.includes(s));
}

/** Time-to-expiry in ms. Infinity = no expiry; ≤ 0 = expired. */
export function authMsToExpiry(auth: ClaudeAuth): number {
  if (auth.expiresAt == null) return Infinity;
  return auth.expiresAt - Date.now();
}
