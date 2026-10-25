import { iceOptionsFromEnv } from './ice.js';
import { createSignalingServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const ice = iceOptionsFromEnv(process.env);

const server = createSignalingServer({
  port,
  host,
  ice,
  log: (...args) => console.log(new Date().toISOString(), ...args),
});

server.ready.then((boundPort) => {
  console.log(`Signaling server listening on ws://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort}`);
  console.log(
    ice.turn
      ? `TURN enabled: ${ice.turn.urls.join(', ')}${ice.relayOnly ? ' (relay only)' : ''}`
      : 'TURN disabled (set TURN_URLS and TURN_SECRET to enable)',
  );
});

const shutdown = () => {
  console.log('Shutting down…');
  server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
