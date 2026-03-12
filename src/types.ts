/**
 * Hive - Agent-to-Agent Communication Platform
 * Core type definitions
 */

// ============================================================================
// Channel Types
// ============================================================================

export interface Channel {
  id: string;
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  createdBy?: string;
  isPrivate?: boolean;
  members?: string[];
  cwd?: string;  // Working directory for agents spawned in this channel
  createdAt: number;
  updatedAt: number;
}

export interface ChannelCreateInput {
  name: string;
  description?: string;
  createdBy: string;
  isPrivate?: boolean;
  cwd?: string;  // Optional working directory for this channel's agents
}

export interface CreateChannelBody {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
}

// ============================================================================
// Post Types
// ============================================================================

export interface Post {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
  replyTo?: string;
  mentions: string[];
}

export interface PostCreateInput {
  channelId: string;
  authorId: string;
  content: string;
  replyTo?: string;
}

export interface CreatePostBody {
  authorId: string;
  content: string;
}

// ============================================================================
// Agent Types
// ============================================================================

export interface Agent {
  id: string;
  name: string;
  description?: string;
  // Local spawn configuration
  spawnCommand?: string;
  spawnArgs?: string[];
  cwd?: string;
  // Remote webhook notification
  webhook?: {
    url: string;
    secret?: string;
    headers?: Record<string, string>;
    timeout?: number;
  };
  capabilities?: string[];
  callbackUrl?: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentCreateInput {
  id: string;
  name: string;
  description?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterAgentBody {
  id: string;
  name: string;
  description?: string;
  spawnCommand?: string;
  spawnArgs?: string[];
  cwd?: string;
  capabilities?: string[];
}

// ============================================================================
// Subscription Types
// ============================================================================

export type SubscriptionType = 'channel' | 'agent' | 'mention';

export interface Subscription {
  id: string;
  agentId: string;
  targetType: SubscriptionType;
  targetId: string;
  createdAt: number;
  active?: boolean;
}

export interface SubscriptionCreateInput {
  agentId: string;
  targetType: SubscriptionType;
  targetId: string;
}

export interface SubscribeBody {
  agentId: string;
}

// ============================================================================
// Mention Types
// ============================================================================

export interface Mention {
  id: string;
  agentId: string;
  postId: string;
  channelId: string;
  channelName?: string;
  fromAgentId?: string;
  mentionedAgentId?: string;
  mentioningAgentId?: string;
  content?: string;
  createdAt: number;
  read?: boolean;
  acknowledged?: boolean;
  // Spawn tracking
  spawnPid?: number;
  spawnStatus?: 'pending' | 'running' | 'completed' | 'failed';
  spawnOutput?: string;
  spawnError?: string;
  completedAt?: number;
}

// ============================================================================
// Event + Webhook Notification Types
// ============================================================================

export type HiveEventType =
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'mention.spawn_status_changed';

export interface HiveEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: HiveEventType;
  timestamp: number;
  source: string;
  payload: TPayload;
}

export interface WebhookSubscription {
  id: string;
  name?: string;
  url: string;
  eventTypes: HiveEventType[];
  secret: string;
  timeoutMs: number;
  maxRetries: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId?: string;
  eventType: HiveEventType;
  timestamp: number;
  ok: boolean;
  statusCode?: number;
  durationMs?: number;
  error?: string;
}

// ============================================================================
// Auth Types
// ============================================================================

export type HiveRole = 'viewer' | 'operator' | 'admin';

export interface AuthPrincipal {
  id?: string;
  role: HiveRole;
  name?: string;
}

export interface ElevenLabsAudioAsset {
  id: string;
  voiceId: string;
  textHash: string;
  timestamp: number;
  size: number;
  contentType: string;
  storageKey: string;
  storageUrl?: string;
  createdAt: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
