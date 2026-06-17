// SPDX-License-Identifier: Apache-2.0

import { networkInterfaces } from 'node:os';
import Bonjour from 'bonjour-service';

export interface MdnsAdvertisement {
  stop(): Promise<void>;
}

export interface MdnsOptions {
  onStatus?: (status: 'published') => void;
}

// How often to check whether this machine's LAN address changed.
const REPUBLISH_POLL_MS = 5000;

// A stable signature of the non-internal LAN IPv4 addresses. When it changes
// (Wi-Fi roam, DHCP renew, moving between networks) the existing advertisement
// points at a stale address, so we re-announce. Mirrors the interface filter in
// runtime.ts `lanStateUrls`.
function lanIpv4Signature(): string {
  const ips: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      ips.push(entry.address);
    }
  }
  return ips.sort().join(',');
}

export function publishMdns(port: number, options: MdnsOptions = {}): MdnsAdvertisement {
  let bonjour = new Bonjour();
  let signature = '';

  const publish = () => {
    signature = lanIpv4Signature();
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
  };

  publish();

  // bonjour-service does not re-announce when the host's address changes, so a
  // device that discovered us over mDNS keeps resolving the stale IP and its
  // /state poll fails ("companion unreachable"). Poll for address changes and
  // re-publish on a fresh instance so the advertisement tracks the current LAN.
  const timer = setInterval(() => {
    if (lanIpv4Signature() === signature) return;
    bonjour.destroy(() => {});
    bonjour = new Bonjour();
    publish();
  }, REPUBLISH_POLL_MS);
  timer.unref();

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer);
        bonjour.destroy(resolve);
      }),
  };
}
