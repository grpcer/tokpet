// SPDX-License-Identifier: Apache-2.0
//
// Persistent configuration store.
//
// Holds which providers the user has activated, each provider's config, and
// the user-chosen display order. Written atomically (tmp + rename) so a crash
// mid-write can never leave a half-written file, and with 0600 permissions so
// future secrets stored here are not world-readable. Reads are total: a
// missing or corrupt file yields an empty config rather than an error, so
// callers never deal with I/O failures.
//
// Order semantics: `order` is the canonical render order shown in the web
// console and on the device tiles. Provider ids not listed in `order` fall
// back to insertion order (the order keys appear in `providers`). Unknown ids
// in `order` (e.g. a provider was removed but the order entry wasn't pruned)
// are silently skipped by `orderedProviderIds`.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TokpetConfig {
  readonly version: 1;
  /** providerId -> that provider's config object (must satisfy its `configSchema`). */
  providers: Record<string, unknown>;
  /** User-chosen display order. Optional for backwards compatibility with
   *  pre-ordering configs; missing or empty means "fall back to insertion
   *  order". Entries pointing at provider ids no longer in `providers` are
   *  ignored by readers; writers prune them on the next save. */
  order?: string[];
}

/** Config directory; overridable via `TOKPET_CONFIG_DIR` (used by tests). */
function configDir(): string {
  return process.env.TOKPET_CONFIG_DIR ?? join(homedir(), '.tokpet');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

function emptyConfig(): TokpetConfig {
  return { version: 1, providers: {}, order: [] };
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
      const order =
        Array.isArray(parsed.order) && parsed.order.every((x) => typeof x === 'string')
          ? parsed.order
          : [];
      return { version: 1, providers: parsed.providers, order };
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

/** Persist (or overwrite) a single provider's configuration. New providers
 *  are appended to the end of `order`; an existing provider keeps its slot. */
export async function saveProvider(id: string, providerConfig: unknown): Promise<void> {
  const cfg = await loadConfig();
  cfg.providers[id] = providerConfig;
  const order = (cfg.order ?? []).filter((x) => x !== id || cfg.providers[x] !== undefined);
  if (!order.includes(id)) order.push(id);
  cfg.order = order;
  await writeConfig(cfg);
}

/** Remove a provider's configuration if present, including its order slot. */
export async function removeProvider(id: string): Promise<void> {
  const cfg = await loadConfig();
  delete cfg.providers[id];
  cfg.order = (cfg.order ?? []).filter((x) => x !== id);
  await writeConfig(cfg);
}

/** Persist a new display order. Filters out unknown ids and appends any
 *  activated provider not mentioned in `order` so we never lose a card. */
export async function saveOrder(order: readonly string[]): Promise<void> {
  const cfg = await loadConfig();
  const known = new Set(Object.keys(cfg.providers));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of order) {
    if (known.has(id) && !seen.has(id)) {
      next.push(id);
      seen.add(id);
    }
  }
  for (const id of known) if (!seen.has(id)) next.push(id);
  cfg.order = next;
  await writeConfig(cfg);
}

/** Return activated provider ids in display order. Unknown order entries are
 *  skipped; activated providers missing from `order` are appended in insertion
 *  order so newly-added providers stay reachable. */
export function orderedProviderIds(cfg: TokpetConfig): string[] {
  const present = new Set(Object.keys(cfg.providers));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of cfg.order ?? []) {
    if (present.has(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  for (const id of present) if (!seen.has(id)) out.push(id);
  return out;
}
