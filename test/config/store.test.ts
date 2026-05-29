// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveProvider, removeProvider } from '../../src/config/store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tokpet-cfg-'));
  process.env.TOKPET_CONFIG_DIR = dir;
});
afterEach(async () => {
  delete process.env.TOKPET_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('config store', () => {
  it('returns an empty config when no file exists', async () => {
    expect(await loadConfig()).toEqual({ version: 1, providers: {} });
  });

  it('round-trips a saved provider config', async () => {
    await saveProvider('claude', { enabled: true });
    expect(await loadConfig()).toEqual({ version: 1, providers: { claude: { enabled: true } } });
  });

  it('leaves no .tmp file behind after an atomic write', async () => {
    await saveProvider('claude', { enabled: true });
    const files = await readdir(dir);
    expect(files).toContain('config.json');
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('removes a provider', async () => {
    await saveProvider('claude', { enabled: true });
    await removeProvider('claude');
    expect(await loadConfig()).toEqual({ version: 1, providers: {} });
  });

  it('falls back to empty config on a corrupt file', async () => {
    await writeFile(join(dir, 'config.json'), '{ not json', 'utf8');
    expect(await loadConfig()).toEqual({ version: 1, providers: {} });
  });
});
