import type { HiveRole } from '../types.js';

export interface HiveAuthConfig {
  enabled: boolean;
  protectSensitiveEndpoints: boolean;
  allowAnonymousRead: boolean;
  tokens: Partial<Record<HiveRole, string>>;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function readToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getAuthConfig(env = process.env): HiveAuthConfig {
  return {
    enabled: parseBoolean(env.HIVE_AUTH_ENABLED, false),
    protectSensitiveEndpoints: parseBoolean(env.HIVE_AUTH_PROTECT_SENSITIVE, true),
    allowAnonymousRead: parseBoolean(env.HIVE_AUTH_ALLOW_ANONYMOUS_READ, true),
    tokens: {
      viewer: readToken(env.HIVE_AUTH_VIEWER_TOKEN),
      operator: readToken(env.HIVE_AUTH_OPERATOR_TOKEN),
      admin: readToken(env.HIVE_AUTH_ADMIN_TOKEN),
    },
  };
}
