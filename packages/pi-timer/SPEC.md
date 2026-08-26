# Agent Timer

## Problem Statement

Pi does not provide a built-in background Bash tool that can release the agent, retain ownership of a detached command, and later wake the agent when that command completes. A normal Bash tool call keeps the agent run active until its shell exits. A manually detached process lets the agent become idle, but Pi no longer tracks that process and cannot initiate a later agent run when it finishes.

Users need an agent to start local long-running work or wait on remote asynchronous conditions, become idle so normal conversation can continue, and later resume without another user prompt. They also want to avoid adding process supervision, remote polling, output capture, cancellation, and descendant cleanup to a Pi extension.

The work and the timer have different lifecycles. A process manager owns local background jobs—preferably zmx when available—while remote systems own remote asynchronous state such as Kubernetes pod readiness. Pi only remembers when the agent should wake and what state to inspect.

Pi shutdown, reload, session replacement, crashes, or power loss can destroy an in-memory timer or queued follow-up before its timer message reaches the agent. The resumed session must report those interrupted timers with the next user prompt without reviving their timers or triggering an unsolicited turn.

## Solution

Provide a project-local Pi extension with one model-callable capability: set a timer for a relative delay.

For local long-running commands, the agent launches a named job through zmx when available or another process manager, then includes its session or job name in the timer reason. For remote waits, the reason identifies the remote target, status check, and actions for pending and completed states. Scheduling returns immediately; when it is the only tool in its batch, its terminating result ends the current agent run.

When the timer expires, the extension injects a visible custom timer message into the same Pi session. If the agent is idle, Pi starts a new agent run without user input. If an agent run is already active, Pi queues the timer message as a follow-up and delivers it after the active work settles.

A timer is advisory: it means “inspect the target’s current state,” not “the work has completed.” If the local job or remote condition is still pending, the agent sets another timer. If it has completed, the agent inspects and reports the result.

Each scheduling and delivery transition persists a complete pending-timer snapshot in the session. On session start, the extension reads the newest branch-local snapshot. Any unresolved timers are summarized in one visible interruption message that joins model context but does not trigger a turn; the message records an empty snapshot to prevent duplicate notices.

## User Stories

1. As a user, I want the agent to launch long-running work without occupying the active agent run, so that I can continue using Pi.
2. As a user, I want to submit unrelated prompts while a managed local job runs, so that background work does not block the conversation.
3. As a user, I want the agent to wake without another prompt from me, so that background work is eventually revisited even if I stop interacting.
4. As a user, I want my prompt to be preserved if it arrives when a timer fires, so that scheduled work never loses user input.
5. As a user, I want an active user-requested turn to finish before a pending timer is handled, so that the timer message does not interrupt tool execution already in progress.
6. As a user, I accept that a timer and prompt arriving together may be processed in either order, so long as both are eventually handled safely.
7. As a user, I want timer processing to inspect current job state, so that event ordering cannot cause the agent to make stale assumptions.
8. As a user, I want the timer notification to be visible in the conversation, so that I can understand why the agent resumed by itself.
9. As a user, I want timer notifications to be distinguishable from messages I typed, so that Pi does not impersonate me.
10. As a user, I want the agent to report a completed local job’s result, so that long-running work reaches a useful conclusion.
11. As a user, I want the agent to schedule another check when a local job is still running, so that unknown job durations are supported.
12. As a user, I accept that a job completing early may not be noticed until the next timer, so that Pi does not need to monitor processes.
13. As a user, I want an external process manager to remain responsible for status, logs, interaction, and cancellation, so that Pi does not duplicate it.
14. As a user, I want local background jobs launched through zmx when available or another process manager rather than raw shell detachment, so that they have an explicit lifecycle owner.
15. As a user, I do not want Pi to kill managed jobs merely because a timer is cleared, so that process and timer lifecycles remain independent.
16. As a user, I expect pending timers to stop when their Pi session shuts down, so that an obsolete session cannot resume unexpectedly.
17. As a user, I want unresolved timers reported when I next prompt a resumed session, so that Pi shutdown does not silently lose planned checks.
18. As a user, I want a delayed timer to fire after Pi becomes responsive again if the event loop or computer was temporarily suspended, so that elapsed timers are not silently discarded during a live session.
19. As an agent, I want to set a timer with a relative delay, so that I can choose an appropriate polling interval for each job.
20. As an agent, I want to attach a self-contained reason to a timer, so that I know which local job or remote target to inspect after intervening turns or context compaction.
21. As an agent, I want scheduling to end my current run, so that I do not immediately poll the job I just launched.
22. As an agent, I want the timer reason to tell me what to do if the target is pending or completed, so that resumption is deterministic.
23. As an agent, I want multiple independent timers to remain possible, so that separate background activities do not overwrite one another.
24. As an agent, I want invalid delays or empty reasons rejected at the tool interface, so that unusable timers are not silently accepted.
25. As an agent, I want timer expiration to deliver a custom contextual message rather than a user-role message, so that provenance remains accurate.
26. As an extension maintainer, I want the extension to own only timers and serializable timer metadata, so that process lifecycle complexity remains outside the module.
27. As an extension maintainer, I want delivered timers removed from runtime and persisted pending state, so that repeated scheduling does not leak records.
28. As an extension maintainer, I want all pending timers cleared during session shutdown, so that callbacks cannot target a stale session.
29. As an extension maintainer, I want timer delivery to use Pi’s existing follow-up queue, so that the extension does not implement its own concurrency queue or lock.
30. As an extension maintainer, I want the behavior to remain correct regardless of whether a user prompt or timer event wins an ordering race, so that no strict total ordering is required.
31. As an extension maintainer, I want to rely on Pi’s agent-run serialization, so that the extension never starts or coordinates concurrent model loops itself.
32. As an extension maintainer, I want the model-facing interface to remain limited to setting a timer, so that timer listing, explicit cancellation, process inspection, and job registries remain deferred until demonstrated needs arise.
33. As a user, I want timers to revisit remote asynchronous conditions such as Kubernetes pod readiness, so that the feature is useful even when no local process exists.

