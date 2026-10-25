import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { buildIceConfig, DEFAULT_ICE_OPTIONS, type IceOptions } from './ice.js';
import { MAX_MESSAGE_BYTES, parseClientMessage, type ServerMessage } from './protocol.js';
import { RoomManager, type Peer } from './rooms.js';

export interface SignalingServerOptions {
  port: number;
  host?: string;
  /** How often to ping clients to detect dead connections. */
  heartbeatMs?: number;
  /** STUN/TURN settings served at GET /ice-config. Defaults to public STUN only. */
  ice?: IceOptions;
  log?: (...args: unknown[]) => void;
}

export interface SignalingServer {
  http: HttpServer;
  wss: WebSocketServer;
  rooms: RoomManager;
  /** Resolves with the bound port (useful when port 0 is passed in tests). */
  ready: Promise<number>;
  close(): Promise<void>;
}

type AliveSocket = WebSocket & { isAlive?: boolean };

export function createSignalingServer(options: SignalingServerOptions): SignalingServer {
  const { port, host, heartbeatMs = 30_000, ice = DEFAULT_ICE_OPTIONS, log = () => {} } = options;
  const rooms = new RoomManager(2);

  // Plain HTTP for /ice-config; WebSocket upgrades on the same port go to `wss`.
  const http = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && pathname === '/ice-config') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        // Credentials are time-limited and minted per request; never cache them.
        'Cache-Control': 'no-store',
        // The client runs on another origin (Vite :5173, Electron file://). The endpoint
        // is unauthenticated anyway, so CORS adds no protection; the short TTL does.
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(buildIceConfig(ice, Date.now())));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

  const ready = new Promise<number>((resolve, reject) => {
    http.once('listening', () => {
      const address = http.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    });
    http.once('error', reject);
  });
  http.listen(port, host);

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
    http,
    wss,
    rooms,
    ready,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
