# In-Process Background Subagents

## Problem Statement

Pi users need a small, dependable way to delegate independent work to background subagents without launching external Pi processes, blocking the parent session, or carrying the parent conversation into every delegated task.

The parent agent currently has no focused interface for starting a named child session, seeing that work is still active, redirecting it, receiving intentional progress, answering a blocking question, or stopping it. Without such an interface, background delegation either requires process-management and RPC plumbing or grows into a large orchestration system with result polling, retained child sessions, custom terminal displays, and speculative scheduling behavior.

Users also need parent and child agents to coexist safely in one working directory. A child that mistakes itself for the parent, broadens the delegated scope, or acts on stale assumptions can overwrite or revert concurrent work. The extension must make the parent-child relationship explicit, keep the delegated task narrow, preserve inherited write capability, and make conflicts fail visibly instead of resolving them destructively.

The first version needs only fresh child sessions. Forking the parent conversation has unresolved product and safety questions and must not complicate the initial interface.

## Solution

Add a `pi-subagents` extension that creates independent Pi `AgentSession` children inside the parent Pi process. Each subagent starts with a fresh conversation, while inheriting the parent session's effective system prompt, working directory, active work tools, extensions, skills, and selected model configuration. A child-specific role contract tells the subagent that it is subordinate to an authoritative parent, that the workspace is shared, and that it must perform only its delegated task.

The parent launches a uniquely named subagent with the `subagent` tool. Launches are always background-only and return immediately. The parent can send a message with `message_subagent` or stop active work with `kill_subagent`. Each child receives a private `message_parent` tool for non-blocking progress reports and blocking questions.

The extension displays active names in Pi's existing footer status area. A waiting subagent is marked with `?`. Progress is delivered visibly without triggering a parent turn. Questions wake the parent and keep the child tool call blocked until the parent answers. Natural completion and failure write a private temporary `result.md`, wake the parent exactly once with a bounded preview and result path, and then dispose the child session automatically.

The first version supports at most four active subagents, rejects excess launches instead of queueing them, exposes no result-polling or resume tool, and provides no external Zellij or ZMX display.

## User Stories

