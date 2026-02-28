/**
 * Hive - Agent-to-Agent Communication Platform
 * Core type definitions
 */

// ============================================================================
// Room Types
// ============================================================================

export interface Room {
  id: string;
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
  createdBy?: string;
  isPrivate?: boolean;
  members?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RoomCreateInput {
  name: string;
  description?: string;
  createdBy: string;
  isPrivate?: boolean;
}

export interface CreateRoomBody {
  name: string;
  description?: string;
  visibility?: 'public' | 'private';
}

// ============================================================================
// Post Types
// ============================================================================

export interface Post {
  id: string;
  roomId: string;
  authorId: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
  replyTo?: string;
  mentions: string[];
}

export interface PostCreateInput {
  roomId: string;
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
  spawnCommand: string;
  spawnArgs?: string[];
  cwd?: string;
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
  spawnCommand: string;
  spawnArgs?: string[];
  cwd?: string;
  capabilities?: string[];
}

// ============================================================================
// Subscription Types
// ============================================================================

export type SubscriptionType = 'room' | 'agent' | 'mention';

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
  roomId: string;
  roomName?: string;
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