## Implementation Decisions

- Build a Timer extension as a single deep module. Its interface exposes scheduling; its implementation hides timer creation, timer-message construction, delivery, expiration, and session cleanup.
- Register one model-callable tool named `set_timer`.
- The tool reads as `set_timer(seconds, reason)`: `seconds` is a positive relative delay and `reason` is non-empty and self-contained.
- The delay represents a minimum wait. Runtime scheduling, event-loop load, process suspension, or computer sleep may cause the timer to fire later.
- Validate the delay against the runtime timer’s supported range. Reject non-finite, non-positive, or unsupported values rather than silently coercing them.
- Prompt guidance requires the reason to name the target, describe the status check, and state what to do for pending and completed states; managed local work must include its process-manager session or job name. Runtime validation keeps the reason opaque and rejects only blank text.
- Add a succinct agent instruction preferring named zmx sessions for local long-running commands when zmx is available, otherwise allowing another process manager. Unmanaged raw `&` and `nohup` are not the supported local workflow.
- Add an agent instruction allowing `set_timer` for remote asynchronous conditions such as Kubernetes pod readiness, without requiring a local process.
- Add an agent instruction requiring `set_timer` to be called alone after all other work in the current run is complete.
- Add an agent instruction clarifying that a timer means “check the target,” not “the work has completed,” and to reschedule only while the target remains pending.
- Scheduling creates an in-memory runtime timer and returns immediately.
- The scheduling tool returns a terminating result so Pi skips the automatic post-tool model call when all finalized results in that tool batch are terminating.
- The tool’s instruction should discourage combining `set_timer` with unrelated parallel tool calls because a non-terminating result in the same tool batch prevents early termination.
- Each scheduling call creates an independent pending timer identified by its tool-call ID and records the original reason, absolute deadline, and runtime timer handle.
- Scheduling appends a custom state entry containing the complete pending-timer snapshot before returning. Custom state entries persist in the session but do not enter LLM context.
- Timer expiration sends the timer ID in custom-message details but keeps the timer pending until Pi emits `message_end` for that custom message.
- On Timer `message_end`, remove the delivered timer and append the new complete pending-timer snapshot. This keeps a queued but undelivered follow-up recoverable.
- Timer expiration injects a custom message with a dedicated Timer message type, the original reason as model context, and visible display enabled.
- Timer delivery sets `triggerTurn` so an idle session begins an agent run without user input.
- Timer delivery uses follow-up delivery so a timer that fires during active work waits until that work has no remaining tool calls.
- The extension does not send a user-role message because the timer message was generated by the system rather than the user.
- The extension relies on Pi’s existing session and follow-up queue as the concurrency seam. It does not add a mutex, input arbiter, or second work queue.
- A timer and user prompt that arrive nearly together have nondeterministic ordering. Correctness depends only on eventual delivery of both inputs and an idempotent target-state check.
- The chosen process manager is the sole owner and source of truth for local background process lifecycle, status, logs, interaction, cancellation, and cleanup. Remote systems remain the source of truth for their own asynchronous state.
- The extension never starts, tracks, polls, signals, or kills a process and never interprets a process-manager session or job identifier.
- Runtime timer lifecycle is session-scoped. Session shutdown clears all timer handles and runtime timer records without writing an empty checkpoint, preventing callbacks while preserving evidence of unresolved timers.
- Timer handles remain ephemeral and are never restored. Serializable pending-timer metadata persists only in Pi’s session history so a resumed session can report interruption.
- On session start, walk backward from the active leaf through indexed parent lookups and stop at the newest valid state checkpoint or interruption message. Do not construct the complete branch.
- Skip malformed markers rather than failing session startup.
- If unresolved timers exist, append one visible interruption message containing their original reasons and deadlines with turn triggering disabled. Its details contain the cancelled timer IDs and an empty pending snapshot, making it the terminal marker for later resumes.
- Do not rearm recovered timers, including those whose deadlines are still in the future.
- A managed local job may continue after its associated Pi timer or session ends. Stopping or retaining that job follows its process manager’s semantics, not Timer semantics.
- Delivery failures are reported through Pi’s extension error reporting. The extension does not retry in the same runtime; an undelivered timer message remains in the latest checkpoint and is reported if the session is resumed.

