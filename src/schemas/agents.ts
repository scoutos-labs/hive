import { z } from 'zod';

// ACP capabilities enum
const acpCapabilitySchema = z.enum(['progress', 'clarification', 'artifacts', 'mentions', 'webhook']);

// ACP configuration schema
const acpConfigSchema = z.object({
  protocol: z.enum(['acp/1.0', 'legacy']).default('acp/1.0'),
  capabilities: z.array(acpCapabilitySchema).optional(),
  clarifySupport: z.boolean().optional(),
  maxClarificationRounds: z.number().int().min(0).max(10).optional(),
  progressIntervalMs: z.number().int().min(100).optional(),
});

export const createAgentSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  acp: acpConfigSchema.optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  acp: acpConfigSchema.optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const registerAgentSchema = createAgentSchema;
export type RegisterAgentInput = CreateAgentInput;
