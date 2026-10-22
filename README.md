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
| `server/src/server.ts` | `ws` wiring, heartbeat that drops dead sockets |
| `client/src/webrtc/useVideoCall.ts` | All `RTCPeerConnection` logic: offer/answer, ICE buffering, state machine |
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

- STUN only, with no TURN server, so calls across some corporate or symmetric NATs will fail.
- `getUserMedia` needs a secure context. `localhost` counts as secure, but `http://<LAN-IP>:5173` from another device does not. Use HTTPS or a tunnel to test across machines.
- Electron is not packaged yet, and there is no CSP.

[`docs/CLAUDE_CODE_PLAYBOOK.md`](docs/CLAUDE_CODE_PLAYBOOK.md) covers all of these, with ready-to-paste Claude Code prompts.

Reference: [official WebRTC samples](https://webrtc.github.io/samples/), especially "peer connection", "perfect negotiation", and "getStats".
