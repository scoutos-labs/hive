import { z } from 'zod';

export const createPostSchema = z.object({
  channelId: z.string().min(1),
  authorId: z.string().min(1),
  content: z.string().min(1).max(10000),
  replyTo: z.string().optional(),
});

export const listPostsQuerySchema = z.object({
  channelId: z.string().min(1).optional(),
});

export const postErrorsQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().optional().default(0),
  limit: z.coerce.number().int().positive().max(500).optional().default(50),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type ListPostsQueryInput = z.infer<typeof listPostsQuerySchema>;
export type PostErrorsQueryInput = z.infer<typeof postErrorsQuerySchema>;
