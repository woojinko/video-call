# Video Call — React + TypeScript + WebRTC + Electron

A 1-on-1 video call: a React + TypeScript client, a small Node.js WebSocket signaling server, and an Electron desktop shell. Media goes peer-to-peer over WebRTC. The server only passes SDP and ICE candidates between the two peers.

```
┌────────────┐   offer / answer / ICE   ┌──────────────────┐   offer / answer / ICE   ┌────────────┐
│  Peer A    │ ───────────────────────► │ Signaling server │ ◄─────────────────────── │  Peer B    │
│ (browser   │ ◄─────── WebSocket ───── │ (Node + ws)      │ ───── WebSocket ───────► │ (browser   │
│ or Electron)                          └──────────────────┘                          │ or Electron)
│            │ ◄═══════════ audio/video: SRTP, peer-to-peer (STUN; TURN if needed) ═══► │            │
└────────────┘                                                                         └────────────┘
```

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev            # signaling server :8080 + Vite :5173
```

Open http://localhost:5173 in **two tabs**, type the same room name, and click Join in both.

Desktop app:

```bash
npm run dev:desktop    # server + Vite + an Electron window (DevTools detached)
```

Join the same room from the Electron window and a browser tab. On macOS, the first run asks for camera and microphone access for Electron.

## TURN

STUN alone fails when both peers sit behind symmetric NATs or strict firewalls. TURN fixes that by relaying the media.

The signaling server serves `GET /ice-config` on its own port (8080). It returns STUN servers plus TURN credentials that expire after `TURN_TTL_SECONDS`. The credentials use the coturn REST API scheme (HMAC-SHA1 of `expiry:user` with a shared secret), so the secret never reaches the browser. The client fetches this config before every new peer connection. If the fetch fails, it falls back to public STUN.

| Env var (signaling server) | Default | Meaning |
|---|---|---|
| `TURN_URLS` | unset (TURN off) | Comma-separated, e.g. `turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp` |
| `TURN_SECRET` | unset | Must match coturn's `static-auth-secret`. Set together with `TURN_URLS` |
| `TURN_TTL_SECONDS` | `3600` | Credential lifetime |
| `STUN_URLS` | Google's public STUN | Comma-separated; empty string disables STUN |
| `ICE_TRANSPORT_POLICY` | `all` | `relay` forces every call through TURN |

Run coturn locally with the config in `coturn/turnserver.conf`:

```bash
# Linux, or Docker Desktop with host networking enabled
TURN_SECRET=dev-secret docker compose up coturn

# macOS without Docker host networking
brew install coturn
turnserver -c coturn/turnserver.conf --static-auth-secret=dev-secret
```

**Prove TURN works.** Force relay-only, then join a call:

```bash
TURN_URLS='turn:localhost:3478?transport=udp' TURN_SECRET=dev-secret ICE_TRANSPORT_POLICY=relay npm run dev
```

The call should still connect. In `chrome://webrtc-internals`, the selected candidate pair should be `relay`. If coturn isn't running, the call stays on "Connecting…".

For production, put coturn on a public host, add TLS (`turns:` on 5349), open the relay port range, and uncomment the `denied-peer-ip` lines.

## Tests

```bash
npm run typecheck
npm test                         # server: room logic, validation, and a real WebSocket integration test
npx playwright install chromium  # once
npm run test:e2e                 # two Chromium pages with fake cameras run a real call
```

## Layout

| Path | What it does |
|---|---|
| `server/src/protocol.ts` | Message types and `parseClientMessage` validation |
| `server/src/rooms.ts` | Pure room bookkeeping: join, relay, leave, 2-person cap |
| `server/src/server.ts` | `ws` wiring, heartbeat that drops dead sockets, `GET /ice-config` |
| `server/src/ice.ts` | STUN/TURN settings from env vars and time-limited TURN credentials |
| `client/src/webrtc/useVideoCall.ts` | All `RTCPeerConnection` logic: offer/answer, ICE buffering, state machine |
| `client/src/webrtc/iceConfig.ts` | Fetches `/ice-config` before each peer connection |
| `client/src/signaling/SignalingClient.ts` | Typed WebSocket wrapper |
| `client/src/App.tsx` | Join screen, video tiles, mute/camera/hang-up |
| `desktop/src/main.ts` | Electron window, origin-scoped media permissions, macOS camera/mic prompt |
| `desktop/src/preload.ts` | Minimal `contextBridge` API (`window.desktop`) |
| `e2e/call.spec.ts` | Playwright end-to-end call tests |

## Design decisions (talking points)

- **Who sends the offer?** The peer that was already in the room, when it gets `peer-joined`. One fixed offerer avoids "glare" (both sides offering at once) without needing perfect negotiation yet.
- **Trickle ICE with buffering.** Candidates can arrive before `setRemoteDescription` finishes. They are queued and flushed afterwards.
- **Ordered signaling.** Incoming messages go through a promise queue so async WebRTC calls never interleave.
- **Refs and state.** `RTCPeerConnection` and `MediaStream` objects live in refs. Only what the UI shows lives in React state.
- **Server validates everything.** Payloads are size-capped, typed, and checked. Rooms are capped at 2. A heartbeat removes dead sockets so rooms don't leak.
- **Electron hardening.** `contextIsolation`, `sandbox`, no `nodeIntegration`, a tiny preload API, and camera/mic permission granted only to our own origin. Navigation away from the app is blocked.

## Known limitations

- `/ice-config` is unauthenticated, so anyone who can reach the signaling server can get short-lived TURN credentials. Add auth or rate limiting before you expose it publicly.
- `getUserMedia` needs a secure context. `localhost` counts as secure, but `http://<LAN-IP>:5173` from another device does not. Use HTTPS or a tunnel to test across machines.
- Electron is not packaged yet, and there is no CSP.

[`docs/CLAUDE_CODE_PLAYBOOK.md`](docs/CLAUDE_CODE_PLAYBOOK.md) covers all of these, with ready-to-paste Claude Code prompts.

Reference: [official WebRTC samples](https://webrtc.github.io/samples/), especially "peer connection", "perfect negotiation", and "getStats".
