/**
 * Hive - Mention Routes
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { 
  db, 
  agentKey,
  agentsListKey,
  mentionKey, 
  mentionsByAgentKey, 
  mentionsByChannelKey, 
  getList,
} from '../db/index.js';
import type { Mention, ApiResponse, PaginatedResponse } from '../types.js';

export const mentionsRouter = new Hono();

type MentionStatus = 'pending' | 'running' | 'completed' | 'failed';

type MentionStatusCounts = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
};

type AgentStatusSummary = {
  agentId: string;
  agentName?: string;
  counts: MentionStatusCounts;
  lastMentionAt?: number;
};

type AgentStatusDetailMention = {
  id: string;
  postId: string;
  channelId: string;
  channelName?: string;
  fromAgentId?: string;
  createdAt: number;
  completedAt?: number;
  status: MentionStatus;
  read?: boolean;
  acknowledged?: boolean;
  error?: string;
};

function normalizeMentionStatus(mention: Mention): MentionStatus {
  return mention.spawnStatus || 'pending';
}

function emptyStatusCounts(): MentionStatusCounts {
  return {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    total: 0,
  };
}

function parseStatusFilter(value: string | undefined): MentionStatus | null {
  if (!value) return null;
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
    return value;
  }
  return null;
}

function isValidStatus(value: string | undefined): boolean {
  return value === undefined || parseStatusFilter(value) !== null;
}

// GET /mentions - List mentions (filter by agentId)
mentionsRouter.get('/', async (c) => {
  const agentId = c.req.query('agentId');
  const channelId = c.req.query('channelId');
  const unreadOnly = c.req.query('unread') === 'true';
  
  let mentionIds: string[] = [];
  
  if (agentId) {
    mentionIds = await getList<string>(mentionsByAgentKey(agentId));
  } else if (channelId) {
    mentionIds = await getList<string>(mentionsByChannelKey(channelId));
  }
  
  const mentions: Mention[] = [];
  for (const id of mentionIds) {
    const mention = db.get(mentionKey(id));
    if (mention) {
      if (unreadOnly && mention.read) continue;
      mentions.push(mention);
    }
  }
  
  // Sort by creation time (newest first)
  mentions.sort((a, b) => b.createdAt - a.createdAt);
  
  return c.json<PaginatedResponse<Mention>>({
    success: true,
    data: mentions,
    total: mentions.length,
    limit: 100,
    offset: 0,
  });
});

// GET /mentions/status/summary - Task board summary grouped by agent
mentionsRouter.get('/status/summary', async (c) => {
  const channelId = c.req.query('channelId');
  const statusQuery = c.req.query('status');

  if (!isValidStatus(statusQuery)) {
    return c.json<ApiResponse<never>>({
      success: false,
      error: 'Invalid status filter. Use pending, running, completed, or failed',
    }, 400);
  }

  const statusFilter = parseStatusFilter(statusQuery);
  const agentIds = await getList<string>(agentsListKey());
  const agentSummaries: AgentStatusSummary[] = [];
  const totals = emptyStatusCounts();

  for (const agentId of agentIds) {
    const mentionIds = await getList<string>(mentionsByAgentKey(agentId));
    const counts = emptyStatusCounts();
    let lastMentionAt: number | undefined;

    for (const mentionId of mentionIds) {
      const mention = db.get(mentionKey(mentionId)) as Mention | undefined;
      if (!mention) continue;
      if (channelId && mention.channelId !== channelId) continue;

      const status = normalizeMentionStatus(mention);
      if (statusFilter && status !== statusFilter) continue;

      counts[status] += 1;
      counts.total += 1;
      if (!lastMentionAt || mention.createdAt > lastMentionAt) {
        lastMentionAt = mention.createdAt;
      }
    }

    const agent = db.get(agentKey(agentId)) as { name?: string } | undefined;

    agentSummaries.push({
      agentId,
      agentName: agent?.name,
      counts,
      lastMentionAt,
    });

    totals.pending += counts.pending;
    totals.running += counts.running;
    totals.completed += counts.completed;
    totals.failed += counts.failed;
    totals.total += counts.total;
  }

  agentSummaries.sort((a, b) => {
    if (b.counts.total !== a.counts.total) return b.counts.total - a.counts.total;
    return a.agentId.localeCompare(b.agentId);
  });

  return c.json<ApiResponse<{
    agents: AgentStatusSummary[];
    totals: MentionStatusCounts;
    filters: { channelId?: string; status?: MentionStatus };
  }>>({
    success: true,
    data: {
      agents: agentSummaries,
      totals,
      filters: {
        channelId: channelId || undefined,
        status: statusFilter || undefined,
      },
    },
  });
});

// GET /mentions/status/:agentId - Detailed task board view for one agent
mentionsRouter.get('/status/:agentId', async (c) => {
  const { agentId } = c.req.param();
  const statusQuery = c.req.query('status');
  const channelId = c.req.query('channelId');
  const limitQuery = c.req.query('limit');

  if (!isValidStatus(statusQuery)) {
    return c.json<ApiResponse<never>>({
      success: false,
      error: 'Invalid status filter. Use pending, running, completed, or failed',
    }, 400);
  }

  const limit = limitQuery ? Number(limitQuery) : 50;
  if (!Number.isFinite(limit) || limit <= 0 || limit > 500) {
    return c.json<ApiResponse<never>>({
      success: false,
      error: 'Invalid limit. Use a number between 1 and 500',
    }, 400);
  }

  const agent = db.get(agentKey(agentId)) as { id: string; name?: string } | undefined;
  if (!agent) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Agent not found' }, 404);
  }

  const mentionIds = await getList<string>(mentionsByAgentKey(agentId));
  const statusFilter = parseStatusFilter(statusQuery);
  const counts = emptyStatusCounts();
  const detailMentions: AgentStatusDetailMention[] = [];

  for (const mentionId of mentionIds) {
    const mention = db.get(mentionKey(mentionId)) as Mention | undefined;
    if (!mention) continue;
    if (channelId && mention.channelId !== channelId) continue;

    const status = normalizeMentionStatus(mention);
    if (statusFilter && status !== statusFilter) continue;

    counts[status] += 1;
    counts.total += 1;

    detailMentions.push({
      id: mention.id,
      postId: mention.postId,
      channelId: mention.channelId,
      channelName: mention.channelName,
      fromAgentId: mention.fromAgentId || mention.mentioningAgentId,
      createdAt: mention.createdAt,
      completedAt: mention.completedAt,
      status,
      read: mention.read,
      acknowledged: mention.acknowledged,
      error: mention.spawnError,
    });
  }

  detailMentions.sort((a, b) => b.createdAt - a.createdAt);

  return c.json<ApiResponse<{
    agentId: string;
    agentName?: string;
    counts: MentionStatusCounts;
    mentions: AgentStatusDetailMention[];
    filters: { channelId?: string; status?: MentionStatus; limit: number };
  }>>({
    success: true,
    data: {
      agentId,
      agentName: agent.name,
      counts,
      mentions: detailMentions.slice(0, limit),
      filters: {
        channelId: channelId || undefined,
        status: statusFilter || undefined,
        limit,
      },
    },
  });
});

// GET /mentions/:id - Get a specific mention
mentionsRouter.get('/:id', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  return c.json<ApiResponse<Mention>>({ success: true, data: mention });
});

// PATCH /mentions/:id/read - Mark mention as read
mentionsRouter.patch('/:id/read', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// POST /mentions/:id/read - Mark mention as read (alternative)
mentionsRouter.post('/:id/read', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// POST /mentions/:id/acknowledge - Mark mention as acknowledged
mentionsRouter.post('/:id/acknowledge', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  const updated: Mention = {
    ...mention,
    read: true,
    acknowledged: true,
  };
  
  await db.put(mentionKey(id), updated);
  
  return c.json<ApiResponse<Mention>>({ success: true, data: updated });
});

// GET /mentions/:id/output - Get spawn output for a mention
mentionsRouter.get('/:id/output', async (c) => {
  const { id } = c.req.param();
  const mention = db.get(mentionKey(id));
  
  if (!mention) {
    return c.json<ApiResponse<never>>({ success: false, error: 'Mention not found' }, 404);
  }
  
  return c.json<ApiResponse<{ 
    status: string; 
    output?: string; 
    error?: string;
    pid?: number;
    completedAt?: number;
  }>>({
    success: true,
    data: {
      status: mention.spawnStatus || 'pending',
      output: mention.spawnOutput,
      error: mention.spawnError,
      pid: mention.spawnPid,
      completedAt: mention.completedAt,
    },
  });
});

export default mentionsRouter;
