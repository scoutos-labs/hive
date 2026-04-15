/**
 * Hive - ACP Parser
 * 
 * Parses inbound ACP messages from HTTP webhooks and other sources.
 */

import type {
  ACPMessage,
  ACPTaskMessage,
  ACPProgressMessage,
  ACPResponseMessage,
  ACPClarificationMessage,
  ACPProgressPayload,
  ACPResponsePayload,
  ACPClarificationPayload,
  ACPTaskPayload,
} from '../../types/acp.js';

const ACP_VER = 'acp/1.0' as const;

// ============================================================================
// Parse Result
// ============================================================================

export interface ACPParseResult<T = unknown> {
  success: boolean;
  message?: ACPMessage<T>;
  error?: string;
}

// ============================================================================
// Parse ACP Message from JSON
// ============================================================================

/**
 * Parse an ACP message from JSON string.
 * Validates protocol version and required fields.
 */
export function parseACPMessage(json: string): ACPParseResult {
  try {
    const obj = JSON.parse(json);

    if (!isACPMessage(obj)) {
      return {
        success: false,
        error: 'Invalid ACP message structure: missing required fields',
      };
    }

    if (obj.protocol !== ACP_VER) {
      return {
        success: false,
        error: `Unsupported ACP version: ${obj.protocol}. Expected ${ACP_VER}`,
      };
    }

    const validTypes = ['task', 'progress', 'response', 'clarification', 'error'];
    if (!validTypes.includes(obj.type)) {
      return {
        success: false,
        error: `Invalid message type: ${obj.type}. Expected one of: ${validTypes.join(', ')}`,
      };
    }

    return {
      success: true,
      message: obj,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse JSON: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Parse a task message.
 */
export function parseACPTaskMessage(json: string): ACPParseResult<ACPTaskMessage['payload']> {
  const result = parseACPMessage(json);
  if (!result.success || !result.message) {
    return { success: false, error: result.error };
  }

  if (result.message.type !== 'task') {
    return {
      success: false,
      error: `Expected 'task' message, got '${result.message.type}'`,
    };
  }

  return {
    success: true,
    message: result.message as ACPTaskMessage,
  };
}

/**
 * Parse a response message.
 */
export function parseACPResponseMessage(json: string): ACPParseResult<ACPResponseMessage['payload']> {
  const result = parseACPMessage(json);
  if (!result.success || !result.message) {
    return { success: false, error: result.error };
  }

  if (result.message.type !== 'response') {
    return {
      success: false,
      error: `Expected 'response' message, got '${result.message.type}'`,
    };
  }

  return {
    success: true,
    message: result.message as ACPResponseMessage,
  };
}

/**
 * Parse a progress message.
 */
export function parseACPProgressMessage(json: string): ACPParseResult<ACPProgressMessage['payload']> {
  const result = parseACPMessage(json);
  if (!result.success || !result.message) {
    return { success: false, error: result.error };
  }

  if (result.message.type !== 'progress') {
    return {
      success: false,
      error: `Expected 'progress' message, got '${result.message.type}'`,
    };
  }

  return {
    success: true,
    message: result.message as ACPProgressMessage,
  };
}

/**
 * Parse a clarification message.
 */
export function parseACPClarificationMessage(json: string): ACPParseResult<ACPClarificationMessage['payload']> {
  const result = parseACPMessage(json);
  if (!result.success || !result.message) {
    return { success: false, error: result.error };
  }

  if (result.message.type !== 'clarification') {
    return {
      success: false,
      error: `Expected 'clarification' message, got '${result.message.type}'`,
    };
  }

  return {
    success: true,
    message: result.message as ACPClarificationMessage,
  };
}

// ============================================================================
// Validate ACP Response Payload
// ============================================================================

export interface ValidatedResponse {
  valid: boolean;
  errors: string[];
  payload?: {
    status: 'completed' | 'failed' | 'partial';
    message: string;
    artifacts?: Array<{
      type: 'file' | 'code' | 'link' | 'image' | 'data';
      name: string;
      content?: string;
      path?: string;
      url?: string;
      mimeType?: string;
      metadata?: Record<string, unknown>;
    }>;
    mentions?: string[];
  };
}

/**
 * Validate an ACP response payload.
 */
export function validateACPResponse(payload: unknown): ValidatedResponse {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const p = payload as Record<string, unknown>;

  // Required: status
  if (!('status' in p)) {
    errors.push('Missing required field: status');
  } else {
    const validStatuses = ['completed', 'failed', 'partial'];
    if (!validStatuses.includes(p.status as string)) {
      errors.push(`Invalid status: ${p.status}. Must be one of: ${validStatuses.join(', ')}`);
    }
  }

  // Required: message
  if (!('message' in p) || typeof p.message !== 'string') {
    errors.push('Missing required field: message (string)');
  }

  // Optional: artifacts
  if ('artifacts' in p && p.artifacts !== undefined) {
    if (!Array.isArray(p.artifacts)) {
      errors.push('artifacts must be an array');
    } else {
      for (let i = 0; i < p.artifacts.length; i++) {
        const artifact = p.artifacts[i] as Record<string, unknown>;
        if (!artifact.name) {
          errors.push(`artifacts[${i}]: missing required field 'name'`);
        }
        if (!artifact.type) {
          errors.push(`artifacts[${i}]: missing required field 'type'`);
        }
      }
    }
  }

  // Optional: mentions
  if ('mentions' in p && p.mentions !== undefined) {
    if (!Array.isArray(p.mentions)) {
      errors.push('mentions must be an array');
    } else {
      for (const mention of p.mentions) {
        if (typeof mention !== 'string') {
          errors.push('mentions must contain strings');
          break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    payload: errors.length === 0 ? (p as ValidatedResponse['payload']) : undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isACPMessage(obj: unknown): obj is ACPMessage<
  ACPTaskPayload | ACPProgressPayload | ACPResponsePayload | ACPClarificationPayload
> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'protocol' in obj &&
    'type' in obj &&
    'taskId' in obj &&
    'timestamp' in obj
  );
}

export default {
  parseACPMessage,
  parseACPTaskMessage,
  parseACPResponseMessage,
  parseACPProgressMessage,
  parseACPClarificationMessage,
  validateACPResponse,
};
