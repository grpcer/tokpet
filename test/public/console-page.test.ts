// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pagePath = join(process.cwd(), 'public', 'index.html');

function scriptFrom(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? '';
}

function makeElement() {
  const classes = new Set<string>();
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: { display: '' },
    dataset: {} as Record<string, string>,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        if (force === false) classes.delete(name);
        else classes.add(name);
      },
      contains: (name: string) => classes.has(name),
    },
  };
}

function createConsoleContext(fetchImpl: (url: string, init?: unknown) => Promise<unknown>) {
  const ids = [
    'toast',
    'serviceStatus',
    'stateStatus',
    'deviceStatus',
    'providerStatus',
    'nowRing',
    'nowMetric',
    'nowLabel',
    'nowMood',
    'providersList',
    'devicesList',
    'networkList',
    'stateJson',
    'modes',
    'next1',
    'providerOptions',
    'next2',
    'step1',
    'step2',
    'step3',
    'dot1',
    'dot2',
    'dot3',
    'connectTitle',
    'connectError',
    'connectBtn',
    'removeTitle',
    'removeCopy',
    'removeConfirmBtn',
    'removeDialog',
  ];
  const elements = new Map(ids.map((id) => [id, makeElement()]));
  const context = vm.createContext({
    document: {
      body: makeElement(),
      getElementById: (id: string) => elements.get(id) ?? makeElement(),
      querySelectorAll: () => [],
    },
    navigator: { clipboard: { writeText: () => undefined } },
    confirm: () => true,
    setTimeout: () => 0,
    fetch: fetchImpl,
  });
  return { context, elements };
}

