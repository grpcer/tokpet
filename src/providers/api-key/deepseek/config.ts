// SPDX-License-Identifier: Apache-2.0
//
// User-facing configuration schema for the DeepSeek api-key provider.
// DeepSeek issues a standard bearer key the user pastes from
// platform.deepseek.com. `baseUrl` is exposed for self-hosted / proxy setups.

import { z } from 'zod';

export const deepseekConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default('https://api.deepseek.com'),
});

export type DeepseekConfig = z.infer<typeof deepseekConfigSchema>;
