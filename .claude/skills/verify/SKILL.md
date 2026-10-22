---
description: Run the project's full verification (typecheck, server tests, Playwright e2e call test) and report results. Use after any code change, before committing, or when the user says "verify" or "check everything".
---

# Verify the video-call project

Run these from the repo root, in order, and stop at the first failure:

1. `npm run typecheck`
2. `npm test`
3. `npm run test:e2e` (skip only if the change touched nothing in `client/`, `server/`, or `e2e/`)

If something fails:
- Show the failing test name and the key lines of the error (not the whole log).
- Diagnose the root cause before proposing a fix. Don't weaken or delete a test to make it pass.
- If the user asked you to fix failures, fix them and re-run the whole sequence.

When everything passes, reply with one short summary line per step (for example "typecheck ✓ · 7 unit ✓ · 2 e2e ✓").
If `desktop/` changed, add a short manual checklist for `npm run dev:desktop` (window opens, camera prompt, call connects to a browser tab), since Electron isn't covered by automated tests.
