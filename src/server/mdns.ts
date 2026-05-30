// SPDX-License-Identifier: Apache-2.0

import Bonjour from 'bonjour-service';

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

export interface MdnsOptions {
  onStatus?: (status: 'published') => void;
}

export function publishMdns(port: number, options: MdnsOptions = {}): MdnsAdvertisement {
  const bonjour = new Bonjour();
  const service = bonjour.publish({
    name: `Tokpet Companion ${port}`,
    type: 'tokpet',
    protocol: 'tcp',
    port,
    txt: {
      path: '/state',
      protocol: '1',
    },
  });
  service.on('up', () => options.onStatus?.('published'));

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        bonjour.destroy(resolve);
      }),
  };
}
