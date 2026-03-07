/**
 * Hive - Agent Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { db, agentKey, agentsListKey, addToSet, removeFromSet, getList } from '../db/index.js';
import type { Agent, RegisterAgentBody, ApiResponse, PaginatedResponse } from '../types.js';
import { checkCommandAllowed, validateSpawnArgs } from '../services/spawn-allowlist.js';

export const agentsRouter = new Hono();

// Validation schemas
const registerAgentSchema = z.object({
  id: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  spawnCommand: z.string().min(1).optional(),
  spawnArgs: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

// POST /agents - Register a new agent
agentsRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const validated = registerAgentSchema.parse(body);
    
    // Validate spawn command against allowlist if provided.
    if (validated.spawnCommand !== undefined) {
      const cmdCheck = checkCommandAllowed(validated.spawnCommand);
      if (!cmdCheck.allowed) {
        return c.json<ApiResponse<never>>(
          { success: false, error: cmdCheck.reason ?? 'spawnCommand not allowed' },
          422
        );
      }
    }

    // Validate spawn args
    const argsError = validateSpawnArgs(validated.spawnArgs ?? []);
    if (argsError) {
      return c.json<ApiResponse<never>>({ success: false, error: argsError }, 422);
    }

    // Check if agent already exists
    const existing = db.get(agentKey(validated.id));
    if (existing) {
      return c.json<ApiResponse<never>>(
        { success: false, error: 'Agent already exists with this ID' },
        409
      );
    }
    
    const now = Date.now();
    
    const agent: Agent = {
      id: validated.id,
      name: validated.name,
      description: validated.description,
      spawnCommand: validated.spawnCommand,
      spawnArgs: validated.spawnArgs,
      cwd: validated.cwd,
      capabilities: validated.capabilities,
      createdAt: now,
      updatedAt: now,
    };
    
    await db.put(agentKey(validated.id), agent);
    await addToSet(agentsListKey(), validated.id);
    
    // Return the format specified in the task
    return c.json({
      id: agent.id,
      name: agent.name,
      registeredAt: agent.createdAt,
    }, 201);
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// GET /agents - List all agents
agentsRouter.get('/', async (c) => {
  const agentIds = await getList<string>(agentsListKey());
  const agents: Agent[] = [];
  
  for (const id of agentIds) {
    const agent = db.get(agentKey(id));
    if (agent) agents.push(agent);
  }
  
  return c.json({ agents, count: agents.length });
});

// GET /agents/:id - Get a specific agent
agentsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const agent = db.get(agentKey(id));
  
  if (!agent) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Agent not found' }, 404);
  }
  
  return c.json(agent);
});

// PUT /agents/:id - Update an agent profile
agentsRouter.put('/:id', async (c) => {
  try {
    const { id } = c.req.param();
    const agent = db.get(agentKey(id));
    
    if (!agent) {
      return c.json<ApiResponse<never>>({ success: false, error: 'Agent not found' }, 404);
    }
    
    const body = await c.req.json();
    const validated = updateAgentSchema.parse(body);

    // Validate new spawn command if provided
    if (validated.spawnCommand !== undefined) {
      const cmdCheck = checkCommandAllowed(validated.spawnCommand);
      if (!cmdCheck.allowed) {
        return c.json<ApiResponse<never>>(
          { success: false, error: cmdCheck.reason ?? 'spawnCommand not allowed' },
          422
        );
      }
    }

    // Validate new spawn args if provided
    if (validated.spawnArgs !== undefined) {
      const argsError = validateSpawnArgs(validated.spawnArgs);
      if (argsError) {
        return c.json<ApiResponse<never>>({ success: false, error: argsError }, 422);
      }
    }

    const updatedAt = Date.now();
    const updated: Agent = {
      ...agent,
      ...validated,
      id, // Ensure id cannot be changed
      createdAt: agent.createdAt, // Preserve createdAt
      updatedAt,
    };
    
    await db.put(agentKey(id), updated);
    
    return c.json(updated);
  } catch (error) {
    return c.json<ApiResponse<never>>(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});

// DELETE /agents/:id - Delete/unregister an agent
agentsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const agent = db.get(agentKey(id));
  
  if (!agent) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Agent not found' }, 404);
  }
  
  await db.remove(agentKey(id));
  await removeFromSet(agentsListKey(), id);
  
  return c.json({ success: true, id });
});

export default agentsRouter;
