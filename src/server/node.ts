#!/usr/bin/env node

import { serve } from '@hono/node-server';

import { app } from '../server-app.js';
import { getServerConfig, logStartup, registerShutdown } from './shared.js';

const config = getServerConfig();

logStartup(config);

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

registerShutdown(() => new Promise<void>((resolve, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }

    resolve();
  });
}));
