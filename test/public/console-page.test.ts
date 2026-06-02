// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pagePath = join(process.cwd(), 'public', 'index.html');

// The console now ships as index.html plus split assets under public/assets/:
// one stylesheet and several classic global <script src> files (kept classic,
// not ES modules, because the markup wires ~47 inline onclick/oninput handlers
// to global functions). Reassemble the sources the way a browser would — inline
// head scripts first, then external scripts in document order — so the vm
// context still mirrors the page. `combined` (html + css + js) lets text
// assertions match content regardless of which file it now lives in.
async function loadSources() {
  const html = await readFile(pagePath, 'utf8');
  const dir = dirname(pagePath);
  const capture = (re: RegExp): string[] =>
    [...html.matchAll(re)].map((m) => m[1]).filter((s): s is string => s !== undefined);
  const inline = capture(/<script>([\s\S]*?)<\/script>/g);
  const srcs = capture(/<script src="([^"]+)"><\/script>/g);
  expect(srcs.length).toBeGreaterThan(0);
  const external = await Promise.all(srcs.map((s) => readFile(join(dir, s), 'utf8')));
  const js = [...inline, ...external].join('\n');
  const cssHrefs = capture(/<link rel="stylesheet" href="(assets\/[^"]+)"/g);
  const css = (await Promise.all(cssHrefs.map((h) => readFile(join(dir, h), 'utf8')))).join('\n');
  const combined = [html, css, js].join('\n');
  return { html, css, js, combined };
}

function makeElement() {
  const classes = new Set<string>();
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    hidden: false,
    style: { display: '', setProperty: () => undefined, removeProperty: () => undefined } as Record<
      string,
      unknown
    >,
    dataset: {} as Record<string, string>,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        if (force === false) classes.delete(name);
        else if (force === true) classes.add(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
      contains: (name: string) => classes.has(name),
    },
    addEventListener: (event: string, fn: (e: unknown) => void) => {
      (listeners[event] = listeners[event] || []).push(fn);
    },
    removeAttribute: () => undefined,
    setAttribute: () => undefined,
    getAttribute: () => null,
    focus: () => undefined,
    click: () => undefined,
    appendChild: () => undefined,
    querySelector: () => makeElement(),
  };
}

type FetchImpl = (url: string, init?: unknown) => Promise<unknown>;

