import { closeDatabase } from '../db/index.js';

export interface ServerConfig {
  host: string;
  port: number;
}

export function getServerConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || process.env.HIVE_PORT || '7373', 10),
    host: process.env.HOST || process.env.HIVE_HOST || '0.0.0.0',
  };
}

export function logStartup(config: ServerConfig) {
  console.log(`Hive starting on ${config.host}:${config.port}`);
  console.log(`Hive server running at http://${config.host}:${config.port}`);
}

export function registerShutdown(stopServer: () => void | Promise<void>) {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log('\nHive shutting down...');

    try {
      await stopServer();
    } finally {
      await closeDatabase();
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}
