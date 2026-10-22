---
description: Review uncommitted or branch changes against WebRTC, signaling, and Electron pitfalls specific to this project. Use when the user asks for a review of call/WebRTC/signaling/Electron changes.
disable-model-invocation: true
---

# WebRTC-focused code review

Review the current changes (`git diff` plus `git diff --staged`, or `git diff main...HEAD` if the user names a branch). Read the touched files in full, not only the hunks.

Check each item and flag only real problems, citing file:line:

**Negotiation and ICE**
- Is there still exactly one offerer per negotiation, or is "perfect negotiation" implemented correctly (polite/impolite roles, `makingOffer`, rollback)?
- Are remote ICE candidates buffered until `remoteDescription` is set, and flushed afterwards?
- Are signaling messages still handled in order (through `messageQueueRef`)?
- On `peer-left`, hang-up, or unmount: is the `RTCPeerConnection` closed, are local tracks stopped, are handlers detached?
- Does renegotiation (`onnegotiationneeded`, `replaceTrack`, adding screen share) avoid glare?

**Media**
- Tracks stopped when no longer used (camera light should go off after hang-up).
- `replaceTrack` used for device or screen switches instead of tearing down the connection.
- Local preview muted; remote not muted.

**Signaling server**
- Every new message type validated in `parseClientMessage` and covered by a test.
- Protocol types changed in both `server/src/protocol.ts` and `client/src/signaling/protocol.ts`.
- No unbounded maps (rooms or peers cleaned up on close).

**Electron**
- `contextIsolation`, `sandbox`, `nodeIntegration:false` intact; preload exposes only minimal data.
- Permission handlers still restricted to our own origin.

**React**
- WebRTC objects in refs, not state; no stale closures in async callbacks; effects clean up.

Output: a short list of findings, most severe first, each with a concrete fix. If nothing is wrong, say so in one line. Don't edit files unless the user asks.
