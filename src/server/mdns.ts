// SPDX-License-Identifier: Apache-2.0

import Bonjour from 'bonjour-service';

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

export function publishMdns(port: number): MdnsAdvertisement {
  const bonjour = new Bonjour();
  bonjour.publish({
    name: 'Tokpet Companion',
    type: 'tokpet',
    protocol: 'tcp',
    port,
    txt: {
      path: '/state',
      protocol: '1',
    },
  });

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        bonjour.destroy(resolve);
      }),
  };
}
