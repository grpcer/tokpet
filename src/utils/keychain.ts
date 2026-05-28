// SPDX-License-Identifier: Apache-2.0
//
// macOS Keychain accessor. Darwin only; other platforms must read
// credentials from disk in their own provider implementations.

import { spawn } from 'node:child_process';

/**
 * Read the plain-text payload of a generic-password keychain item.
 * @param service Keychain service name, e.g. `'Claude Code-credentials'`.
 */
export async function readKeychainItem(service: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('security', ['find-generic-password', '-s', service, '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    ps.stdout.on('data', (b: Buffer) => (out += b.toString()));
    ps.stderr.on('data', (b: Buffer) => (err += b.toString()));
    ps.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`security exit ${code ?? '?'}: ${err.trim()}`));
    });
    ps.on('error', reject);
  });
}
