# Scheduled Agent Wake

## Problem Statement

Pi does not provide a built-in background Bash tool that can release the agent, retain ownership of a detached command, and later wake the agent when that command completes. A normal Bash tool call keeps the agent run active until its shell exits. A manually detached process lets the agent become idle, but Pi no longer tracks that process and cannot initiate a later agent run when it finishes.

Users need an agent to start local long-running work or wait on remote asynchronous conditions, become idle so normal conversation can continue, and later resume without another user prompt. They also want to avoid adding process supervision, remote polling, output capture, cancellation, and descendant cleanup to a Pi extension.

The work and the wake-up have different lifecycles. A process manager owns local background jobs—preferably zmx when available—while remote systems own remote asynchronous state such as Kubernetes pod readiness. Pi only remembers when the agent should wake and what state to inspect.

## Solution

Provide a project-local Pi extension with one model-callable capability: schedule an agent wake after a relative delay.

For local long-running commands, the agent launches a named job through zmx when available or another process manager, then includes its session or job name in the wake reason. For remote waits, the reason identifies the remote target, status check, and actions for pending and completed states. Scheduling returns immediately; when it is the only tool in its batch, its terminating result ends the current agent run.

When the timer expires, the extension injects a visible custom wake message into the same Pi session. If the agent is idle, Pi starts a new agent run without user input. If an agent run is already active, Pi queues the wake as a follow-up and delivers it after the active work settles.

A wake is advisory: it means “inspect the target’s current state,” not “the work has completed.” If the local job or remote condition is still pending, the agent schedules another wake. If it has completed, the agent inspects and reports the result.

## User Stories

1. As a user, I want the agent to launch long-running work without occupying the active agent run, so that I can continue using Pi.
2. As a user, I want to submit unrelated prompts while a managed local job runs, so that background work does not block the conversation.
3. As a user, I want the agent to wake without another prompt from me, so that background work is eventually revisited even if I stop interacting.
4. As a user, I want my prompt to be preserved if it arrives when a timer fires, so that scheduled work never loses user input.
5. As a user, I want an active user-requested turn to finish before a pending scheduled wake is handled, so that the wake does not interrupt tool execution already in progress.
6. As a user, I accept that a timer and prompt arriving together may be processed in either order, so long as both are eventually handled safely.
7. As a user, I want wake processing to inspect current job state, so that event ordering cannot cause the agent to make stale assumptions.
8. As a user, I want the wake notification to be visible in the conversation, so that I can understand why the agent resumed by itself.
9. As a user, I want scheduled wake notifications to be distinguishable from messages I typed, so that Pi does not impersonate me.
10. As a user, I want the agent to report a completed local job’s result, so that long-running work reaches a useful conclusion.
11. As a user, I want the agent to schedule another check when a local job is still running, so that unknown job durations are supported.
12. As a user, I accept that a job completing early may not be noticed until the next scheduled wake, so that Pi does not need to monitor processes.
13. As a user, I want an external process manager to remain responsible for status, logs, interaction, and cancellation, so that Pi does not duplicate it.
14. As a user, I want local background jobs launched through zmx when available or another process manager rather than raw shell detachment, so that they have an explicit lifecycle owner.
15. As a user, I do not want Pi to kill managed jobs merely because a wake timer is cleared, so that process and timer lifecycles remain independent.
16. As a user, I expect pending wakes to stop when their Pi session shuts down, so that an obsolete session cannot resume unexpectedly.
17. As a user, I accept that pending wakes do not survive Pi exit, extension reload, session replacement, resume, or fork, so that the first version can remain in-memory and simple.
18. As a user, I want a delayed wake to fire after Pi becomes responsive again if the event loop or computer was temporarily suspended, so that elapsed timers are not silently discarded during a live session.
19. As an agent, I want to schedule a wake with a relative delay, so that I can choose an appropriate polling interval for each job.
20. As an agent, I want to attach a self-contained reason to a wake, so that I know which local job or remote target to inspect after intervening turns or context compaction.
21. As an agent, I want scheduling to end my current run, so that I do not immediately poll the job I just launched.
22. As an agent, I want the wake reason to tell me what to do if the target is pending or completed, so that resumption is deterministic.
23. As an agent, I want multiple independently scheduled wakes to remain possible, so that separate background activities do not overwrite one another.
24. As an agent, I want invalid delays or empty reasons rejected at the tool interface, so that unusable timers are not silently accepted.
25. As an agent, I want timer expiration to deliver a custom contextual message rather than a user-role message, so that provenance remains accurate.
26. As an extension maintainer, I want the extension to own only timer handles, so that process lifecycle complexity remains outside the module.
27. As an extension maintainer, I want expired timers removed from memory, so that repeated scheduling does not leak handles.
28. As an extension maintainer, I want all pending timers cleared during session shutdown, so that callbacks cannot target a stale session.
29. As an extension maintainer, I want timer delivery to use Pi’s existing follow-up queue, so that the extension does not implement its own concurrency queue or lock.
30. As an extension maintainer, I want the behavior to remain correct regardless of whether a user prompt or timer event wins an ordering race, so that no strict total ordering is required.
31. As an extension maintainer, I want to rely on Pi’s agent-run serialization, so that the extension never starts or coordinates concurrent model loops itself.
32. As an extension maintainer, I want the production interface to remain limited to scheduling a wake, so that cancellation, persistence, process inspection, and job registries can be deferred until demonstrated needs arise.
33. As a user, I want scheduled wakes to revisit remote asynchronous conditions such as Kubernetes pod readiness, so that the feature is useful even when no local process exists.

