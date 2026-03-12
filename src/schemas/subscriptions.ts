import { z } from 'zod';

const subscriptionTargetTypeSchema = z.enum(['channel', 'agent', 'mention']);

export const createSubscriptionSchema = z.object({
  agentId: z.string().min(1),
  targetType: subscriptionTargetTypeSchema,
  targetId: z.string().min(1),
});

export const listSubscriptionsQuerySchema = z
  .object({
    agentId: z.string().min(1).optional(),
    targetType: subscriptionTargetTypeSchema.optional(),
    targetId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasTargetType = typeof value.targetType === 'string';
    const hasTargetId = typeof value.targetId === 'string';

    if (hasTargetType !== hasTargetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasTargetType ? ['targetId'] : ['targetType'],
        message: 'targetType and targetId must be provided together',
      });
    }
  });

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type ListSubscriptionsQueryInput = z.infer<typeof listSubscriptionsQuerySchema>;
