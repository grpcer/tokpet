// SPDX-License-Identifier: Apache-2.0
//
// Provider registry. Adding a new vendor requires only one import + one
// entry below; the aggregator, server, and configuration layers all consume
// providers through this list.

import type { Provider } from '../protocol/provider.js';
import { deepseekProvider } from './api-key/deepseek/index.js';
import { claudeProvider } from './subscription/claude/index.js';

export const ALL_PROVIDERS: readonly Provider[] = [
  claudeProvider,
  deepseekProvider,
  // Planned slots:
  //   subscription:  codex, openai-plus, cursor, windsurf, …
  //   api-key:       anthropic-api, openai-api, gemini-api, …
  //   relay:         openrouter, together, keyai, …
];

export function findProvider(id: string): Provider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}
