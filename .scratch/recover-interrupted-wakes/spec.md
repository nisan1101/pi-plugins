# Recover Interrupted Scheduled Wakes

## Problem Statement

Scheduled wakes currently depend on in-memory timers and Pi’s in-memory follow-up queue. If Pi exits, reloads, switches sessions, crashes, is killed, or loses power before a wake message reaches the agent, that planned check disappears. The underlying local job or remote asynchronous condition may continue, but the agent receives no indication that its check was interrupted.

Graceful shutdown hooks cannot solve the whole problem because a hard kill or crash runs no extension code. A resumed session therefore needs enough durable, session-scoped information to recognize wakes that were pending in the previous Pi process.

Users need the next prompt in a resumed session to tell the agent which scheduled wake timers were interrupted, without automatically waking the agent, reviving stale timers, scanning an entire large session, or taking ownership of the underlying work.

## Solution

Persist a compact snapshot of all pending scheduled wakes in Pi’s append-only session history whenever wake state changes. The snapshot is extension state only and does not enter model context during normal operation.

When a session starts, the Scheduled Wake extension walks backward along the active branch using Pi’s indexed entry lookup until it finds the newest wake-state marker. It does not build or scan the full branch. If that marker contains pending wakes from a previous Pi process, the extension appends one visible custom cancellation message to model context without triggering an agent turn.

The cancellation message explains that the scheduled wakes were interrupted, their timers will not be restored, and the local jobs or remote targets were not changed. It includes every original wake reason and deadline. The message itself records an empty pending snapshot, so it is the durable terminal marker and is not repeated on later resumes. The user’s next prompt then carries the cancellation information to the agent.

## User Stories

1. As a user, I want an interrupted scheduled wake recorded in the resumed session, so that the agent knows its planned check did not reach it.
2. As a user, I want interruption recovery to work after a normal Pi exit, so that graceful shutdown does not silently lose planned checks.
3. As a user, I want interruption recovery to work after Pi is killed or crashes, so that correctness does not depend on shutdown hooks running.
4. As a user, I want interruption recovery to tolerate machine power loss, so that schedule-time persistence remains the source of truth.
5. As a user, I want cancellation information delivered with my next prompt, so that resuming a session does not start an unsolicited model turn.
6. As a user, I want the recovery message visible in the conversation, so that I can see why the agent knows about an interrupted wake.
7. As a user, I want the message to say the scheduled wake was interrupted and its timer will not be restored, so that it does not imply the underlying job or remote operation was cancelled.
8. As a user, I want the original reason preserved exactly, so that the agent retains the target, status check, and pending/completed actions.
9. As a user, I want the original deadline included, so that the agent can tell whether the planned check is overdue.
10. As a user, I want all interrupted wakes reported, so that multiple independently scheduled checks are not collapsed or lost.
11. As a user, I want multiple interrupted wakes summarized in one contextual message, so that recovery does not flood the conversation.
12. As a user, I want a cancellation message emitted only once, so that repeatedly resuming the session does not repeat stale notices.
13. As a user, I do not want completed wakes reported as cancelled, so that successful timer delivery remains authoritative.
14. As a user, I do not want cancelled timers automatically rearmed, so that old intent does not unexpectedly trigger after a long absence.
15. As a user, I want the agent to decide whether to inspect the target or schedule another wake, so that current external state controls the next action.
16. As a user, I want recovery scoped to the resumed branch, so that unrelated session branches do not leak wake state into one another.
17. As a user, I accept that an inherited pending wake may be reported independently on branches that each resume it, so that no cross-branch coordination store is required.
18. As a user, I want session startup to remain fast for large histories, so that durable wake recovery does not require a full branch scan.
19. As an agent, I want the cancellation message to identify each interrupted wake, so that I can address every target deliberately.
20. As an agent, I want the cancellation message to participate in model context, so that it is available when processing the next user prompt.
21. As an agent, I do not want cancellation recovery to trigger a turn by itself, so that I remain idle until the user submits a prompt.
22. As an extension maintainer, I want each wake identified by its existing tool-call ID, so that no separate identifier generator is needed.
23. As an extension maintainer, I want one complete pending-wake snapshot at each state transition, so that recovery reads the latest state instead of replaying the full event history.
24. As an extension maintainer, I want state snapshots excluded from LLM context, so that normal scheduling does not consume context tokens.
25. As an extension maintainer, I want a wake to remain pending until its custom message reaches Pi’s message lifecycle, so that queued follow-ups cannot be lost during shutdown.
26. As an extension maintainer, I want reverse traversal to use Pi’s indexed entry lookup, so that recovery costs only the entries since the latest wake marker.
27. As an extension maintainer, I want malformed or incompatible wake markers skipped safely, so that one bad extension entry does not prevent session startup.
28. As an extension maintainer, I want shutdown to clear runtime timer handles without persisting an empty snapshot, so that pending wakes remain discoverable after resume.
29. As an extension maintainer, I want the existing scheduling and firing behavior unchanged while Pi remains alive, so that durability does not alter normal wake semantics.
30. As an extension maintainer, I want the extension to remain process-agnostic, so that persistence does not expand into local or remote work management.

## Implementation Decisions