1. As a Pi user, I want to launch a named background subagent, so that I can delegate a bounded task without leaving my parent session.
2. As a Pi user, I want a launch to return immediately, so that the parent session does not block on delegated work.
3. As a Pi user, I want the parent run to settle after launching a subagent, so that it does not waste a model turn while waiting for background work.
4. As a Pi user, I want each subagent name chosen at launch, so that I can recognize and address the work later.
5. As a Pi user, I want active subagent names to be unique, so that messages and kill requests cannot target an ambiguous child.
6. As a Pi user, I want to reuse a name after its previous subagent has terminated, so that names do not become permanently reserved.
7. As a Pi user, I want every first-version subagent to start with a fresh conversation, so that delegation behavior is simple and predictable.
8. As a Pi user, I want the absence of parent conversation history to be explicit, so that a fresh child does not assume decisions it never received.
9. As a Pi user, I want the delegated task to be the child's final user message, so that its immediate responsibility is unambiguous.
10. As a Pi user, I want the delegated task visibly delimited from inherited instructions, so that the child does not broaden its scope.
11. As a Pi user, I want a fresh child to inherit the parent working directory, so that it operates on the same project.
12. As a Pi user, I want a fresh child to inherit the parent effective system prompt, so that repository and agent guidance remain consistent.
13. As a Pi user, I want a fresh child to inherit the parent's extensions and skills, so that it has the same project capabilities.
14. As a Pi user, I want a fresh child to inherit the parent's active work tools, so that delegated work does not require a second tool configuration.
15. As a Pi user, I want subagent-management tools excluded from children, so that children cannot recursively create or control more subagents.
16. As a Pi user, I want each child to have a private parent-communication tool, so that it can intentionally report progress or ask for guidance.
17. As a Pi user, I want children to understand that the parent remains authoritative, so that they do not behave as the main agent.
18. As a Pi user, I want children to understand that the workspace is shared, so that they account for concurrent work.
19. As a Pi user, I want children to inspect current file contents before changing them, so that stale assumptions are less likely to overwrite newer work.
20. As a Pi user, I want children to modify files only when implementation is explicitly delegated, so that investigative tasks remain non-destructive.
21. As a Pi user, I want children never to revert unrelated changes, so that parent and sibling work is preserved.
22. As a Pi user, I want a child that detects conflicting work to stop and report it, so that conflict resolution remains with the parent.
23. As a Pi user, I want the parent to avoid changing a delegated scope while its child is active, so that shared-workspace conflicts are less likely.
24. As a Pi user, I want to select an optional model profile at launch, so that different tasks can use an appropriate configured model and thinking level.
25. As a Pi user, I want `inherit` to be the default model profile, so that normal delegation uses the parent model and thinking level without configuration.
26. As a Pi user, I want `low`, `medium`, `high`, and `xhigh` profiles, so that I can configure stable capability tiers without exposing provider-specific model IDs in every call.
27. As a Pi user, I want an invalid or unconfigured model profile rejected clearly, so that the extension never silently runs an unintended model.
28. As a Pi user, I want model profiles stored in Pi's global agent configuration, so that they are consistent across projects in the first version.
29. As a Pi user, I want no project-level profile override initially, so that repository-controlled files cannot unexpectedly change subagent cost or capability.
30. As a Pi user, I want no more than four active subagents, so that accidental fan-out cannot consume unbounded resources or model budget.
31. As a Pi user, I want a fifth launch rejected with the active names, so that overload is explicit and actionable.
32. As a Pi user, I want excess work rejected rather than queued, so that the first version has no hidden scheduler or delayed execution semantics.
33. As a Pi user, I want to send a message to an active subagent by name, so that I can redirect or clarify its work.
34. As a Pi user, I want a normal parent message delivered using Pi's steering semantics, so that it reaches the child after its current tool execution.
35. As a Pi user, I want a message sent while a child is starting handled without targeting the wrong session, so that fast follow-up guidance remains safe.
36. As a Pi user, I want a message to an inactive name rejected, so that I know the child can no longer receive guidance.
37. As a Pi user, I want a child to report meaningful progress, so that the parent can learn what has been accomplished before final completion.
38. As a Pi user, I want progress reports to be visible in the parent conversation, so that I can observe intentional milestones.
39. As a Pi user, I want progress reports to enter future parent model context, so that the parent can use them on its next turn.
40. As a Pi user, I do not want progress reports to wake the parent, so that routine milestones do not create unsolicited model calls.
41. As a Pi user, I want progress reporting to be non-blocking, so that the child can continue working immediately.
42. As a Pi user, I want children instructed to report only meaningful milestones, so that progress does not become a noisy tool-by-tool transcript.
43. As a Pi user, I want a child to ask the parent a blocking question, so that ambiguous work does not force the child to guess.
44. As a Pi user, I want a child question to be visible in the parent conversation, so that I can understand what is blocking it.
45. As a Pi user, I want a child question to wake the parent, so that the parent can answer while the child is waiting.
46. As a Pi user, I want the child to remain blocked until its question is answered, so that it cannot complete or act on an assumption first.
47. As a Pi user, I want the parent to answer a question through the same message tool used for steering, so that parent-to-child communication has one interface.
48. As a Pi user, I want an answer to resolve the pending child tool call directly, so that it does not deadlock behind Pi's steering delivery boundary.
49. As a Pi user, I want a parent message to steer normally when no question is pending, so that one tool covers both answers and unsolicited guidance.
50. As a Pi user, I want at most one pending question per child, so that replies cannot be matched ambiguously.
51. As a Pi user, I want no automatic question timeout initially, so that the extension does not invent an answer or termination policy.
52. As a Pi user, I want to kill a child that is waiting indefinitely, so that unanswered questions do not permanently consume an active slot.
53. As a Pi user, I want a waiting child marked with `?` in the footer, so that blocked work is visible without a larger widget.
54. As a Pi user, I want to kill an active subagent by name, so that I can stop work I no longer need.
55. As a Pi user, I want kill to abort and dispose the in-process child cooperatively, so that its resources are released through Pi lifecycle hooks.
56. As a Pi user, I want the cooperative limitation stated clearly, so that `kill_subagent` is not mistaken for OS-level force termination.
57. As a Pi user, I want killing a child to reject any pending parent question, so that no blocked communication promise leaks.
58. As a Pi user, I do not want a second completion wake after a deliberate kill, so that the kill tool result remains the single acknowledgement.
59. As a Pi user, I want natural completion to wake the parent exactly once, so that results are handled promptly without duplicate turns.
60. As a Pi user, I want child failure to wake the parent exactly once, so that background errors are not silent.
61. As a Pi user, I want completion and failure to wait until an active parent run settles, so that child notifications do not interrupt a parent tool batch.
62. As a Pi user, I want completion to trigger immediately when the parent is idle, so that finished work does not wait for another user prompt.
63. As a Pi user, I want each terminal result written to a private temporary Markdown file, so that the parent can inspect the full result without a dedicated retrieval tool.
64. As a Pi user, I want the result file to include the subagent name, terminal status, selected model profile, and delegated task, so that it remains understandable on its own.
65. As a Pi user, I want the successful result to contain the terminal assistant message's visible text verbatim, so that the extension does not summarize or reinterpret the child.
66. As a Pi user, I want multiple visible text blocks preserved in order, so that structured final answers are not scrambled.
67. As a Pi user, I do not want thinking blocks in the result file, so that hidden reasoning is not persisted as user-facing output.
68. As a Pi user, I do not want tool calls, tool results, provider metadata, inherited instructions, or the full child transcript in the result file, so that it stays focused.
69. As a Pi user, I want a failed result file to include the error and any terminal partial text, so that failure diagnosis has useful context.
70. As a Pi user, I want a killed result file to include available partial text, so that completed work is not discarded unnecessarily.
71. As a Pi user, I want an explicit placeholder when no final textual result exists, so that an empty file is not mistaken for write failure.
72. As a Pi user, I want the completion message to include a bounded result preview and the result path, so that the parent can decide whether to read the full file.
73. As a Pi user, I do not want a `get_result` tool, so that result delivery remains push-based and the interface stays small.
74. As a Pi user, I want the extension to dispose a terminal child automatically, so that cleanup is not another parent obligation.
75. As a Pi user, I want terminal child context released after the result is durable, so that completed model history and extension state do not accumulate.
76. As a Pi user, I want the temporary result file to survive child disposal, so that the parent can read it after being notified.
77. As a Pi user, I want result files left to operating-system temporary-file cleanup, so that the extension needs no retention database or consumption tracking.
78. As a Pi user, I want the child name reusable immediately after finalization, so that disposal has a clear externally visible boundary.
79. As a Pi user, I want active subagent names shown in Pi's existing footer, so that background work is visible without another terminal or panel.
80. As a Pi user, I want the footer to show up to three names and a `+N` remainder, so that it remains compact.
81. As a Pi user, I want the footer status cleared when no child is active, so that the extension leaves no permanent clutter.
82. As a Pi user, I want progress to leave the compact footer unchanged, so that it remains an activity indicator rather than a log.
83. As a Pi user, I want parent session shutdown, switching, and reload to abort and dispose every child, so that no child session outlives its owner.
84. As a Pi user, I want child extension shutdown hooks run before disposal, so that child-owned resources can close cleanly.
85. As a Pi user, I want the tools to remain functional in non-TUI Pi modes, so that background delegation is not coupled to footer rendering.
86. As a Pi user, I accept that the footer indicator is TUI-only, so that headless modes do not require a replacement display.
87. As an extension maintainer, I want child sessions created through Pi's public SDK, so that the extension does not reimplement the agent loop.
88. As an extension maintainer, I want child sessions to use in-memory conversation storage, so that the extension persists only its deliberate result contract.
89. As an extension maintainer, I want one idempotent finalization path for completion, failure, and kill, so that results, notifications, status, and disposal happen once.
90. As an extension maintainer, I want Pi `0.84.2` to be the initial compatibility target, so that the implementation does not carry speculative SDK-version adapters.