## Testing Decisions

- Test at one high seam: load the extension through an ExtensionAPI-compatible harness, invoke the registered tool, drive lifecycle handlers and fake time, and observe persisted session entries and outbound Pi messages. Do not test private collections or helpers directly.
- Treat the tool interface, lifecycle events, persisted checkpoints, and emitted custom messages as the behavioral test surface. Tests should describe scheduling, delivery, shutdown, and recovery rather than implementation collection types.
- Use controllable runtime time in tests so delays can be advanced deterministically without waiting on wall-clock time. Do not add a production clock interface solely for testing if the existing test environment can control timers.
- Verify that a valid scheduling request returns immediately with a terminating tool result.
- Verify that no timer message is emitted before the requested delay has elapsed.
- Verify that exactly one visible custom timer message is emitted after the delay and contains the original reason.
- Verify that the timer message requests both turn triggering and follow-up delivery.
- Verify that an expired timer cannot emit a second message.
- Verify that multiple scheduling calls produce independent timer messages rather than replacing one another.
- Verify that scheduling persists complete snapshots with timer IDs, exact reasons, and deadlines.
- Verify that a fired timer remains pending until its custom message reaches `message_end`, then persists the remaining snapshot.
- Verify that shutdown stops runtime timers without overwriting the latest pending snapshot.
- Verify that resume aggregates every unresolved timer into one visible interruption message with turn triggering disabled.
- Verify that the interruption marker prevents duplicate notices and that delivered timers are not later reported as cancelled.
- Verify that recovery stays on the active branch, stops at the newest valid marker, and safely skips malformed state.
- Verify that session shutdown prevents every pending timer from emitting a timer message.
- Verify that shutdown remains safe when no timers are pending and when called more than once.
- Verify rejection of zero, negative, non-finite, and runtime-unsupported delays.
- Verify rejection of an empty reason.
- Do not re-test Pi’s internal follow-up ordering or model-run serialization. At the extension seam, verify that the timer message requests `triggerTurn` and follow-up delivery; Pi’s documented message-delivery contract owns idle and active-run routing.
- Use Pi’s file-trigger example as prior art for injecting an external custom message that triggers an idle turn.
- Use Pi’s terminating-tool example as prior art for ending an agent run after a tool result.
- Use the repository’s existing test runner if implementation is added to an established project. If this remains standalone, prefer the smallest runtime-supported test setup and do not add a test framework solely for this extension.

## Out of Scope

- Starting background processes from the Timer extension.
- Implementing a background Bash tool.
- Replacing or wrapping process management.
- Installing or configuring zmx or another process manager.
- Detecting exact process completion.
- Watching process-manager output, files, sockets, webhooks, or process exit events.
- Automatically polling local jobs or remote targets from the extension.
- Capturing, storing, truncating, or rendering process output.
- Killing processes or process groups when Pi shuts down.
- Persistent timers that survive Pi exit, reload, crash, fork, resume, or session replacement.
- Calendar schedules, cron expressions, absolute wall-clock deadlines, or recurring timers.
- Listing, cancelling, editing, deduplicating, or coalescing pending timers.
- Guaranteeing exact firing time while the event loop is blocked or the computer is asleep.
- Guaranteeing that a user prompt always wins an ordering race with a timer.
- Adding a custom concurrency queue, lock, or input arbiter.
- Rate limiting or quotas for model-set timers unless actual misuse demonstrates the need.
- Cross-session or cross-process timer delivery.
- Non-LLM desktop notifications.

## Further Notes

- “Timer” is the domain term for the timer and resulting custom message. It is not a job, completion event, reminder service, or process supervisor.
- “Managed local job” is background work owned by zmx when available or another process manager. Its lifecycle remains independent of the Pi session.
- “Remote target” is an asynchronous condition owned by an external system, such as Kubernetes pod readiness.
- The key invariant is that every timer causes the agent to read current target state. Neither elapsed time nor message order is evidence that work completed.
- The design intentionally accepts delayed observation: local or remote work may complete well before the next timer.
- A managed local job and its pending-timer metadata can outlive Pi, but the runtime timer cannot; resume reports the interruption instead of restoring the timer.
- If stale timers become costly, cancellation can be considered as a separate interface change. If polling latency becomes costly, an external completion signal can be considered without transferring process ownership into this extension.
- This package specification is maintained alongside the extension; implementation-specific work may also be tracked under the repository’s local `.scratch/` issue tracker.
