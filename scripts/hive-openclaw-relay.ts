import { parseRelayServerConfigFromEnv, startRelayServer } from '../src/services/openclaw-relay.js';

const config = parseRelayServerConfigFromEnv();
const server = startRelayServer(config);

console.log(
  `[relay] listening on http://${config.host}:${config.port}${config.path} (openclaw=${config.runtime.openclawBin}, telegram=${config.runtime.telegram.enabled ? config.runtime.telegram.chatId : 'off'})`
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
