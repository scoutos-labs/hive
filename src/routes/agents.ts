/**
 * Hive - Agent Routes
 */

import { Hono } from 'hono';
import { db, agentKey, agentsListKey, addToSet, removeFromSet, getList } from '../db/index.js';
import { getValidatedBody, validateBody } from '../middleware/validate.js';
import { createAgentSchema, updateAgentSchema, type CreateAgentInput, type UpdateAgentInput } from '../schemas/agents.js';
import type { Agent, ApiResponse } from '../types.js';
import { checkCommandAllowed, validateSpawnArgs } from '../services/spawn-allowlist.js';

export const agentsRouter = new Hono();

// POST /agents - Register a new agent
agentsRouter.post('/', validateBody(createAgentSchema), async (c) => {
  const validated = getValidatedBody<CreateAgentInput>(c);

  if (validated.spawnCommand !== undefined) {
    const cmdCheck = checkCommandAllowed(validated.spawnCommand);
    if (!cmdCheck.allowed) {
      return c.json<ApiResponse<never>>(
        { success: false, error: cmdCheck.reason ?? 'spawnCommand not allowed' },
        422
      );
    }
  }

  const argsError = validateSpawnArgs(validated.spawnArgs ?? []);
  if (argsError) {
    return c.json<ApiResponse<never>>({ success: false, error: argsError }, 422);
  }

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
    acp: validated.acp,
    createdAt: now,
    updatedAt: now,
  };

  await db.put(agentKey(validated.id), agent);
  await addToSet(agentsListKey(), validated.id);

  return c.json({
    id: agent.id,
    name: agent.name,
    registeredAt: agent.createdAt,
    acp: agent.acp,
  }, 201);
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
agentsRouter.put('/:id', validateBody(updateAgentSchema), async (c) => {
  const { id } = c.req.param();
  const agent = db.get(agentKey(id));

  if (!agent) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Agent not found' }, 404);
  }

  const validated = getValidatedBody<UpdateAgentInput>(c);

  if (validated.spawnCommand !== undefined) {
    const cmdCheck = checkCommandAllowed(validated.spawnCommand);
    if (!cmdCheck.allowed) {
      return c.json<ApiResponse<never>>(
        { success: false, error: cmdCheck.reason ?? 'spawnCommand not allowed' },
        422
      );
    }
  }

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
    id,
    createdAt: agent.createdAt,
    updatedAt,
  };

  await db.put(agentKey(id), updated);

  return c.json(updated);
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
