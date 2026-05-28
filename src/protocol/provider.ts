// SPDX-License-Identifier: Apache-2.0
//
// Provider interface — every vendor integration implements this.
//
// To add a new provider:
//   1. Create `src/providers/<mode>/<id>/` directory.
//   2. Copy the matching template from `src/providers/_template/`.
//   3. Implement the three methods + `configSchema`.
//   4. Import and append to `ALL_PROVIDERS` in `src/providers/registry.ts`.
//
// No other file should need to change.

import type { ZodTypeAny } from 'zod';
import type { ProviderMode, UsageResult } from './usage.js';

/** Per-call context, used for cancellation and logging. */
export interface FetchContext {
  readonly signal: AbortSignal;
  readonly logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface Provider<M extends ProviderMode = ProviderMode> {
  /** Unique id, lowercase-kebab. Examples: 'claude', 'openai-api', 'openrouter'. */
  readonly id: string;

  /** Human-readable name. Examples: 'Claude', 'OpenAI API'. */
  readonly displayName: string;

  /** Access mode. Determines which Usage variant the provider returns. */
  readonly mode: M;

  /** Zod schema describing user-facing configuration. Drives forms + validation. */
  readonly configSchema: ZodTypeAny;

  /** Whether configuration + credentials are currently usable. */
  isReady(config: unknown): Promise<boolean>;

  /** Fetch usage. Return a UsageError on failure rather than throwing. */
  fetch(config: unknown, ctx: FetchContext): Promise<UsageResult>;
}