## Implementation Decisions

- Add a new `pi-subagents` package to the monorepo and register its extension in the repository's installable extension manifest.
- Expose three parent-session tools: `subagent`, `message_subagent`, and `kill_subagent`.
- `subagent` requires a caller-selected `name` and `prompt`. It accepts an optional `model_profile` whose default is `inherit`.
- Do not expose a context or inheritance parameter in the first version. Every child begins with no parent conversation messages.
- Restrict `model_profile` to `inherit`, `low`, `medium`, `high`, and `xhigh`.
- Load model profile definitions from a global `subagents.json` in Pi's agent configuration directory. Each configured profile resolves to a model and thinking level. Do not load project-level profile overrides in the first version.
- Resolve `inherit` from the parent session's current model and thinking level. Reject unavailable models, unsupported profile definitions, and named profiles that are not configured rather than silently falling back.
- Create each child as an independent in-process Pi `AgentSession` using Pi's public SDK and an in-memory child session manager.
- Give each child a separately constructed resource loader and extension runner. Bind child extensions so they receive normal child `session_start` and `session_shutdown` lifecycle behavior.
- Inherit the parent's effective system prompt, working directory, active work tools, extensions, and skills. The child conversation itself remains fresh.
- Apply a child tool denylist on every child tool-registry rebuild for `subagent`, `message_subagent`, and `kill_subagent`, preventing recursive orchestration.
- Add one child-only custom tool, `message_parent`, after applying the inherited work-tool set.
- Append a fresh-subagent role section to the inherited effective system prompt. State that the child is not the parent, has no inherited parent conversation, works under an authoritative parent, shares the workspace, must stay within the delegated task, must inspect current state before edits, must not revert unrelated work, and must report conflicts rather than force changes.
- Send the delegated prompt as the child's first and final user message at launch. Delimit it with a minimal `delegated_task` text envelope carrying the safe subagent name and fresh-context identity. Do not wrap the system prompt or conversation in role-like XML tags.
- Preserve Pi's native provider-neutral message roles. Do not synthesize literal system, user, or agent role tags.
- Retain inherited write-capable tools. The role contract, parent guidance, exact-edit behavior, and conflict reporting provide coordination, not isolation or permission enforcement.
- Add parent prompt guidance requiring the launch tool to be called by itself after other tool calls complete. A successful launch returns a terminating tool result so the parent run settles immediately.
- Add parent guidance not to modify the delegated scope while the named child remains active. If a new parent turn needs overlapping work, the parent should message or kill the child first.
- Treat the caller-selected name as the public handle. Require uniqueness among starting, running, and waiting children. Permit reuse immediately after terminal finalization.
- Maintain an in-memory active-child registry scoped to the parent extension instance. Track at least starting, running, waiting-for-parent, completed, failed, and killed terminal transitions, while exposing only active states through controls and footer status.
- Allow four active children. Count starting, running, and waiting children toward the limit. Reject an excess launch and report the active names. Do not queue launches.
- Start child creation and execution asynchronously and return the public name immediately after the active record is accepted. Route asynchronous startup failures through normal failed finalization and parent notification.
- `message_subagent` requires an active child name and message. If that child has a pending question, use the message as the answer and resolve the pending child tool call directly. Otherwise deliver it through the child session's steering method. Buffer only against the same active record while its session is starting; never carry a message across name reuse.
- Reject parent messages to terminal or unknown names and identify that no active child can receive them.
- `message_parent` accepts `progress` and `question` kinds plus a message. It has an implicit destination of the owning parent and does not accept a target identifier.
- A progress call appends a visible custom message to the parent session, participates in future parent model context, uses follow-up ordering, and does not trigger a parent turn. The child tool returns immediately.
- Child prompt guidance limits progress calls to meaningful milestones. Do not automatically create progress events from ordinary child model or tool events.
- A question call marks the child waiting, updates the footer, appends a visible parent custom message, and wakes the parent using follow-up delivery and turn triggering.
- Keep the child's question tool execution pending until answered. Resolve the tool call directly with the parent's answer; do not route an answer through steering while the tool remains pending.
- Permit one pending question per child. Reject an additional question until the current one is answered or the child is killed.
- Do not impose an automatic question timeout. A waiting child remains active and consumes a concurrency slot until answered or killed.
- `kill_subagent` accepts an active child name, requests cooperative abort, rejects any pending question, captures and writes the killed result, removes the active record, runs child shutdown, disposes the session, and returns the result path through the kill tool result.
- Document that in-process kill is cooperative and cannot force-stop synchronous code or an extension that ignores cancellation.
- Do not emit a separate parent completion wake for a deliberate kill.
- Subscribe to child session events to capture the terminal assistant message's visible text and to maintain lifecycle state. Do not expose raw event streams as progress.
- Write one private temporary Markdown result file for every completed, failed, or killed child. Create it with user-only permissions and publish its path only after the write completes atomically.
- Make the result file self-contained with the child name, terminal status, resolved model profile, exact delegated task, and a result section.
- For successful completion, extract text blocks from the terminal assistant message in order and write them verbatim. If no terminal text exists, write an explicit no-final-text result.
- For failure, include the error and terminal partial text when available. For kill, include terminal partial text when available.
- Exclude thinking, tool calls, tool results, provider metadata, inherited system instructions, progress reports, questions, answers, and full conversation history from the result file.
- Leave temporary result files for operating-system cleanup. Do not retain a child session solely to preserve its result.
- Finalize natural completion and failure exactly once. Make the result durable, remove the child from active status, deliver the parent notification, run child extension shutdown, dispose the child session, and release all strong references.
- Send natural completion and failure to the parent as visible custom messages with a bounded result preview and result path. Use follow-up delivery and turn triggering so an idle parent wakes immediately and an active parent finishes its current run first.
- Use Pi's extension status slot under the `subagents` key. Show up to three active names followed by `+N` for additional children. Suffix waiting names with `?`. Clear the status when the active registry becomes empty.
- Keep status rendering static. Do not add animation, elapsed time, token counts, progress text, a custom footer, or a persistent widget.
- On parent session shutdown, session switching, or extension reload, cooperatively abort all active children, reject pending questions, run child shutdown, dispose sessions, clear active state, and clear the footer status.
- Target Pi SDK version `0.84.2` for the initial implementation. Do not add compatibility branches for older `createAgentSession` option shapes.
- Keep the core tools functional in TUI, RPC, JSON, and print modes. Treat footer rendering as an optional TUI presentation concern.

