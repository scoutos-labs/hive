/**
 * Hive - ACP (Agent Communication Protocol) Types
 * 
 * Standard protocol for agent-to-agent communication.
 * Used for both webhook notifications and spawn communication.
 */

// ============================================================================
// Protocol Version
// ============================================================================

export const ACP_VERSION = 'acp/1.0' as const;

// ============================================================================
// Core Message Types
// ============================================================================

export type ACPMessageType = 
  | 'task'           // Initial task assignment
  | 'progress'       // Progress update
  | 'clarification' // Request for clarification
  | 'response'       // Final response
  | 'error';        // Error report

export interface ACPMessage<T = unknown> {
  protocol: typeof ACP_VERSION;
  type: ACPMessageType;
  taskId: string;
  timestamp: number;
  payload: T;
}

// ============================================================================
// Task Message (Hive → Agent)
// ============================================================================

export interface ACPTaskPayload {
  /** Mention ID - unique task identifier */
  mentionId: string;
  /** Channel context */
  channelId: string;
  channelName?: string;
  /** Working directory for the task */
  cwd?: string;
  /** Agent ID that mentioned this agent */
  fromAgent: string;
  /** Full content of the mention post */
  content: string;
  /** Current mention chain depth (for cycle prevention) */
  chainDepth: number;
  /** Task metadata */
  metadata?: Record<string, unknown>;
}

export type ACPTaskMessage = ACPMessage<ACPTaskPayload>;

// ============================================================================
// Progress Message (Agent → Hive)
// ============================================================================

export interface ACPProgressPayload {
  /** Progress percentage (0-100) */
  percent: number;
  /** Human-readable progress message */
  message: string;
  /** Optional stage identifier */
  stage?: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

export type ACPProgressMessage = ACPMessage<ACPProgressPayload>;

// ============================================================================
// Clarification Message (Agent → Hive)
// ============================================================================

export type ACPQuestionType = 'text' | 'choice' | 'multi' | 'file';

export interface ACPQuestion {
  /** Unique question ID */
  id: string;
  /** Question text */
  question: string;
  /** Question type */
  type: ACPQuestionType;
  /** For choice/multi: available options */
  options?: string[];
  /** Is this question required? */
  required?: boolean;
  /** Default value */
  default?: string | string[];
}

export interface ACPClarificationPayload {
  /** Questions needing answers */
  questions: ACPQuestion[];
  /** Optional context for clarification */
  context?: string;
  /** Timeout in milliseconds (optional) */
  timeoutMs?: number;
}

export type ACPClarificationMessage = ACPMessage<ACPClarificationPayload>;

// ============================================================================
// Clarification Response (Hive → Agent)
// ============================================================================

export interface ACPClarificationResponsePayload {
  /** Answers keyed by question ID */
  answers: Record<string, string | string[]>;
  /** Timestamp of response */
  respondedAt: number;
}

export type ACPClarificationResponseMessage = ACPMessage<ACPClarificationResponsePayload>;

// ============================================================================
// Response Message (Agent → Hive)
// ============================================================================

export type ACPResponseStatus = 'completed' | 'failed' | 'partial';

export interface ACPArtifact {
  /** Artifact type */
  type: 'file' | 'code' | 'link' | 'image' | 'data';
  /** Artifact name/title */
  name: string;
  /** Text content (for file/code) */
  content?: string;
  /** File path (for file artifacts) */
  path?: string;
  /** URL (for link/image) */
  url?: string;
  /** MIME type */
  mimeType?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface ACPResponsePayload {
  /** Response status */
  status: ACPResponseStatus;
  /** Human-readable message (becomes post content) */
  message: string;
  /** Structured artifacts */
  artifacts?: ACPArtifact[];
  /** Agents to mention for chaining */
  mentions?: string[];
  /** Error details (if status is failed) */
  error?: {
    code: string;
    message: string;
    recoverable?: boolean;
    stack?: string;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export type ACPResponseMessage = ACPMessage<ACPResponsePayload>;

// ============================================================================
// Error Message (Agent → Hive)
// ============================================================================

export interface ACPErrorPayload {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Is this recoverable? */
  recoverable?: boolean;
  /** Stack trace (optional) */
  stack?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

export type ACPErrorMessage = ACPMessage<ACPErrorPayload>;

// ============================================================================
// Agent Configuration (Extended)
// ============================================================================

export interface ACPAgentConfig {
  /** Protocol version to use */
  protocolVersion?: 'acp/1.0' | 'legacy';
  /** Capabilities this agent supports */
  capabilities?: ACPCapability[];
  /** Enable clarification support */
  clarifySupport?: boolean;
  /** Max clarification rounds */
  maxClarificationRounds?: number;
  /** Progress reporting interval (ms) */
  progressIntervalMs?: number;
}

export type ACPCapability = 
  | 'progress'        // Can send progress updates
  | 'clarification'  // Can request clarification
  | 'artifacts'      // Can return structured artifacts
  | 'mentions'       // Can mention other agents
  | 'webhook';       // Can receive webhook notifications

// ============================================================================
// Webhook Payloads
// ============================================================================

export interface ACPWebhookPayload {
  /** Protocol version */
  protocol: typeof ACP_VERSION;
  /** Message type */
  type: 'task';
  /** Task ID (mention ID) */
  taskId: string;
  /** Timestamp */
  timestamp: number;
  /** Task details */
  task: ACPTaskPayload;
  /** Signature for verification */
  signature?: string;
}

export interface ACPWebhookResponse {
  protocol: typeof ACP_VERSION;
  type: 'response' | 'ack';
  taskId: string;
  timestamp: number;
  /** For ack: acknowledgment */
  acknowledged?: boolean;
  /** For response: async response URL */
  responseUrl?: string;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isACPMessage(obj: unknown): obj is ACPMessage {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'protocol' in obj &&
    obj.protocol === ACP_VERSION &&
    'type' in obj &&
    'taskId' in obj &&
    'timestamp' in obj
  );
}

export function isACPTaskMessage(obj: unknown): obj is ACPTaskMessage {
  return isACPMessage(obj) && obj.type === 'task';
}

export function isACPProgressMessage(obj: unknown): obj is ACPProgressMessage {
  return isACPMessage(obj) && obj.type === 'progress';
}

export function isACPClarificationMessage(obj: unknown): obj is ACPClarificationMessage {
  return isACPMessage(obj) && obj.type === 'clarification';
}

export function isACPResponseMessage(obj: unknown): obj is ACPResponseMessage {
  return isACPMessage(obj) && obj.type === 'response';
}

export function isACPErrorMessage(obj: unknown): obj is ACPErrorMessage {
  return isACPMessage(obj) && obj.type === 'error';
}