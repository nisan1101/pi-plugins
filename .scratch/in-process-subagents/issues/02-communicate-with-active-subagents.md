# 02 — Communicate with active subagents

**What to build:** Let the parent and child communicate intentionally through the child’s UUID. Parent guidance can be buffered or steered, progress remains observable without waking the parent, and a child can block on one visible question until the parent answers it through the same parent-to-child tool.

**Blocked by:** 01 — Launch configured fresh subagents.

**Status:** resolved

- [x] `message_subagent` requires the full active UUID and rejects malformed, short, unknown, disposed, and finalizing UUIDs.
- [x] Guidance sent during startup remains bound to that UUID and reaches only its eventual child session.
- [x] Guidance sent while running uses Pi’s native steering semantics.
- [x] The child-only parent-communication tool accepts progress and question messages without accepting a caller-supplied destination.
- [x] Progress includes UUID and display name, enters visible parent model context in follow-up order, does not trigger a parent turn, and does not block the child.
- [x] A question includes UUID and display name, wakes an idle parent or follows an active parent turn, marks the child as waiting, and keeps the child tool call pending.
- [x] The first parent message to a waiting child resolves that pending question directly and restores the running state instead of steering.
- [x] Answering a question does not consume, cancel, or reorder steering already queued by Pi; later parent messages steer normally.
- [x] A second simultaneous question is rejected, no automatic timeout invents an answer, and waiting children continue to consume concurrency slots.
- [x] Footer status marks waiting handles with `?` and progress leaves the activity display otherwise unchanged.
- [x] Behavioral tests cover startup buffering, running steering, non-waking progress, parent wake-up, direct answers, queued-steering preservation, and invalid controls.

## Answer

Implemented UUID-addressed startup buffering and native steering, child-only progress and blocking-question communication, direct parent answers that preserve Pi’s steering queue, waiting-state status, and invalid-control handling.

Context: [feature map](../map.md).
