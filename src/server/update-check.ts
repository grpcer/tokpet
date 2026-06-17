// SPDX-License-Identifier: Apache-2.0
//
// Best-effort "is there a newer tokpet on npm?" check. Polls the npm registry
// dist-tags occasionally and caches the result so the console can surface an
// "update available" hint pointing at `brew upgrade` / `npm i -g`. We never
// auto-replace the binary — that would fight the package manager — and the
// check never throws: a network failure just means no hint this cycle.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/tokpet/dist-tags';
// Twice a day is plenty for a hint; we also check once at startup.
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export interface UpdateInfo {
  readonly current: string;
  readonly latest: string | null;
  readonly available: boolean;
}

/** Read this build's version. dist/server/update-check.js -> ../../package.json. */
export function currentVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

/** True when `latest` is a strictly higher dotted numeric version than `current`.
 *  Pre-release suffixes are ignored (we don't publish them); good enough for x.y.z. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const l = a[i] ?? 0;
    const c = b[i] ?? 0;
    if (l !== c) return l > c;
  }
  return false;
}

let cached: UpdateInfo = { current: '', latest: null, available: false };

async function checkOnce(): Promise<void> {
  const current = currentVersion();
  try {
    const res = await fetch(DIST_TAGS_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      cached = { current, latest: null, available: false };
      return;
    }
    const tags = (await res.json()) as { latest?: unknown };
    const latest = typeof tags.latest === 'string' ? tags.latest : null;
    cached = { current, latest, available: latest !== null && isNewer(latest, current) };
  } catch {
    // Offline / timeout / registry hiccup — just report no update this cycle.
    cached = { current, latest: null, available: false };
  }
}

/** Current cached view of update availability (synchronous, for the API). */
export function getUpdateInfo(): UpdateInfo {
  return cached;
}

/** Seed the current version immediately, check once now, then on an interval.
 *  The timer is unref'd so it never keeps the process alive on its own. */
export function startUpdateChecks(): void {
  cached = { current: currentVersion(), latest: null, available: false };
  void checkOnce();
  const timer = setInterval(() => void checkOnce(), CHECK_INTERVAL_MS);
  timer.unref();
}
