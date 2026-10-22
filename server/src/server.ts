import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, parseClientMessage, type ServerMessage } from './protocol.js';
import { RoomManager, type Peer } from './rooms.js';

export interface SignalingServerOptions {
  port: number;
  host?: string;
  /** How often to ping clients to detect dead connections. */
  heartbeatMs?: number;
  log?: (...args: unknown[]) => void;
}

export interface SignalingServer {
  wss: WebSocketServer;
  rooms: RoomManager;
  /** Resolves with the bound port (useful when port 0 is passed in tests). */
  ready: Promise<number>;
  close(): Promise<void>;
}

type AliveSocket = WebSocket & { isAlive?: boolean };

export function createSignalingServer(options: SignalingServerOptions): SignalingServer {
  const { port, host, heartbeatMs = 30_000, log = () => {} } = options;
  const rooms = new RoomManager(2);
  const wss = new WebSocketServer({ port, host, maxPayload: MAX_MESSAGE_BYTES });

  const ready = new Promise<number>((resolve, reject) => {
    wss.once('listening', () => {
      const address = wss.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
    wss.once('error', reject);
  });

  wss.on('connection', (socket: AliveSocket, request) => {
    const peer: Peer = {
      id: randomUUID(),
      send(message: ServerMessage) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      },
    };
    socket.isAlive = true;
    log(`[connect] ${peer.id} from ${request.socket.remoteAddress}`);

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data) => {
      const message = parseClientMessage(data.toString());
      if (!message) {
        peer.send({ type: 'error', message: 'Malformed message' });
        return;
      }

      switch (message.type) {
        case 'join':
          rooms.join(peer, message.roomId);
          log(`[join] ${peer.id} → ${message.roomId} (${rooms.peerCount(message.roomId)} in room)`);
          break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          if (!rooms.roomOf(peer.id)) {
            peer.send({ type: 'error', message: 'Join a room first' });
            return;
          }
          rooms.relay(peer, message);
          break;
        case 'leave':
          rooms.leave(peer);
          log(`[leave] ${peer.id}`);
          break;
      }
    });

    socket.on('close', () => {
      rooms.leave(peer);
      log(`[disconnect] ${peer.id}`);
    });

    socket.on('error', (err) => log(`[error] ${peer.id}`, err.message));
  });

  // Heartbeat: terminate sockets that stopped answering pings (laptop lid closed, network drop).
  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<AliveSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, heartbeatMs);

  wss.on('close', () => clearInterval(heartbeat));

  return {
    wss,
    rooms,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
