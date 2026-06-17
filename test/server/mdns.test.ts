// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const osState = vi.hoisted(
  (): {
    interfaces: Record<string, Array<{ family: string; internal: boolean; address: string }>>;
  } => ({ interfaces: {} }),
);

vi.mock('node:os', () => ({
  networkInterfaces: () => osState.interfaces,
}));

vi.mock('bonjour-service', () => {
  class Bonjour {
    static instances: Bonjour[] = [];
    static get lastInstance(): Bonjour | undefined {
      return Bonjour.instances[Bonjour.instances.length - 1];
    }
    published: unknown[] = [];
    publishedService: EventEmitter | undefined;
    destroyed = false;

    constructor() {
      Bonjour.instances.push(this);
    }

    publish(config: unknown) {
      this.published.push(config);
      this.publishedService = new EventEmitter();
      return this.publishedService;
    }

    destroy(callback?: () => void) {
      this.destroyed = true;
      callback?.();
    }
  }

  return { default: Bonjour };
});

type MockInstance = { published: unknown[]; publishedService?: EventEmitter; destroyed: boolean };
type MockBonjour = { instances: MockInstance[]; lastInstance?: MockInstance };

async function getBonjour(): Promise<MockBonjour> {
  return (await import('bonjour-service')).default as unknown as MockBonjour;
}

beforeEach(async () => {
  vi.useRealTimers();
  osState.interfaces = {};
  (await getBonjour()).instances.length = 0;
});

describe('publishMdns', () => {
  it('publishes the Tokpet companion service with /state metadata', async () => {
    const mod = await import('../../src/server/mdns.js');
    const Bonjour = await getBonjour();

    const advertisement = mod.publishMdns(4717);

    expect(Bonjour.lastInstance?.published[0]).toEqual({
      name: 'Tokpet Companion 4717',
      type: 'tokpet',
      protocol: 'tcp',
      port: 4717,
      txt: {
        path: '/state',
        protocol: '1',
      },
    });

    await advertisement.stop();
    expect(Bonjour.lastInstance?.destroyed).toBe(true);
  });

  it('reports published only after the mDNS service emits up', async () => {
    const mod = await import('../../src/server/mdns.js');
    const Bonjour = await getBonjour();
    const statuses: string[] = [];

    const advertisement = mod.publishMdns(4717, {
      onStatus: (status) => statuses.push(status),
    });
    const service = Bonjour.lastInstance?.publishedService;

    expect(statuses).toEqual([]);
    service?.emit('up');
    expect(statuses).toEqual(['published']);
    await advertisement.stop();
  });

  it('re-publishes on a fresh instance when the LAN IP changes', async () => {
    vi.useFakeTimers();
    osState.interfaces = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] };

    const mod = await import('../../src/server/mdns.js');
    const Bonjour = await getBonjour();

    const advertisement = mod.publishMdns(4717);
    expect(Bonjour.instances).toHaveLength(1);

    // No address change → no re-publish.
    vi.advanceTimersByTime(5000);
    expect(Bonjour.instances).toHaveLength(1);

    // Address changes → old instance is torn down, a fresh one re-announces.
    osState.interfaces = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] };
    vi.advanceTimersByTime(5000);
    expect(Bonjour.instances).toHaveLength(2);
    expect(Bonjour.instances[0]?.destroyed).toBe(true);
    expect(Bonjour.instances[1]?.published).toHaveLength(1);

    vi.useRealTimers();
    await advertisement.stop();
  });
});
