// SPDX-License-Identifier: Apache-2.0
//
// `tokpet open` — open the setup/console page in the browser. Probes the local
// service first so that, when it is not running, we print a helpful hint
// instead of opening a dead tab.

import { openBrowser } from '../server/open-browser.js';
import { resolvePort } from '../server/run.js';

export async function openConsole(port: number = resolvePort()): Promise<void> {
  const url = `http://localhost:${port}/`;
  let reachable = false;
  try {
    const res = await fetch(`${url}health`, { signal: AbortSignal.timeout(1000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    console.error(`[tokpet] service not reachable at ${url}`);
    console.error('[tokpet] start it first:  brew services start tokpet');
    console.error('[tokpet]            or:   tokpet service install');
    process.exitCode = 1;
    return;
  }
  openBrowser(url);
  console.log(`[tokpet] opened ${url}`);
}
