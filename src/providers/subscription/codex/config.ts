// SPDX-License-Identifier: Apache-2.0
//
// User-facing configuration schema for the Codex subscription provider.
// The provider reuses the local Codex CLI login state (~/.codex/auth.json),
// so the only knob is an enabled flag.

import { z } from 'zod';

export const codexConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export type CodexConfig = z.infer<typeof codexConfigSchema>;
