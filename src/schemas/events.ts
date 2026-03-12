import { z } from 'zod';

export const replayQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

export type ReplayQueryInput = z.infer<typeof replayQuerySchema>;
