import type { MiddlewareHandler } from 'hono';
import { getAuthConfig } from './config.js';
import { hasRoleAtLeast } from './roles.js';
import type { ApiResponse, AuthPrincipal, HiveRole } from '../types.js';

type AccessRule = {
  minimumRole: HiveRole;
  reason: string;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(' ', 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolvePrincipalFromToken(
  token: string | null,
  tokens: ReturnType<typeof getAuthConfig>['tokens']
): AuthPrincipal | null {
  if (!token) return null;

  if (tokens.admin && token === tokens.admin) {
    return { role: 'admin' };
  }
  if (tokens.operator && token === tokens.operator) {
    return { role: 'operator' };
  }
  if (tokens.viewer && token === tokens.viewer) {
    return { role: 'viewer' };
  }

  return null;
}

function getAccessRule(method: string, path: string): AccessRule | null {
  if (path.startsWith('/proxy/elevenlabs')) {
    return {
      minimumRole: 'operator',
      reason: 'ElevenLabs proxy can trigger external API usage and spend',
    };
  }

  if (path.startsWith('/webhook-subscriptions')) {
    return {
      minimumRole: 'admin',
      reason: 'Webhook subscriptions can exfiltrate event data',
    };
  }

  if (isSafeMethod(method)) {
    return null;
  }

  if (method.toUpperCase() === 'DELETE') {
    return {
      minimumRole: 'admin',
      reason: 'Delete operations are destructive',
    };
  }

  return {
    minimumRole: 'operator',
    reason: 'Mutating endpoints require operator permissions',
  };
}

export const authGuardMiddleware: MiddlewareHandler = async (c, next) => {
  const config = getAuthConfig();
  if (!config.enabled || !config.protectSensitiveEndpoints) {
    await next();
    return;
  }

  let accessRule = getAccessRule(c.req.method, c.req.path);
  if (!accessRule && !config.allowAnonymousRead && isSafeMethod(c.req.method)) {
    accessRule = {
      minimumRole: 'viewer',
      reason: 'Read endpoints require authenticated viewer role',
    };
  }

  if (!accessRule) {
    await next();
    return;
  }

  const token = parseBearerToken(c.req.header('authorization'));
  const principal = resolvePrincipalFromToken(token, config.tokens);

  if (!principal) {
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: `Authentication required (minimum role: ${accessRule.minimumRole})`,
      },
      401
    );
  }

  if (!hasRoleAtLeast(principal.role, accessRule.minimumRole)) {
    return c.json<ApiResponse<never>>(
      {
        success: false,
        error: `Forbidden: requires ${accessRule.minimumRole} role. ${accessRule.reason}`,
      },
      403
    );
  }

  await next();
};
