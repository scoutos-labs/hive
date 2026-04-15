import { serve } from 'bun';

import { app } from '../server-app.js';
import { getServerConfig, logStartup, registerShutdown } from './shared.js';

const config = getServerConfig();

logStartup(config);

const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: config.host,
});

registerShutdown(() => {
  server.stop();
});
