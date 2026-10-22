import { createSignalingServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';

const server = createSignalingServer({
  port,
  host,
  log: (...args) => console.log(new Date().toISOString(), ...args),
});

server.ready.then((boundPort) => {
  console.log(`Signaling server listening on ws://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort}`);
});

const shutdown = () => {
  console.log('Shutting down…');
  server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