## Implementation Decisions

- Build a Scheduled Wake extension as a single deep module. Its interface exposes scheduling; its implementation hides timer creation, wake-message construction, delivery, expiration, and session cleanup.
- Register one model-callable tool named `schedule_wake`.
- The tool accepts a positive relative delay in seconds and a non-empty, self-contained reason.
- The delay represents a minimum wait. Runtime scheduling, event-loop load, process suspension, or computer sleep may cause the wake to occur later.
- Validate the delay against the runtime timer’s supported range. Reject non-finite, non-positive, or unsupported values rather than silently coercing them.
- Prompt guidance requires the reason to name the target, describe the status check, and state what to do for pending and completed states; managed local work must include its process-manager session or job name. Runtime validation keeps the reason opaque and rejects only blank text.
- Add a succinct agent instruction preferring named zmx sessions for local long-running commands when zmx is available, otherwise allowing another process manager. Unmanaged raw `&` and `nohup` are not the supported local workflow.
- Add an agent instruction allowing `schedule_wake` for remote asynchronous conditions such as Kubernetes pod readiness, without requiring a local process.
- Add an agent instruction requiring `schedule_wake` to be called alone after all other work in the current run is complete.
- Add an agent instruction clarifying that a scheduled wake means “check the target,” not “the work has completed,” and to reschedule only while the target remains pending.
- Scheduling creates an in-memory runtime timer and returns immediately.
- The scheduling tool returns a terminating result so Pi skips the automatic post-tool model call when all finalized results in that tool batch are terminating.
- The tool’s instruction should discourage combining `schedule_wake` with unrelated parallel tool calls because a non-terminating result in the same tool batch prevents early termination.
- Each scheduling call creates an independent pending wake. The extension retains only the timer handles required for expiration and shutdown cleanup.
- An expired timer removes its own handle before attempting message delivery.
- Timer expiration injects a custom message with a dedicated Scheduled Wake message type, the original reason as model context, and visible display enabled.
- Timer delivery sets `triggerTurn` so an idle session begins an agent run without user input.
- Timer delivery uses follow-up delivery so a wake that fires during active work waits until that work has no remaining tool calls.
- The extension does not send a user-role message because the wake was generated by the system rather than the user.
- The extension relies on Pi’s existing session and follow-up queue as the concurrency seam. It does not add a mutex, input arbiter, or second work queue.
- A timer and user prompt that arrive nearly together have nondeterministic ordering. Correctness depends only on eventual delivery of both inputs and an idempotent target-state check.
- The chosen process manager is the sole owner and source of truth for local background process lifecycle, status, logs, interaction, cancellation, and cleanup. Remote systems remain the source of truth for their own asynchronous state.
- The extension never starts, tracks, polls, signals, or kills a process and never interprets a process-manager session or job identifier.
- Timer lifecycle is session-scoped. Session shutdown clears all pending timers and prevents their callbacks from injecting later messages into the obsolete session.
- Pending wakes are intentionally ephemeral. They are not persisted to session entries, project files, or external storage and are not restored after restart or session replacement.
- A managed local job may continue after its associated Pi timer or session ends. Stopping or retaining that job follows its process manager’s semantics, not Scheduled Wake semantics.
- Delivery failures are reported through Pi’s extension error reporting. The first version does not retry failed wake delivery because retry durability would require persistent state.