describe('Tokpet Console page', () => {
  it('is a console dashboard, not a setup-only page', async () => {
    const html = await readFile(pagePath, 'utf8');

    expect(html).toContain('Tokpet Console');
    expect(html).toContain('Providers');
    expect(html).toContain('Devices');
    expect(html).toContain('State Preview');
    expect(html).toContain('Add provider');
    expect(html).toContain('/api/runtime');
    expect(html).toContain('removeProvider');
    expect(html).toContain('removeDialog');
    expect(html).toContain('Advanced diagnostics');
    expect(html).not.toContain('confirm(');
  });

  it('uses a self-contained icon system for primary controls and sections', async () => {
    const html = await readFile(pagePath, 'utf8');

    for (const id of [
      'i-plus',
      'i-refresh',
      'i-provider',
      'i-device',
      'i-network',
      'i-copy',
      'i-trash',
      'i-reconnect',
      'i-diagnostics',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('icon="plus"');
    expect(html).toContain('icon="refresh"');
    expect(html).toContain('icon-bubble provider');
    expect(html).toContain('icon-bubble device');
    expect(html).toContain('icon-bubble network');
    expect(html).toContain("icon('trash')");
    expect(html).toContain("icon('reconnect')");
  });

  it('guards against the visible layout regressions from the console review', async () => {
    const html = await readFile(pagePath, 'utf8');

    expect(html).toMatch(/\.icon\{[^}]*flex:0 0 18px/);
    expect(html).toMatch(/<symbol id="i-plus"[^>]*stroke="currentColor"/);
    expect(html).toContain('<svg class="icon" viewBox="0 0 24 24"');
    expect(html).toMatch(/\.btn\{[^}]*white-space:nowrap/);
    expect(html).toMatch(/\.content\{[^}]*align-items:start/);
    expect(html).toContain('source-mark');
    expect(html).toContain('section-title');
    expect(html).toContain('panel-hint');
    expect(html).toMatch(/\.panel-head\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
    expect(html).toContain('class="net-card"');
    expect(html).toContain('class="url-line"');
    expect(html).toContain('copyUrl(this.dataset.url)');
    expect(html).toMatch(/\.network-list code\{[^}]*overflow-wrap:anywhere/);
    expect(html).not.toContain('text-overflow:ellipsis;color:var(--ink);background:#f0ebfb');
    expect(html).toMatch(/@media\(max-width:560px\)\{[\s\S]*\.provider-head,\s*\.device-head\{display:grid/);
    expect(html).toMatch(/body\{[\s\S]*overflow-x:hidden/);
    expect(html).toContain('.status{min-width:0');
    expect(html).toContain('.brand-row>div:last-child{min-width:0}');
  });

  it('contains syntactically valid inline JavaScript', async () => {
    const html = await readFile(pagePath, 'utf8');

    expect(() => new vm.Script(scriptFrom(html))).not.toThrow();
  });

  it('renders provider, runtime, and state data from the local APIs', async () => {
    const html = await readFile(pagePath, 'utf8');
    const { context, elements } = createConsoleContext((url: string) =>
        Promise.resolve({
          ok: true,
          json: () => {
            if (url === '/api/providers') {
              return Promise.resolve([
                {
                  id: 'claude',
                  displayName: 'Claude',
                  mode: 'subscription',
                  available: true,
                  activated: true,
                },
              ]);
            }
            if (url === '/api/runtime') {
              return Promise.resolve({
                ok: true,
                service: {
                  status: 'running',
                  localUrl: 'http://localhost:4717/',
                  statePath: '/state',
                  lanStateUrls: ['http://192.168.1.10:4717/state'],
                },
                mdns: { status: 'published' },
                devices: [
                  {
                    ip: '192.168.1.42',
                    userAgent: 'Tokpet-ESP32S3/1.0',
                    lastSeenAt: '2026-05-30T06:00:00.000Z',
                    pollCount: 2,
                    status: 'connected',
                  },
                ],
              });
            }
            return Promise.resolve({
              version: 1,
              fetchedAt: '2026-05-30T06:00:00.000Z',
              primary: {
                providerId: 'claude',
                windowId: '7d',
                usedPct: 26,
                mood: 'chill',
              },
              providers: [
                {
                  id: 'claude',
                  displayName: 'Claude',
                  mode: 'subscription',
                  result: {
                    mode: 'subscription',
                    fetchedAt: '2026-05-30T06:00:00.000Z',
                    source: 'live',
                    windows: [
                      { id: '5h', label: 'Past 5 hours', usedPct: 8 },
                      { id: '7d', label: 'Past 7 days', usedPct: 26 },
                    ],
                  },
                },
              ],
            });
          },
        }));

    new vm.Script(scriptFrom(html)).runInContext(context);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(elements.get('providerStatus')?.textContent).toBe('1 active');
    expect(elements.get('nowMetric')?.textContent).toBe('26%');
    expect(elements.get('nowLabel')?.textContent).toBe('Claude 7d');
    expect(elements.get('nowMood')?.textContent).toBe('chill');
    expect(elements.get('providersList')?.innerHTML).toContain('Claude');
    expect(elements.get('providersList')?.innerHTML).toContain('Remove');
    expect(elements.get('devicesList')?.innerHTML).toContain('192.168.1.42');
    expect(elements.get('networkList')?.innerHTML).toContain('192.168.1.10');
    expect(elements.get('stateJson')?.textContent).toContain('"version": 1');
  });

  it('keeps the remove action usable when deletion fails', async () => {
    const html = await readFile(pagePath, 'utf8');
    const { context, elements } = createConsoleContext((url: string) => {
      if (url === '/api/providers') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: 'claude', displayName: 'Claude', mode: 'subscription', available: true, activated: true },
            ]),
        });
      }
      if (url === '/api/runtime') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      if (url === '/state') return Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 1 }) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
    });

    new vm.Script(`${scriptFrom(html)}\nremoveProvider('claude');\nremoveSelectedProvider();`).runInContext(context);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(elements.get('removeConfirmBtn')?.disabled).toBe(false);
    expect(elements.get('removeConfirmBtn')?.textContent).toBe('Remove');
  });

  it('does not crash the dashboard on non-JSON local-service responses', async () => {
    const html = await readFile(pagePath, 'utf8');
    const { context, elements } = createConsoleContext((url: string) => {
      if (url === '/api/providers') {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify([
                { id: 'claude', displayName: 'Claude', mode: 'subscription', available: true, activated: true },
              ]),
            ),
        });
      }
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('temporary failure') });
    });

    new vm.Script(scriptFrom(html)).runInContext(context);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(elements.get('providerStatus')?.textContent).toBe('1 active');
    expect(elements.get('stateStatus')?.textContent).toBe('Unavailable');
  });
});
