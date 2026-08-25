# 02 — Wall-clock timestamps on lifecycle messages

**What to build:** The parent agent and the user can tell *when* subagent
lifecycle events happened. Launch acknowledgement, progress reports, and
completion/failure messages each carry a wall-clock timestamp, so the parent can
subtract them to reason about elapsed time and pace on its own.

**Blocked by:** None — can start immediately (parallel with 01).

**Status:** ready-for-agent

- [ ] The launch acknowledgement message includes an ISO wall-clock timestamp in its text, so the parent has an anchor to measure elapsed time against.
- [ ] Progress reports include an ISO wall-clock timestamp in their text.
- [ ] Completion and failure messages include an ISO wall-clock timestamp in their text.
- [ ] The extension emits raw wall-clock only — it computes no elapsed time, duration, or deltas.
- [ ] `message_parent` progress remains available and continues to be delivered into parent-model context without triggering a turn.
- [ ] Tests assert the presence of a wall-clock timestamp in launch, progress, and completion/failure message content.
