// SPDX-License-Identifier: Apache-2.0
//
// User-facing configuration schema for the Claude subscription provider.
// The provider reuses Claude Code's OAuth login state, so the only knob is
// an enabled flag.

import { z } from 'zod';

export const claudeConfigSchema = z.object({
  enabled: z.boolean().default(true),
});

export type ClaudeConfig = z.infer<typeof claudeConfigSchema>;