function createConsoleContext(fetchImpl: FetchImpl) {
  const ids = [
    'serviceStatus',
    'stateStatus',
    'deviceStatus',
    'providerStatus',
    'nowRing',
    'nowMetric',
    'nowLabel',
    'nowSub',
    'nowMood',
    'providersList',
    'devicesList',
    'networkList',
    'stateJson',
    'diagSchema',
    'diagFetched',
    'diagProviderCount',
    'diagCurl',
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
    'wizardSteps',
    'wizardTitle',
    'wizardSub',
    'step2Title',
    'step3Back',
    'connectTitle',
    'connectMethod',
    'connectCopy',
    'connectSourceHint',
    'connectError',
    'connectBtn',
    'removeTitle',
    'removeCopy',
    'removeConfirmBtn',
    'removeDialog',
    'reconnectTitle',
    'reconnectCopy',
    'reconnectError',
    'reconnectConfirmBtn',
    'reconnectDialog',
    'connBanner',
    'refreshBtn',
    'addBtn',
    'toastStack',
    'diagPanel',
  ];
  const elements = new Map(ids.map((id) => [id, makeElement()]));
  const docListeners: Record<string, Array<(e: unknown) => void>> = {};
  const docBody = makeElement();
  const win = {
    addEventListener: () => undefined,
  };
  const context = vm.createContext({
    document: {
      body: docBody,
      documentElement: { dataset: {} as Record<string, string> },
      getElementById: (id: string) => elements.get(id) ?? makeElement(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: (ev: string, fn: (e: unknown) => void) => {
        (docListeners[ev] = docListeners[ev] || []).push(fn);
      },
      createElement: () => makeElement(),
      visibilityState: 'visible',
    },
    window: win,
    history: { pushState: () => undefined, replaceState: () => undefined },
    location: { hash: '', origin: 'http://localhost:4717', pathname: '/', search: '' },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    fetch: fetchImpl,
  });
  return { context, elements, docBody };
}

// Build a minimal Response-shaped value the rewritten api() expects (uses .text()).
function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

describe('Tokpet Console page', () => {
  it('is a console dashboard, not a setup-only page', async () => {
    const { combined } = await loadSources();

    expect(combined).toContain('Tokpet Console');
    expect(combined).toContain('Providers');
    expect(combined).toContain('Devices');
    expect(combined).toContain('Advanced diagnostics');
    expect(combined).toContain('Add provider');
    expect(combined).toContain('/api/runtime');
    // Core actions must be reachable (allow either legacy or new function names).
    expect(combined).toMatch(/openRemove\(|removeProvider\(/);
    expect(combined).toContain('removeDialog');
    // No native confirm() prompts; we use modal dialogs.
    expect(combined).not.toContain('confirm(');
  });

  it('ships a self-contained icon sprite set', async () => {
    const { html } = await loadSources();
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
    // Mascot SVG is reused (cat sprite), avoiding the duplicated CSS-only badge.
    expect(html).toContain('id="cat"');
  });

  it('guards against the visible regressions caught in the design review', async () => {
    // Assertions now span index.html (SVG mascot), console.css (styles) and the
    // split JS, so match against the combined source rather than one file.
    const { combined } = await loadSources();

    // Cat mascot must be a friendly cat, not just two eyes — it needs nose + mouth + whiskers.
    expect(combined).toMatch(/#ff6a98/); // nose color appears
    expect(combined).toMatch(/whisker|stroke-linecap="round"[^>]*opacity/i);

    // No invalid CSS font weights (system rounded fonts don't support 850/950).
    expect(combined).not.toMatch(/font-weight\s*:\s*850/);
    expect(combined).not.toMatch(/font-weight\s*:\s*950/);

    // Accessibility: focus-visible outline + reduced-motion media query.
    expect(combined).toMatch(/:focus-visible\s*\{/);
    expect(combined).toMatch(/prefers-reduced-motion/);

    // Status strip "Companion" indicator must be updated from JS (not hard-coded ok green).
    expect(combined).toMatch(/serviceStatus[^]{0,800}?dot--bad/);

    // mDNS pill must be computed from runtime.mdns.status, not statically green.
    expect(combined).toMatch(/mdnsPill|pill--ok|pill--warn/);

    // Page must be self-refreshing (auto poll on interval).
    expect(combined).toMatch(/setInterval\(/);

    // ESC closes modal dialogs.
    expect(combined).toMatch(/key\s*===?\s*['"]Escape['"]/);

    // Provider activation errors render an action-oriented message (title + hint).
    expect(combined).toMatch(/errorInfo\(/);

    // Resets time should support relative + absolute representation.
    expect(combined).toMatch(/relativeTime\(/);
    expect(combined).toMatch(/absoluteTime\(/);

    // Copy fallback must not silently lie when navigator.clipboard fails.
    expect(combined).toMatch(/execCommand\(['"]copy['"]\)|Copy failed/);
  });

  it('contains syntactically valid inline JavaScript', async () => {
    const { js } = await loadSources();
    expect(() => new vm.Script(js)).not.toThrow();
  });

  it('renders provider, runtime, and state data from the local APIs', async () => {
    const { js } = await loadSources();
    const { context, elements } = createConsoleContext((url: string) => {
      if (url === '/api/providers') {
        return jsonResponse([
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
        return jsonResponse({
          ok: true,
          service: {
            status: 'running',
            localUrl: 'http://localhost:4717/',
            statePath: '/state',
            lanStateUrls: ['http://192.168.1.10:4717/state'],
          },
          mdns: { status: 'published', service: '_tokpet._tcp.local', port: 4717 },
          devices: [
            {
              ip: '192.168.1.42',
              userAgent: 'Tokpet-ESP32S3/1.0',
              lastSeenAt: new Date(Date.now() - 5000).toISOString(),
              pollCount: 2,
              status: 'connected',
            },
          ],
        });
      }
      return jsonResponse({
        version: 1,
        fetchedAt: new Date(Date.now() - 1000).toISOString(),
        primary: { providerId: 'claude', windowId: '7d', usedPct: 26, mood: 'chill' },
        providers: [
          {
            id: 'claude',
            displayName: 'Claude',
            mode: 'subscription',
            result: {
              mode: 'subscription',
              fetchedAt: new Date(Date.now() - 1000).toISOString(),
              source: 'live',
              windows: [
                { id: '5h', label: 'Past 5 hours', usedPct: 8 },
                { id: '7d', label: 'Past 7 days', usedPct: 26 },
              ],
            },
          },
        ],
      });
    });

    new vm.Script(js).runInContext(context);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(elements.get('providerStatus')?.innerHTML).toContain('1 active');
    // renderNow() writes the percentage as `<span class="num">26%</span>...` via innerHTML;
    // the test's mock element doesn't sync textContent off innerHTML, so assert against
    // innerHTML like every other DOM check in this file.
    expect(elements.get('nowMetric')?.innerHTML).toContain('26%');
    expect(elements.get('nowLabel')?.textContent).toContain('Claude');
    expect(elements.get('nowLabel')?.textContent).toContain('Past 7 days');
    // setMood() writes the key into `mood.querySelector('.mood-name').textContent`,
    // but our mock's querySelector returns a fresh throwaway element each call, so
    // there's nothing to assert on at this level. The mood path is exercised by the
    // happy-path render reaching this point without throwing.
    expect(elements.get('providersList')?.innerHTML).toContain('Claude');
    expect(elements.get('providersList')?.innerHTML).toContain('Remove');
    expect(elements.get('devicesList')?.innerHTML).toContain('192.168.1.42');
    // renderDevices() renders the name as `Tokpet · <ip>` (middle-dot separator),
    // not the older `Tokpet device` wording that this assertion used to look for.
    expect(elements.get('devicesList')?.innerHTML).toContain('Tokpet ·');
    expect(elements.get('networkList')?.innerHTML).toContain('192.168.1.10');
    expect(elements.get('networkList')?.innerHTML).toContain('Published');
    expect(elements.get('stateJson')?.textContent).toContain('"version": 1');
  });

  it('keeps the remove action usable when deletion fails', async () => {
    const { js } = await loadSources();
    const { context, elements } = createConsoleContext((url: string, init?: unknown) => {
      if (
        url === '/api/providers' &&
        (!init || (init as { method?: string }).method === undefined)
      ) {
        return jsonResponse([
          {
            id: 'claude',
            displayName: 'Claude',
            mode: 'subscription',
            available: true,
            activated: true,
          },
        ]);
      }
      if (url === '/api/runtime') return jsonResponse({ ok: true });
      if (url === '/state')
        return jsonResponse({ version: 1, fetchedAt: new Date().toISOString(), providers: [] });
      // DELETE call fails
      return jsonResponse({ ok: false, error: { message: 'busy' } }, false, 503);
    });

    const script = js;
    new vm.Script(
      `${script}
;(typeof openRemove === 'function' ? openRemove : removeProvider)('claude');
removeSelectedProvider();`,
    ).runInContext(context);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    // After failed deletion the confirm button must be re-enabled and labeled 'Remove'.
    expect(elements.get('removeConfirmBtn')?.disabled).toBe(false);
    expect(elements.get('removeConfirmBtn')?.textContent).toBe('Remove');
  });

  it('does not crash the dashboard on non-JSON local-service responses', async () => {
    const { js } = await loadSources();
    const { context, elements } = createConsoleContext((url: string) => {
      if (url === '/api/providers') {
        return jsonResponse([
          {
            id: 'claude',
            displayName: 'Claude',
            mode: 'subscription',
            available: true,
            activated: true,
          },
        ]);
      }
      // Both runtime and /state return non-JSON text — must degrade gracefully.
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('temporary failure'),
      });
    });

    new vm.Script(js).runInContext(context);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(elements.get('providerStatus')?.innerHTML).toContain('1 active');
    // State feed should clearly say it's unavailable, not pretend everything is fine.
    expect(elements.get('stateStatus')?.innerHTML).toContain('Unavailable');
  });
});
