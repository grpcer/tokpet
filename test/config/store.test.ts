// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  orderedProviderIds,
  removeProvider,
  saveOrder,
  saveProvider,
} from '../../src/config/store.js';

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
    expect(await loadConfig()).toEqual({ version: 1, providers: {}, order: [] });
  });

  it('round-trips a saved provider config', async () => {
    await saveProvider('claude', { enabled: true });
    expect(await loadConfig()).toEqual({
      version: 1,
      providers: { claude: { enabled: true } },
      order: ['claude'],
    });
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
    expect(await loadConfig()).toEqual({ version: 1, providers: {}, order: [] });
  });

  it('falls back to empty config on a corrupt file', async () => {
    await writeFile(join(dir, 'config.json'), '{ not json', 'utf8');
    expect(await loadConfig()).toEqual({ version: 1, providers: {}, order: [] });
  });

  it('appends new providers to the order in activation order', async () => {
    await saveProvider('claude', { enabled: true });
    await saveProvider('deepseek', { apiKey: 'sk-x' });
    expect((await loadConfig()).order).toEqual(['claude', 'deepseek']);
  });

  it('persists a user-chosen order via saveOrder', async () => {
    await saveProvider('claude', { enabled: true });
    await saveProvider('deepseek', { apiKey: 'sk-x' });
    await saveOrder(['deepseek', 'claude']);
    expect((await loadConfig()).order).toEqual(['deepseek', 'claude']);
  });

  it('saveOrder ignores unknown ids and appends missing ones', async () => {
    await saveProvider('claude', { enabled: true });
    await saveProvider('deepseek', { apiKey: 'sk-x' });
    await saveOrder(['deepseek', 'ghost']);
    // ghost dropped (unknown), claude appended after deepseek (activated but missing).
    expect((await loadConfig()).order).toEqual(['deepseek', 'claude']);
  });

  it('removeProvider prunes its order slot', async () => {
    await saveProvider('claude', { enabled: true });
    await saveProvider('deepseek', { apiKey: 'sk-x' });
    await saveOrder(['deepseek', 'claude']);
    await removeProvider('deepseek');
    expect((await loadConfig()).order).toEqual(['claude']);
  });

  it('orderedProviderIds returns activated ids in display order', async () => {
    await saveProvider('claude', { enabled: true });
    await saveProvider('deepseek', { apiKey: 'sk-x' });
    await saveOrder(['deepseek', 'claude']);
    const cfg = await loadConfig();
    expect(orderedProviderIds(cfg)).toEqual(['deepseek', 'claude']);
  });

  it('orderedProviderIds appends activated providers missing from order', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        providers: { claude: { enabled: true }, deepseek: { apiKey: 'sk-x' } },
        order: ['claude'],
      }),
      'utf8',
    );
    const cfg = await loadConfig();
    // deepseek not in order is appended in insertion order.
    expect(orderedProviderIds(cfg)).toEqual(['claude', 'deepseek']);
  });

  it('orderedProviderIds drops unknown order entries', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        providers: { claude: { enabled: true } },
        order: ['ghost', 'claude'],
      }),
      'utf8',
    );
    const cfg = await loadConfig();
    expect(orderedProviderIds(cfg)).toEqual(['claude']);
  });

  it('loads legacy config without an order field as empty order', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, providers: { claude: { enabled: true } } }),
      'utf8',
    );
    const cfg = await loadConfig();
    expect(cfg.order).toEqual([]);
    expect(orderedProviderIds(cfg)).toEqual(['claude']);
  });
});
