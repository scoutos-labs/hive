import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  createdBy: z.string().min(1),
  isPrivate: z.boolean().optional().default(false),
  cwd: z.string().optional(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  cwd: z.string().optional(),
  isPrivate: z.boolean().optional(),
  members: z.array(z.string()).optional(),
});

export const channelErrorsQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional().default(0),
  limit: z.coerce.number().int().positive().max(500).optional().default(50),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type ChannelErrorsQueryInput = z.infer<typeof channelErrorsQuerySchema>;
