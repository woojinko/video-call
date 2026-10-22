# Video Call — project guide for Claude Code

1-on-1 WebRTC video call. npm workspaces monorepo:

- `server/` — Node.js + `ws` signaling server (TypeScript, ESM, run with `tsx`). Port 8080.
- `client/` — React 19 + TypeScript + Vite. Port 5173 (`strictPort`).
- `desktop/` — Electron shell (TypeScript compiled to CommonJS). Loads the Vite dev URL with `--dev`, otherwise `client/dist/index.html`.
- `e2e/` — Playwright tests: two Chromium pages with fake camera/mic join one room.

## Commands

- `npm install` — once, at the repo root (workspaces).
- `npm run dev` — server + client. Open http://localhost:5173 in two tabs, same room.
- `npm run dev:desktop` — server + client + Electron window.
- `npm run typecheck` — all three packages.
- `npm test` — server unit + integration tests (`node:test` via `tsx --test`).
- `npm run test:e2e` — Playwright; starts `npm run dev` itself if nothing is running. First time: `npx playwright install chromium`.
- `npm run build` — build everything.

## How a call is set up (read before touching WebRTC code)

1. A joins room → server replies `joined {peerCount:1}` → A shows "waiting".
2. B joins → B gets `joined {peerCount:2}`; A gets `peer-joined`. **A (already in the room) is always the offerer.**
3. A: `createOffer` → `setLocalDescription` → send `offer`. B: `setRemoteDescription` → `createAnswer` → send `answer`.
4. ICE candidates trickle both ways via `ice-candidate`. Candidates that arrive before the remote description are buffered in `pendingCandidatesRef` and flushed after `setRemoteDescription`.
5. On leave/disconnect the server sends `peer-left`; the remaining side closes its `RTCPeerConnection` and returns to "waiting".

Key files: `client/src/webrtc/useVideoCall.ts` (all peer-connection logic), `server/src/rooms.ts` (pure room logic), `server/src/server.ts` (socket wiring), `server/src/protocol.ts` (message types + validation).

## Conventions

- The protocol types are duplicated in `server/src/protocol.ts` and `client/src/signaling/protocol.ts`. If you change one, change the other in the same edit.
- Server never trusts input: every inbound message goes through `parseClientMessage`. New message types need a validator branch and a test.
- Signaling messages on the client are processed **sequentially** through `messageQueueRef`. Keep it that way; don't `await` WebRTC calls outside that queue.
- WebRTC objects (`RTCPeerConnection`, streams) live in refs, not React state. UI-visible values go in state.
- Electron: keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Expose only minimal, read-only data via `preload.ts` / `contextBridge`. Media permission is granted only to our own origin (`isTrustedOrigin`).
- Strict TypeScript everywhere; no `any`. Prefer small pure functions that are unit-testable.

## Verification (do this before saying a change is done)

- Any change: `npm run typecheck && npm test`.
- Changes in `client/src/webrtc`, `client/src/signaling`, or `server/`: also `npm run test:e2e`.
- Electron changes can't be tested headless here. Say so and list what the user should check by hand in `npm run dev:desktop`.
