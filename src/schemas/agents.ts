import { z } from 'zod';

export const createAgentSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const registerAgentSchema = createAgentSchema;
export type RegisterAgentInput = CreateAgentInput;
