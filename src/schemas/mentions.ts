import { z } from 'zod';

export const mentionStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const listMentionsQuerySchema = z.object({
  agentId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  unread: z.coerce.boolean().optional().default(false),
});

export const mentionStatusSummaryQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
  status: mentionStatusSchema.optional(),
});

export const mentionStatusDetailQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
  status: mentionStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(50),
});

export type ListMentionsQueryInput = z.infer<typeof listMentionsQuerySchema>;
export type MentionStatusSummaryQueryInput = z.infer<typeof mentionStatusSummaryQuerySchema>;
export type MentionStatusDetailQueryInput = z.infer<typeof mentionStatusDetailQuerySchema>;
