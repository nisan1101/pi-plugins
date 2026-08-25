# 02 — Wall-clock timestamps on lifecycle messages

**What to build:** The parent agent and the user can tell *when* subagent
lifecycle events happened. Launch acknowledgement, progress reports, and
completion/failure messages each carry a wall-clock timestamp, so the parent can
subtract them to reason about elapsed time and pace on its own.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** resolved

- [x] The launch acknowledgement message includes an ISO wall-clock timestamp in its text, so the parent has an anchor to measure elapsed time against.
- [x] Progress reports include an ISO wall-clock timestamp in their text.
- [x] Completion and failure messages include an ISO wall-clock timestamp in their text.
- [x] The extension emits raw wall-clock only — it computes no elapsed time, duration, or deltas.
- [x] `message_parent` progress remains available and continues to be delivered into parent-model context without triggering a turn.
- [x] Tests assert the presence of a wall-clock timestamp in launch, progress, and completion/failure message content.

## Answer

Implemented in `packages/pi-subagents/extensions/subagents.ts`: a single `wallClock()` helper returns a raw ISO-8601 (UTC) instant, stamped into the launch acknowledgement, `message_parent` progress, and completion/failure message text. Progress and completion capture the instant at the event moment (not at delivery), because those sends are buffered until the parent is idle. The extension does no elapsed-time or delta math; the local `HH:MM:SS` log-line prefix (ticket 01) is unchanged. `message_parent` progress still delivers into parent context via `deliverParentMessage(ctx, false, send)` with `triggerTurn: false`. Tests in `test/subagents.test.mjs` assert an ISO timestamp in launch, progress, completed, and failed message content.
