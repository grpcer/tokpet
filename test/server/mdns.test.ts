// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('bonjour-service', () => {
  class Bonjour {
    static lastInstance: Bonjour | undefined;
    published: unknown[] = [];
    publishedService: EventEmitter | undefined;
    destroyed = false;

    constructor() {
      Bonjour.lastInstance = this;
    }

    publish(config: unknown) {
      this.published.push(config);
      this.publishedService = new EventEmitter();
      return this.publishedService;
    }

    destroy(callback: () => void) {
      this.destroyed = true;
      callback();
    }
  }

  return { default: Bonjour };
});

describe('publishMdns', () => {
  it('publishes the Tokpet companion service with /state metadata', async () => {
    const mod = await import('../../src/server/mdns.js');
    const Bonjour = (await import('bonjour-service')).default as unknown as {
      lastInstance?: { published: unknown[]; destroyed: boolean };
    };

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
    const Bonjour = (await import('bonjour-service')).default as unknown as {
      lastInstance?: { published: unknown[]; publishedService?: EventEmitter };
    };
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
});
