// SPDX-License-Identifier: Apache-2.0

import { networkInterfaces } from 'node:os';
import type { IncomingMessage } from 'node:http';

const DEVICE_CONNECTED_MS = 90_000;
const DEVICE_RECENT_MS = 180_000;

export interface DevicePoll {
  readonly ip: string;
  userAgent?: string;
  lastSeenAt: Date;
  pollCount: number;
}

export interface RuntimeState {
  readonly startedAt: Date;
  readonly port: number;
  readonly mdns: {
    readonly service: '_tokpet._tcp.local';
    readonly port: number;
    readonly path: '/state';
    readonly protocol: '1';
    status: 'published' | 'unknown';
  };
  readonly devices: DevicePoll[];
}

export function createRuntimeState(port: number): RuntimeState {
  return {
    startedAt: new Date(),
    port,
    mdns: {
      service: '_tokpet._tcp.local',
      port,
      path: '/state',
      protocol: '1',
      status: 'unknown',
    },
    devices: [],
  };
}

export function markMdnsPublished(runtime: RuntimeState) {
  runtime.mdns.status = 'published';
}

function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function recordStatePoll(runtime: RuntimeState, req: IncomingMessage, now = new Date()) {
  const ip = normalizeIp(req.socket.remoteAddress);
  if (!ip || isLoopback(ip)) return;

  const userAgentHeader = req.headers['user-agent'];
  const userAgent = typeof userAgentHeader === 'string' ? userAgentHeader : undefined;
  const existing = runtime.devices.find((device) => device.ip === ip);
  if (existing) {
    existing.userAgent = userAgent;
    existing.lastSeenAt = now;
    existing.pollCount += 1;
    return;
  }

  runtime.devices.push({
    ip,
    userAgent,
    lastSeenAt: now,
    pollCount: 1,
  });
}

export function deviceStatus(
  device: DevicePoll,
  now = new Date(),
): 'connected' | 'recent' | 'offline' {
  const age = now.getTime() - device.lastSeenAt.getTime();
  if (age <= DEVICE_CONNECTED_MS) return 'connected';
  if (age <= DEVICE_RECENT_MS) return 'recent';
  return 'offline';
}

export function lanStateUrls(port: number): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      urls.push(`http://${entry.address}:${port}/state`);
    }
  }
  return urls.sort();
}
