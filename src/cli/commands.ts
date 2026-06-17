// SPDX-License-Identifier: Apache-2.0
//
// Maps argv into a single command token. Pure and side-effect free so the
// dispatcher in index.ts stays a thin shell and routing is unit-testable.

export type Command =
  | { kind: 'start' }
  | { kind: 'open' }
  | { kind: 'service'; action: 'install' | 'uninstall' | 'status' }
  | { kind: 'version' }
  | { kind: 'help'; error?: string };

export function resolveCommand(argv: readonly string[]): Command {
  const [first, second] = argv;
  if (first === undefined || first === 'start') return { kind: 'start' };
  if (first === 'open') return { kind: 'open' };
  if (first === '--version' || first === '-v') return { kind: 'version' };
  if (first === '--help' || first === '-h' || first === 'help') return { kind: 'help' };
  if (first === 'service') {
    if (second === 'install' || second === 'uninstall' || second === 'status') {
      return { kind: 'service', action: second };
    }
    return { kind: 'help', error: `unknown service action: ${second ?? '(none)'}` };
  }
  return { kind: 'help', error: `unknown command: ${first}` };
}
