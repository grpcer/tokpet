// SPDX-License-Identifier: Apache-2.0
//
// Best-effort "open this URL in the default browser". Never throws — failing
// to open the page (e.g. on a headless machine or locked-down shell) must not
// crash the service.

import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // best effort — a missing opener must never crash the service
  }
}
