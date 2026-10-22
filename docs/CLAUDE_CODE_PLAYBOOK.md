# Improving this project with Claude Code

The aim is a project you can **explain line by line in an interview**, with a few meaningful improvements you directed yourself. Claude Code does the typing. You make the decisions and check the results.

---

## 0. One-time setup (≈10 min)

```bash
# Install Claude Code (macOS). Alternative: brew install --cask claude-code
curl -fsSL https://claude.ai/install.sh | bash
claude --version

cd ~/Desktop/Claude/video-call
mv claude-config .claude      # project skills + settings (shipped under a different name)
npm install
npx playwright install chromium
npm run typecheck && npm test && npm run test:e2e   # baseline: everything green

git init && git add -A && git commit -m "Initial video call scaffold"
```

**Commit first.** Git is your undo button, and `claude --worktree` needs at least one commit.

The project already contains Claude Code configuration:

| File | Purpose |
|---|---|
| `CLAUDE.md` | Loaded at the start of every session: architecture, commands, conventions, and the rule "verify before you say done". |
| `.claude/settings.json` | Pre-approves safe commands (typecheck, test, e2e, build, git status/diff) so Claude doesn't ask every time. |
| `.claude/skills/verify/` | `/verify` runs typecheck, unit tests, and the e2e call test, then reports. |
| `.claude/skills/webrtc-review/` | `/webrtc-review` reviews your diff for WebRTC, signaling, and Electron pitfalls. |

---

## 1. Day 1: understand it before you change it (≈1 h)

Start a session in the repo:

```bash
claude
```

Ask questions an interviewer would ask, and make Claude point to the code:

```text
Walk me through exactly what happens, message by message, from the moment two people click Join until video appears. Cite file:line for each step.
```
```text
Why does the peer that joined first send the offer? What would break if both sent offers?
```
```text
What are ICE candidates, why do we buffer them in pendingCandidatesRef, and what's the difference between STUN and TURN?
```
```text
Quiz me with 8 interview questions about this codebase, one at a time. Wait for my answer and grade it before moving on.
```

Then run it yourself: `npm run dev` (two tabs) and `npm run dev:desktop`. In Chrome, open `chrome://webrtc-internals` during a call. It's the single best debugging tool to mention in an interview.

---

## 2. The improvement loop (use it for every feature)

1. **Branch:** `git switch -c feat/<name>`.
2. **Plan first.** Press `Shift+Tab` until the status bar shows `⏸ plan mode on`, or start with `claude --permission-mode plan`. Paste a prompt from the backlog below. Claude reads the code and proposes a plan without editing anything. **Push back on the plan.** This is where you make the engineering decisions.
3. **Implement.** Approve the plan and let Claude edit.
4. **Verify.** Type `/verify`. Claude runs the typecheck, unit tests, and e2e test, and fixes what it broke.
5. **Review.** Type `/webrtc-review`. Fix what's real, and ask "why?" about anything you don't understand.
6. **Try it by hand** in two tabs, or in Electron plus a tab.
7. **Commit.** Ask: `commit this with a clear message`. Then merge.

Prompt habits that help:
- Reference files with `@`, for example `@client/src/webrtc/useVideoCall.ts`.
- Paste screenshots of UI bugs or `chrome://webrtc-internals` graphs straight into the session.
- Say what "done" means: "done = e2e test covers it and passes".
- Use `claude --continue` the next day to resume where you left off.

---

## 3. Improvement backlog (ordered by interview value)

Each prompt is ready to paste into plan mode.

### A. Live connection stats overlay ⭐ (≈45 min)
```text
Add a toggleable stats overlay to the call screen using RTCPeerConnection.getStats() polled every second: round-trip time, outbound/inbound video bitrate (computed from bytes deltas), packet loss %, frames per second, resolution, and the selected ICE candidate pair type (host/srflx/relay). Put the stats math in a pure function in client/src/webrtc/stats.ts with unit tests (add vitest to the client workspace). Keep useVideoCall's public API small.
```
*Why:* it shows you understand what's actually on the wire, and "relay vs. srflx" leads straight into a NAT/TURN discussion.

### B. Camera/microphone picker with `replaceTrack` (≈45 min)
```text
Add device selectors for camera and microphone (enumerateDevices, update on devicechange). Switching devices mid-call must use RTCRtpSender.replaceTrack so there is no renegotiation, and must stop the old track. Extend the e2e test to switch camera mid-call and assert the call stays connected.
```

