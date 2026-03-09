/**
 * Hive - Spawn Command Allowlist & Argument Validator
 *
 * Prevents arbitrary command execution by restricting which executables agents
 * may declare as their spawnCommand and enforcing safe arg patterns.
 *
 * Configuration via environment variables:
 *   HIVE_SPAWN_ALLOWLIST   – comma-separated list of allowed executable names
 *                            or absolute paths (default: none → allowlist disabled
 *                            unless HIVE_SPAWN_ALLOWLIST_ENABLED=true).
 *   HIVE_SPAWN_ALLOWLIST_ENABLED – set to "true" to enforce the allowlist even
 *                                   if HIVE_SPAWN_ALLOWLIST is empty (blocks all).
 *
 * Argument validation (always active, not configurable off):
 *   - No individual arg may exceed 4096 characters.
 *   - No more than 64 args per invocation.
 *   - Args may not contain NUL bytes (common injection vector).
 *   - Shell metacharacters ($, `, ;, |, &, <, >, \n, \r) embedded in args are
 *     harmless when shell=false but are logged as a warning for auditability.
 */

export interface AllowlistCheckResult {
  allowed: boolean;
  reason?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

/** Characters that are dangerous only when a shell processes them. We flag but
 *  don't reject these because spawn(…, { shell: false }) is already safe; the
 *  warning exists so operators can spot mis-configured agents quickly. */
const SHELL_META_PATTERN = /[$`;\|&<>\r\n\0]/;

// ── Allowlist resolution ───────────────────────────────────────────────────

function parseAllowlist(): Set<string> | null {
  const raw = process.env.HIVE_SPAWN_ALLOWLIST;
  const enabled = (process.env.HIVE_SPAWN_ALLOWLIST_ENABLED ?? '').toLowerCase();

  const isEnabled = enabled === 'true' || enabled === '1' || enabled === 'yes';

  if (!isEnabled && !raw) {
    // Allowlist not configured → permissive mode (operator must opt-in).
    return null;
  }

  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return new Set(entries);
}

/** Extract just the executable name from a path, e.g. "/usr/bin/node" → "node". */
function executableName(command: string): string {
  const parts = command.split('/');
  return parts[parts.length - 1] ?? command;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a command is on the allowlist (when the allowlist is active).
 * Matches against both the full path and the basename.
 */
export function checkCommandAllowed(command: string): AllowlistCheckResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: 'spawnCommand must not be empty' };
  }

  const allowlist = parseAllowlist();
  if (allowlist === null) {
    // Permissive mode — no allowlist configured.
    return { allowed: true };
  }

  if (allowlist.size === 0) {
    return {
      allowed: false,
      reason: 'Spawn allowlist is enabled but empty — no commands are permitted. Set HIVE_SPAWN_ALLOWLIST.',
    };
  }

  const name = executableName(trimmed);
  if (allowlist.has(trimmed) || allowlist.has(name)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Command "${name}" is not in the spawn allowlist. Allowed: ${[...allowlist].join(', ')}`,
  };
}

/**
 * Validate a list of spawn arguments for safety.
 * Returns an error reason string on failure, or null on success.
 */
export function validateSpawnArgs(args: string[]): string | null {
  if (args.length > MAX_ARGS) {
    return `Too many spawn arguments: ${args.length} (max ${MAX_ARGS})`;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string') {
      return `Argument at index ${i} is not a string`;
    }
    if (arg.length > MAX_ARG_LENGTH) {
      return `Argument at index ${i} exceeds maximum length (${arg.length} > ${MAX_ARG_LENGTH})`;
    }
    if (arg.includes('\0')) {
      return `Argument at index ${i} contains a NUL byte`;
    }
    if (SHELL_META_PATTERN.test(arg)) {
      // Not blocked (shell=false makes these safe) but worth logging.
      console.warn(
        `[spawn-allowlist] Warning: argument at index ${i} contains shell metacharacter(s). ` +
        `These are harmless with shell=false but may indicate misconfiguration.`
      );
    }
  }

  return null;
}