## Testing Decisions

- Test at one high seam: load the complete extension through an ExtensionAPI-compatible harness with one injected child-session factory collaborator.
- Use the existing Scheduled Wake extension tests as prior art for capturing registered tools and lifecycle handlers, invoking the extension through its public surface, and observing outbound messages and status effects.
- Let the injected child-session factory return a behavioral fake that supports prompt start, event subscription, steering, abort, extension shutdown, disposal, current messages, and child-only tool execution. Do not expose the production registry or helper functions to tests.
- Keep tests behavioral. Assert tool results, child interactions, parent messages, status output, result-file contents, and lifecycle effects rather than map entries, private states, callback counts unrelated to observable behavior, or helper call order.
- Verify that the extension registers the three parent tools with the agreed schemas and registers `message_parent` only in child sessions.
- Verify that launch omits any conversation-context option and starts a child with no parent messages.
- Verify that launch inherits the effective system prompt, cwd, work-tool names, extensions, skills, model, and thinking level while excluding orchestration tools.
- Verify that the fresh role contract identifies the child as distinct from the parent, describes the shared workspace, limits scope, and defines conflict behavior.
- Verify that the delegated task is the first child user message and is bounded by the agreed minimal task envelope.
- Verify `inherit` model behavior and each configured model profile.
- Verify missing, malformed, unavailable, and unsupported model profiles fail clearly without leaving an active child.
- Verify duplicate active names are rejected and terminal names may be reused.
- Verify four active children are accepted and a fifth is rejected without queueing.
- Verify a successful launch returns immediately with a terminating result and that an asynchronous child failure still notifies the parent.
- Verify a normal `message_subagent` call reaches the active child's steering method.
- Verify a message to a starting child is associated only with that child instance and cannot leak into a later child that reuses the name.
- Verify unknown and terminal child names reject message and kill calls.
- Verify progress creates one visible, model-context parent message with follow-up ordering and no parent turn trigger, while the child tool resolves immediately.
- Verify progress does not alter the footer beyond the active name and does not appear in the result file.
- Verify a question creates a visible parent message, triggers the parent, leaves the child tool pending, and marks the footer name with `?`.
- Verify the first `message_subagent` call while a question is pending resolves that exact question rather than steering, removes the waiting marker, and lets the child continue.
- Verify a later `message_subagent` call with no pending question uses steering.
- Verify a second simultaneous question is rejected and no automatic timeout resolves a pending question.
- Verify kill rejects a pending question, aborts and disposes the child, clears status, writes a killed result, and emits no separate completion wake.
- Verify natural completion writes the agreed Markdown metadata and terminal assistant text before notifying the parent.
- Verify multiple terminal text blocks retain their order.
- Verify successful completion with no text writes the explicit placeholder.
- Verify failure writes its error and available partial text.
- Verify kill writes available partial text.
- Verify result files exclude thinking, tool calls, tool results, progress, questions, answers, and full conversation history.
- Verify result files are private and remain readable after child disposal.
- Verify completion and failure use follow-up delivery with turn triggering enabled and are emitted exactly once.
- Verify a child is removed from the footer before or with its terminal notification and its name is immediately reusable.
- Verify status shows three names plus `+N`, marks waiting children with `?`, and clears when none remain.
- Verify parent session shutdown aborts and disposes all children, rejects pending questions, clears status, and remains idempotent.
- Verify non-TUI execution does not require a footer implementation and retains the model-facing behavior.
- Use temporary directories for result-file tests and clean test-owned files after assertions. Do not introduce a production filesystem adapter solely for tests.