### C. Screen sharing, including Electron (≈1 h)
```text
Add a "Share screen" button that swaps the outgoing video track for getDisplayMedia() using replaceTrack, and swaps back when sharing stops (including when the user clicks the browser's native "Stop sharing"). In Electron, getDisplayMedia needs session.setDisplayMediaRequestHandler with desktopCapturer; implement a simple picker or pick the primary screen. Explain the Electron-specific part to me before implementing it.
```
*Why:* this is the canonical "browser vs. Electron differences" story.

### D. Perfect negotiation (≈1 h)
```text
Refactor useVideoCall to the "perfect negotiation" pattern from the WebRTC samples (polite/impolite peers, makingOffer, ignoreOffer, rollback via onnegotiationneeded) so either side can renegotiate, for example when adding screen share. Decide politeness from the server: extend the 'joined' message with a 'polite' boolean (update both protocol files and server tests). Keep the e2e tests green and add one where both sides renegotiate.
```

### E. Resilience: signaling reconnect + ICE restart (≈45 min)
```text
Make calls survive network blips: (1) SignalingClient reconnects with exponential backoff and rejoins the room; (2) when connectionState goes 'failed', the offerer performs an ICE restart (createOffer({iceRestart:true})); (3) the UI shows 'Reconnecting…' accurately. Add a server-side test for a peer that reconnects into the same room.
```

### F. TURN support (≈30 min + a free TURN account or local coturn)
```text
Make ICE servers configurable: the signaling server exposes GET /ice-config that returns STUN plus TURN credentials from environment variables (time-limited HMAC credentials, coturn REST-API style). The client fetches it before creating the RTCPeerConnection. Add a docker-compose.yml with coturn for local testing and document how to force relay-only (iceTransportPolicy: 'relay') to prove TURN works.
```

### G. Shared protocol package (refactor, ≈30 min)
```text
Extract the duplicated protocol types and parseClientMessage into a new npm workspace 'shared' that both server and client import, so the types can't drift. Update CLAUDE.md to match. No behaviour change: all tests must pass unchanged.
```

### H. Electron production polish (≈1 h)
```text
Package the desktop app with electron-builder for macOS (arm64): app id, icon placeholder, NSCameraUsageDescription/NSMicrophoneUsageDescription in Info.plist, and the camera/microphone entitlements for hardened runtime. Add a strict Content-Security-Policy for production builds that still allows the signaling WebSocket. Add `npm run package:mac`. List what would still be needed for notarization.
```

### I. Text chat over `RTCDataChannel` (≈30 min)
```text
Add an in-call text chat that goes over an RTCDataChannel (not the signaling server). Show unread count when the panel is closed. Extend e2e: Alice sends a message, Bob sees it.
```

---

## 4. Claude Code features worth using here

- **Subagents for research.** `use a subagent to read the WebRTC samples' perfect-negotiation code and summarize the exact algorithm` keeps your main context clean.
- **Parallel work with worktrees.** In a second terminal, `claude --worktree screen-share` gives Claude an isolated checkout on its own branch. That lets you build C while another session builds A.
- **Hooks.** Ask Claude: `add a Claude Code hook in .claude/settings.json that runs npm run typecheck after every file edit and shows me the result`. Then read what it wrote. Hooks are deterministic: they run every time, unlike instructions in CLAUDE.md.
- **Headless mode for quick reviews.** `git diff main | claude -p "review this diff for WebRTC resource leaks"`.
- **Keep CLAUDE.md current.** After a big change: `update CLAUDE.md to reflect what we changed`. Next session starts smarter.

Docs: https://code.claude.com/docs/en/common-workflows · https://code.claude.com/docs/en/skills · https://code.claude.com/docs/en/hooks-guide · https://code.claude.com/docs/en/worktrees

---

## 5. Turning it into an interview story

Keep `docs/DECISIONS.md` and add 2–3 lines per improvement: the problem, the options you considered, what you chose and why, and how you verified it. Ask Claude to draft each entry, then rewrite it in your own words.

A 60-second answer to "Have you used WebRTC/Electron?" could cover:
1. **What:** a 1-on-1 call app with React/TS, a Node WebSocket signaling server, and an Electron shell.
2. **One hard problem:** for example ICE candidate ordering, glare and perfect negotiation, or screen share in Electron through `setDisplayMediaRequestHandler`.
3. **How you measured it:** getStats overlay, `chrome://webrtc-internals`, Playwright e2e with fake devices.
4. **What you'd do next at scale:** TURN, an SFU (mediasoup/LiveKit) for more than 2 people, simulcast.

Be upfront that you used an AI coding tool. What makes it a strong story is that you can defend every decision in it.
