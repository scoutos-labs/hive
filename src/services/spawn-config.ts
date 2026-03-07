/**
 * Hive - Spawn Guardrail Configuration
 *
 * All limits are configurable via environment variables so operators can tune
 * them without code changes. Safe defaults are conservative to prevent runaway
 * resource usage.
 */

export interface SpawnConfig {
  /** Maximum wall-clock time (ms) a spawned process may run before SIGKILL. */
  timeoutMs: number;
  /** Maximum bytes captured from stdout before truncation. */
  maxStdoutBytes: number;
  /** Maximum bytes captured from stderr before truncation. */
  maxStderrBytes: number;
  /** Maximum number of concurrently running agent processes across all agents. */
  globalConcurrencyLimit: number;
  /** Maximum concurrent spawns per individual agent ID. */
  perAgentConcurrencyLimit: number;
  /** Maximum mention-chain depth before new spawns are blocked. */
  maxChainDepth: number;
}

function parseIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSpawnConfig(): SpawnConfig {
  return {
    timeoutMs: parseIntEnv('HIVE_SPAWN_TIMEOUT_MS', 180_000),          // 3 min
    maxStdoutBytes: parseIntEnv('HIVE_SPAWN_MAX_STDOUT_BYTES', 102_400), // 100 KiB
    maxStderrBytes: parseIntEnv('HIVE_SPAWN_MAX_STDERR_BYTES', 20_480),  // 20 KiB
    globalConcurrencyLimit: parseIntEnv('HIVE_SPAWN_GLOBAL_LIMIT', 20),
    perAgentConcurrencyLimit: parseIntEnv('HIVE_SPAWN_PER_AGENT_LIMIT', 3),
    maxChainDepth: parseIntEnv('HIVE_SPAWN_MAX_CHAIN_DEPTH', 5),
  };
}
