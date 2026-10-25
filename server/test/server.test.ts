import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createSignalingServer } from '../src/server.js';
import type { IceConfig, ServerMessage } from '../src/protocol.js';

/** Small helper: a ws client that buffers messages so tests can await the next one. */
function connect(url: string) {
  const ws = new WebSocket(url);
  const queue: ServerMessage[] = [];
  const waiters: Array<(m: ServerMessage) => void> = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return {
    ws,
    open: () => new Promise<void>((resolve) => ws.once('open', () => resolve())),
    send: (m: unknown) => ws.send(JSON.stringify(m)),
    next: () =>
      new Promise<ServerMessage>((resolve) => {
        const queued = queue.shift();
        if (queued) resolve(queued);
        else waiters.push(resolve);
      }),
  };
}

test('end-to-end: two clients join, exchange offer/answer/candidate, and see peer-left', async () => {
  const server = createSignalingServer({ port: 0, host: '127.0.0.1' });
  const port = await server.ready;
  const url = `ws://127.0.0.1:${port}`;

  const a = connect(url);
  const b = connect(url);
  await Promise.all([a.open(), b.open()]);

  a.send({ type: 'join', roomId: 'e2e' });
  assert.equal((await a.next()).type, 'joined');

  b.send({ type: 'join', roomId: 'e2e' });
  const bJoined = await b.next();
  assert.equal(bJoined.type, 'joined');
  assert.equal(bJoined.type === 'joined' && bJoined.peerCount, 2);
  // The peer already in the room is told to start the call (it becomes the offerer).
  const aNotified = await a.next();
  assert.equal(aNotified.type, 'peer-joined');
  assert.equal(aNotified.type === 'peer-joined' && bJoined.type === 'joined' && aNotified.peerId === bJoined.peerId, true);

  a.send({ type: 'offer', sdp: { type: 'offer', sdp: 'v=0 offer' } });
  assert.deepEqual(await b.next(), { type: 'offer', sdp: { type: 'offer', sdp: 'v=0 offer' } });

  b.send({ type: 'answer', sdp: { type: 'answer', sdp: 'v=0 answer' } });
  assert.deepEqual(await a.next(), { type: 'answer', sdp: { type: 'answer', sdp: 'v=0 answer' } });

  const candidate = { candidate: 'candidate:1 1 udp 1 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  b.send({ type: 'ice-candidate', candidate });
  assert.deepEqual(await a.next(), { type: 'ice-candidate', candidate });

  b.ws.close();
  assert.equal((await a.next()).type, 'peer-left');

  a.ws.close();
  await server.close();
});

test('malformed messages get an error reply instead of crashing the server', async () => {
  const server = createSignalingServer({ port: 0, host: '127.0.0.1' });
  const port = await server.ready;
  const c = connect(`ws://127.0.0.1:${port}`);
  await c.open();

  c.ws.send('this is not json');
  assert.deepEqual(await c.next(), { type: 'error', message: 'Malformed message' });

  c.send({ type: 'offer', sdp: { type: 'offer', sdp: 'x' } });
  assert.deepEqual(await c.next(), { type: 'error', message: 'Join a room first' });

  c.ws.close();
  await server.close();
});

test('GET /ice-config serves STUN plus fresh TURN credentials on the signaling port', async () => {
  const server = createSignalingServer({
    port: 0,
    host: '127.0.0.1',
    ice: { stunUrls: ['stun:stun.example.com'], turn: { urls: ['turn:127.0.0.1:3478'], secret: 's3cret', ttlSeconds: 60 }, relayOnly: false },
  });
  const port = await server.ready;

  const res = await fetch(`http://127.0.0.1:${port}/ice-config`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const config = (await res.json()) as IceConfig;
  assert.deepEqual(config.iceServers[0], { urls: ['stun:stun.example.com'] });
  assert.deepEqual(config.iceServers[1]?.urls, ['turn:127.0.0.1:3478']);
  assert.match(config.iceServers[1]?.username ?? '', /^\d+:video-call$/);

  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);

  await server.close();
});