## Out of Scope

- Forking, cloning, summarizing, parsing, or otherwise inheriting the parent conversation.
- A `context`, `fork`, or `inherit_context` launch parameter in the first version.
- LLM-generated handoff summaries.
- Live synchronization between parent and child contexts.
- Persisted or resumable child sessions.
- A result polling or result retrieval tool.
- Retaining a completed child until an explicit parent cleanup call.
- Full child transcripts or conversation viewers.
- Progress inferred automatically from model deltas or tool activity.
- Multiple simultaneous pending questions for one child.
- Automatic question timeouts, default answers, or escalation policies.
- Queued launches or a configurable scheduler.
- More than four active children.
- OS-level hard termination or process isolation.
- Child subprocesses, RPC framing, or external process supervisors.
- Worktree, container, VM, or filesystem isolation.
- Automatic conflict merging, retries, force writes, or unrelated-change reversion.
- Per-agent tool policy beyond inheriting active work tools and excluding orchestration tools.
- Project-local model profile overrides.
- Arbitrary provider/model identifiers in model-facing tool calls.
- Session retention, result consumption tracking, or extension-owned temp-file garbage collection.
- Zellij, ZMX, additional terminals, custom footers, persistent widgets, or transcript panels.
- Backward compatibility with Pi SDK versions older than `0.84.2`.

## Further Notes

- A **parent session** is the Pi session that owns the extension instance and launches subagents.
- A **child session** is an independent, in-process Pi `AgentSession` created for one delegated task.
- An **active subagent** is starting, running, or waiting for a parent answer. Terminal subagents are removed from active state.
- A **delegated task** is the launch prompt delivered as the child's sole initial user message.
- A **model profile** is a global named mapping to one model and thinking level. `inherit` is resolved from the parent rather than stored as a mapping.
- A **pending question** is one unresolved child `message_parent` tool execution. Parent steering cannot answer it because steering is delivered only after the current tool execution; `message_subagent` therefore resolves it directly.
- The footer is an activity indicator, not a durable source of truth or a communication log.
- Same-process child sessions reduce orchestration code but share the parent's event loop, memory, and failure domain.
- The implementation-ready first version deliberately chooses fresh delegation, push-based results, explicit communication, cooperative cancellation, and immediate terminal disposal over broader orchestration features.