- Extend the Scheduled Wake module’s internal runtime state from timer handles alone to pending wake records keyed by wake ID.
- Use the Pi tool-call ID as the wake ID.
- A pending wake record contains the wake ID, the original reason, and an absolute deadline represented as epoch milliseconds.
- Preserve the reason byte-for-byte after using trimming only to reject blank input.
- Keep supporting multiple independent pending wakes.
- Define a wake-state marker as extension-owned session metadata containing the complete current pending-wake snapshot.
- Persist the first wake-state marker when a scheduling call adds its pending wake, before the tool returns successfully.
- Store normal wake-state markers as custom session entries so they persist but do not participate in LLM context.
- When a timer fires, send the existing visible Scheduled Wake custom message with the wake ID in message details, but retain the wake in pending state until Pi delivers that message.
- When Pi emits `message_end` for the Scheduled Wake custom message, remove that wake and persist a new complete pending-wake snapshot.
- Do not treat a fired custom message as a state marker because follow-up delivery may persist after newer scheduling checkpoints. Recovery ignores fired messages and reads the hidden checkpoint written when delivery completes.
- During session shutdown, clear every runtime timer handle. Do not persist an empty snapshot, a fired marker, or a cancellation marker during shutdown.
- Do not depend on `session_shutdown` for durable recovery because hard process termination cannot run it.
- During `session_start`, reconstruct wake state from the active session branch before the user’s next prompt is processed.
- Start recovery at the current leaf and follow parent IDs with indexed entry lookup. Stop at the first valid Scheduled Wake state entry or recovered-cancellation message.
- Do not use APIs that construct or copy the complete branch solely for wake recovery.
- If the latest marker has no pending wakes, perform no recovery action.
- If the latest marker has pending wakes, append one visible Scheduled Wake cancellation custom message listing every interrupted wake’s reason and deadline.
- Deliver the cancellation message with turn triggering disabled. It must persist in model context but must not start an agent run.
- State clearly in the cancellation content that the scheduled wakes were interrupted and their timers will not be restored; the extension has not inspected, stopped, or changed the underlying targets.
- Include the cancelled wake IDs and an empty pending snapshot in cancellation-message details.
- Treat the cancellation message as the terminal wake-state marker, preventing duplicate cancellation notices on subsequent resumes without requiring a second append.
- After recovery, leave runtime pending-wake state empty and do not recreate timers.
- If a recovered deadline is in the future, still report it as interrupted rather than rearming it; the timer belonged to the previous Pi process.
- If a marker has the expected custom type but malformed data, continue walking backward for the next valid marker rather than failing session startup.
- Keep state branch-local by traversing only the current leaf’s parent chain.
- Existing sessions created before durable wake-state markers are introduced receive no inferred cancellation notice; there is no migration based on historical tool results.
- Continue using Pi’s existing follow-up and turn-triggering semantics for timers that fire normally.
- Update package documentation to distinguish ephemeral runtime timers from durable interruption metadata.

## Testing Decisions

- Test at one existing high seam: load the extension through an ExtensionAPI-compatible harness, invoke the registered tool, drive lifecycle handlers and fake time, and observe persisted entries and outbound custom messages.
- Extend the current harness with an in-memory append-only session branch implementing leaf lookup, indexed entry lookup, custom entry append, and custom message capture. Do not expose or assert against the extension’s private map.
- Keep tests behavioral: describe scheduling, normal firing, shutdown, resume recovery, deduplication, branch selection, and delivery semantics rather than collection types or helper functions.
- Verify that scheduling persists a pending record with the tool-call ID, exact reason, and absolute deadline.
- Verify that scheduling multiple wakes persists a snapshot containing all pending wakes.
- Verify that a timer fire retains its wake in the latest checkpoint until the custom message is delivered.
- Verify that `message_end` for a Scheduled Wake removes only that wake and persists the remaining snapshot.
- Verify that a delivered wake is not reported as cancelled after resume, while a fired but undelivered follow-up remains recoverable.
- Verify that shutdown clears runtime timers without overwriting the last durable pending snapshot.
- Verify that resuming from one pending wake appends a visible cancellation custom message with turn triggering disabled.
- Verify that resuming from multiple pending wakes emits one message containing every reason and deadline.
- Verify that the cancellation message says the wake timers will not be restored and the underlying work was not changed.
- Verify that cancellation-message details contain an empty pending snapshot and the cancelled wake IDs.
- Verify that a second resume sees the cancellation marker and emits no duplicate message.
- Verify that recovery follows only the active branch.
- Verify that recovery stops at the newest valid wake-state marker and does not traverse older entries.
- Verify that malformed markers are skipped without preventing recovery from an earlier valid marker.
- Verify that no marker or an empty pending snapshot produces no cancellation message.
- Preserve all existing tests for delay validation, exact-once firing, multiple live timers, prompt guidance, termination, and shutdown idempotence.
- Continue using controllable runtime time; do not add a production clock interface solely for tests.

## Out of Scope

- Persisting or reviving executable timer handles across Pi processes.
- Automatically rearming interrupted timers.
- Triggering an agent turn during session recovery.
- Inspecting the current state of local jobs or remote targets during recovery.
- Starting, stopping, cancelling, or otherwise managing the underlying work.
- Guaranteeing a write after `SIGKILL`, a crash, or power loss; durability comes from state written before termination.
- Recovering wakes scheduled by package versions that did not write durable wake-state markers.
- Coordinating inherited wake state across separate session branches.
- Adding an external database, global state file, timer daemon, or process supervisor.
- Adding model-facing timer list, query, edit, or cancel operations.
- Changing normal timer delivery, follow-up ordering, or concurrent user-prompt semantics.
- Indexing arbitrary Pi custom entry types.

## Further Notes

- A **pending wake** is a scheduled check whose custom wake message has not yet completed Pi’s message lifecycle; its timer may be waiting or its follow-up may be queued.
- A **wake-state marker** is the latest complete pending-wake snapshot on the active branch.
- An **interrupted wake** is a pending wake whose owning Pi process ended before the wake message was delivered.
- A **cancellation message** reports interrupted scheduled wakes and non-restored timers to the model; it does not claim that underlying work was cancelled.
- Recovery is proportional to the number of session entries since the latest wake-state marker. It does not depend on model-context token size and does not construct the full branch.
- This design provides durable notification, not durable scheduling.
