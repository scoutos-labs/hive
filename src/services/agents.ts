/**
 * Hive - Agent Service
 */

import { 
  db, 
  agentKey, 
  agentsListKey, 
  addToSet, 
  removeFromSet, 
  getList 
} from '../db/index.js';
import type { Agent, RegisterAgentBody } from '../types.js';

// ============================================================================
// Agent Operations
// ============================================================================

/**
 * Register a new agent
 */
export async function registerAgent(data: RegisterAgentBody): Promise<Agent> {
  const now = Date.now();
  
  const agent: Agent = {
    id: data.id,
    name: data.name,
    description: data.description,
    spawnCommand: data.spawnCommand,
    spawnArgs: data.spawnArgs,
    cwd: data.cwd,
    capabilities: data.capabilities,
    createdAt: now,
    updatedAt: now,
  };

  await db.put(agentKey(data.id), agent);
  await addToSet(agentsListKey(), data.id);

  return agent;
}

/**
 * Get an agent by ID
 */
export async function getAgent(id: string): Promise<Agent | null> {
  const agent = await db.get(agentKey(id));
  return agent || null;
}

/**
 * List all agents
 */
export async function listAgents(): Promise<Agent[]> {
  const agentIds = await getList<string>(agentsListKey());
  const agents: Agent[] = [];

  for (const id of agentIds) {
    const agent = await db.get(agentKey(id));
    if (agent) {
      agents.push(agent);
    }
  }

  return agents.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Update an agent
 */
export async function updateAgent(id: string, data: Partial<Agent>): Promise<Agent | null> {
  const agent = await getAgent(id);
  if (!agent) return null;

  const updated: Agent = {
    ...agent,
    ...data,
    id, // Ensure id cannot be changed
    createdAt: agent.createdAt, // Preserve createdAt
    updatedAt: Date.now(),
  };

  await db.put(agentKey(id), updated);
  return updated;
}

/**
 * Delete/unregister an agent
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const agent = await getAgent(id);
  if (!agent) return false;

  await db.remove(agentKey(id));
  await removeFromSet(agentsListKey(), id);

  return true;
}

/**
 * Update agent's last active timestamp
 */
export async function touchAgent(id: string): Promise<void> {
  const agent = await getAgent(id);
  if (agent) {
    agent.lastActiveAt = Date.now();
    agent.updatedAt = Date.now();
    await db.put(agentKey(id), agent);
  }
}