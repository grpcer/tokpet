// SPDX-License-Identifier: Apache-2.0
//
// Persistent configuration store.
//
// Holds which providers the user has activated and each provider's config.
// Written atomically (tmp + rename) so a crash mid-write can never leave a
// half-written file, and with 0600 permissions so future secrets stored here
// are not world-readable. Reads are total: a missing or corrupt file yields an
// empty config rather than an error, so callers never deal with I/O failures.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TokpetConfig {
  readonly version: 1;
  /** providerId -> that provider's config object (must satisfy its `configSchema`). */
  providers: Record<string, unknown>;
}

/** Config directory; overridable via `TOKPET_CONFIG_DIR` (used by tests). */
function configDir(): string {
  return process.env.TOKPET_CONFIG_DIR ?? join(homedir(), '.tokpet');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

function emptyConfig(): TokpetConfig {
  return { version: 1, providers: {} };
}

/**
 * Load the persisted configuration. Returns an empty config when the file is
 * absent, unreadable, or malformed — callers never need to handle I/O errors.
 */
export async function loadConfig(): Promise<TokpetConfig> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch {
    return emptyConfig();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TokpetConfig>;
    if (parsed?.version === 1 && parsed.providers && typeof parsed.providers === 'object') {
      return { version: 1, providers: parsed.providers };
    }
  } catch {
    // malformed JSON — fall through to empty config
  }
  return emptyConfig();
}

/** Atomically write the whole config, creating the directory if needed. */
async function writeConfig(cfg: TokpetConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${configPath()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, configPath());
}

/** Persist (or overwrite) a single provider's configuration. */
export async function saveProvider(id: string, providerConfig: unknown): Promise<void> {
  const cfg = await loadConfig();
  cfg.providers[id] = providerConfig;
  await writeConfig(cfg);
}

/** Remove a provider's configuration if present. */
export async function removeProvider(id: string): Promise<void> {
  const cfg = await loadConfig();
  delete cfg.providers[id];
  await writeConfig(cfg);
}