## Testing Decisions

- Test at one high seam: invoke the registered `schedule_wake` tool through an ExtensionAPI-compatible harness and observe its tool result and outbound Pi message. Do not test private timer collections or helper functions directly.
- Treat the tool interface and emitted wake message as the behavioral test surface. Tests should describe user-visible scheduling, termination, delivery, and cleanup behavior rather than implementation details such as collection types.
- Use controllable runtime time in tests so delays can be advanced deterministically without waiting on wall-clock time. Do not add a production clock interface solely for testing if the existing test environment can control timers.
- Verify that a valid scheduling request returns immediately with a terminating tool result.
- Verify that no wake message is emitted before the requested delay has elapsed.
- Verify that exactly one visible custom wake message is emitted after the delay and contains the original reason.
- Verify that the wake message requests both turn triggering and follow-up delivery.
- Verify that an expired timer cannot emit a second message.
- Verify that multiple scheduling calls produce independent wake messages rather than replacing one another.
- Verify that session shutdown prevents every pending timer from emitting a wake message.
- Verify that shutdown remains safe when no timers are pending and when called more than once.
- Verify rejection of zero, negative, non-finite, and runtime-unsupported delays.
- Verify rejection of an empty reason.
- Do not re-test Pi’s internal follow-up ordering or model-run serialization. At the extension seam, verify that the wake requests `triggerTurn` and follow-up delivery; Pi’s documented message-delivery contract owns idle and active-run routing.
- Use Pi’s file-trigger example as prior art for injecting an external custom message that triggers an idle turn.
- Use Pi’s terminating-tool example as prior art for ending an agent run after a tool result.
- Use the repository’s existing test runner if implementation is added to an established project. If this remains standalone, prefer the smallest runtime-supported test setup and do not add a test framework solely for this extension.

## Out of Scope

- Starting background processes from the Scheduled Wake extension.
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
- Listing, cancelling, editing, deduplicating, or coalescing pending wakes.
- Guaranteeing exact wake time while the event loop is blocked or the computer is asleep.
- Guaranteeing that a user prompt always wins an ordering race with a timer.
- Adding a custom concurrency queue, lock, or input arbiter.
- Rate limiting or quotas for model-scheduled wakes unless actual misuse demonstrates the need.
- Cross-session or cross-process wake delivery.
- Non-LLM desktop notifications.

## Further Notes

- “Scheduled wake” is the domain term for the timer and resulting custom message. It is not a job, completion event, reminder service, or process supervisor.
- “Managed local job” is background work owned by zmx when available or another process manager. Its lifecycle remains independent of the Pi session.
- “Remote target” is an asynchronous condition owned by an external system, such as Kubernetes pod readiness.
- The key invariant is that every wake causes the agent to read current target state. Neither elapsed time nor message order is evidence that work completed.
- The design intentionally accepts delayed observation: local or remote work may complete well before the next wake.
- The design also intentionally accepts that a managed local job can outlive Pi while its pending wake cannot.
- If stale wake-ups become costly, cancellation can be considered as a separate interface change. If polling latency becomes costly, an external completion signal can be considered without transferring process ownership into this extension.
- This specification is local-only as requested and is not published to an issue tracker.
