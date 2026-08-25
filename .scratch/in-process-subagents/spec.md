# In-Process Background Subagents

## Problem Statement

Pi users need a small, dependable way to delegate independent work to background subagents without launching external Pi processes, blocking the parent session, or carrying the parent conversation into every delegated task.

The parent agent currently has no focused interface for starting a display-labelled child session, receiving a stable handle, seeing that work is still active, redirecting it, receiving intentional progress, answering a blocking question, or stopping it. Without such an interface, background delegation either requires process-management and RPC plumbing or grows into a large orchestration system with result polling, retained child sessions, custom terminal displays, and speculative scheduling behavior.

Users also need parent and child agents to coexist safely in one working directory. A child that mistakes itself for the parent, broadens the delegated scope, or acts on stale assumptions can overwrite or revert concurrent work. The extension must make the parent-child relationship explicit, keep the delegated task narrow, preserve inherited write capability, and make conflicts fail visibly instead of resolving them destructively.

The first version needs only fresh child sessions. Forking the parent conversation has unresolved product and safety questions and must not complicate the initial interface.

## Solution

Add a `pi-subagents` extension that creates independent Pi `AgentSession` children inside the parent Pi process. Each subagent starts with a fresh conversation, while inheriting the parent session's effective system prompt, working directory, active work tools, extensions, skills, and selected model configuration. A child-specific role contract tells the subagent that it is subordinate to an authoritative parent, that the workspace is shared, and that it must perform only its delegated task.

The parent launches a subagent with a required display name and receives a generated UUID handle. Launches are always background-only and return immediately. Every later `message_subagent` and `kill_subagent` call targets the full UUID; display names are reusable presentation labels, not identifiers. Each child receives a private `message_parent` tool for non-blocking progress reports and blocking questions.

The extension displays each active child's display name plus a short UUID prefix in Pi's existing footer status area. A static themed glyph prefixes each handle: dim `◌` while starting, success-colored `*` while running, and warning-colored `?` while waiting for the parent. Progress is delivered visibly without triggering a parent turn. Questions wake the parent and keep the child tool call blocked until the parent answers. Natural completion and failure write a private temporary `result.md`, dispose the child session, and then wake the parent exactly once with a bounded preview and result path while parent delivery remains open.

The first version limits active subagents using a global configuration value whose default is four, rejects launches beyond that limit instead of queueing them, exposes no result-polling or resume tool, and provides no external Zellij or ZMX display.

## User Stories

1. As a Pi user, I want to launch a background subagent with a display name, so that I can recognize delegated work without making the label its identity.
2. As a Pi user, I want a launch to return immediately, so that the parent session does not block on delegated work.
3. As a Pi user, I want the parent run to settle after launching a subagent, so that it does not waste a model turn while waiting for background work.
4. As a Pi user, I want every launch to return a generated UUID, so that later controls target one unambiguous child.
5. As a Pi user, I want all parent controls to use the full UUID, so that repeated display names cannot target the wrong child.
6. As a Pi user, I want display names to be reusable and non-unique, so that presentation labels require no reservation or persistence policy.
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
27. As a Pi user, I want an unconfigured named profile to fall back visibly to `inherit` while invalid or unavailable configurations remain errors, so that delegation continues without hiding genuine configuration problems.
28. As a Pi user, I want model profiles stored in Pi's global agent configuration, so that they are consistent across projects in the first version.
29. As a Pi user, I want no project-level profile override initially, so that repository-controlled files cannot unexpectedly change subagent cost or capability.
30. As a Pi user, I want to configure the maximum number of active subagents globally, so that I can choose an appropriate resource and model-budget limit.
31. As a Pi user, I want the maximum to default to four, so that accidental fan-out remains bounded without requiring configuration.
32. As a Pi user, I want launches beyond the configured maximum rejected with the active display names and short IDs rather than queued, so that overload is explicit and actionable.
33. As a Pi user, I want to send a message to an active subagent by UUID, so that I can redirect or clarify exactly one child's work.
34. As a Pi user, I want a normal parent message delivered using Pi's steering semantics, so that it reaches the child after its current tool execution.
35. As a Pi user, I want a message sent while a child is starting bound to that UUID's active record, so that fast follow-up guidance remains safe.
36. As a Pi user, I want a message to an unknown or inactive UUID rejected, so that I know the child can no longer receive guidance.
37. As a Pi user, I want a child to report meaningful progress, so that the parent can learn what has been accomplished before final completion.
38. As a Pi user, I want progress reports to be visible in the parent conversation, so that I can observe intentional milestones.
39. As a Pi user, I want progress reports to enter future parent model context, so that the parent can use them on its next turn.
40. As a Pi user, I do not want progress reports to wake the parent, so that routine milestones do not create unsolicited model calls.
41. As a Pi user, I want progress reporting to be non-blocking, so that the child can continue working immediately.
42. As a Pi user, I want children instructed to report only meaningful milestones, so that progress does not become a noisy tool-by-tool transcript.
43. As a Pi user, I want a child to ask the parent a blocking question, so that ambiguous work does not force the child to guess.
44. As a Pi user, I want a child question to show its display name and UUID in the parent conversation, so that I can understand what is blocking and answer the correct child.
45. As a Pi user, I want a child question to wake the parent, so that the parent can answer while the child is waiting.
46. As a Pi user, I want the child to remain blocked until its question is answered, so that it cannot complete or act on an assumption first.
47. As a Pi user, I want the parent to answer a question through the same message tool used for steering, so that parent-to-child communication has one interface.
48. As a Pi user, I want an answer to resolve the pending child tool call directly, so that it does not deadlock behind Pi's steering delivery boundary.
49. As a Pi user, I want parent messages to use normal steering when no question is pending and preserve any steering already queued when a question is answered, so that one tool keeps Pi's native delivery order.
50. As a Pi user, I want at most one pending question per child, so that replies cannot be matched ambiguously.
51. As a Pi user, I want no automatic question timeout initially, so that the extension does not invent an answer or termination policy.
52. As a Pi user, I want to kill a child that is waiting indefinitely, so that unanswered questions do not permanently consume an active slot.
53. As a Pi user, I want starting, running, and waiting children distinguished by static glyphs and semantic colors beside their display name and short ID in the footer, so that lifecycle state is visible without a larger widget.
54. As a Pi user, I want to kill an active subagent by UUID, so that I can stop exactly the work I no longer need.
55. As a Pi user, I want kill to abort and dispose the in-process child cooperatively, so that its resources are released through Pi lifecycle hooks.
56. As a Pi user, I want the cooperative limitation stated clearly, so that `kill_subagent` is not mistaken for OS-level force termination.
57. As a Pi user, I want killing a child to reject any pending parent question, so that no blocked communication promise leaks.
58. As a Pi user, I do not want a second completion wake after a deliberate kill, so that the kill tool result remains the single acknowledgement.
59. As a Pi user, I want natural completion to wake the parent exactly once, so that results are handled promptly without duplicate turns.
60. As a Pi user, I want child failure to wake the parent exactly once, so that background errors are not silent.
61. As a Pi user, I want completion and failure to wait until an active parent run settles, so that child notifications do not interrupt a parent tool batch.
62. As a Pi user, I want completion to trigger immediately when the parent is idle, so that finished work does not wait for another user prompt.
63. As a Pi user, I want natural completion, failure, and explicit kill to write a private temporary Markdown result, so that the parent can inspect the full result without a dedicated retrieval tool.
64. As a Pi user, I want the result file to include the subagent UUID, display name, terminal status, selected model profile, and delegated task, so that it remains understandable on its own.
65. As a Pi user, I want the successful result to contain the terminal assistant message's visible text verbatim, so that the extension does not summarize or reinterpret the child.
66. As a Pi user, I want multiple visible text blocks preserved in order, so that structured final answers are not scrambled.
67. As a Pi user, I do not want thinking blocks in the result file, so that hidden reasoning is not persisted as user-facing output.
68. As a Pi user, I do not want tool calls, tool results, provider metadata, inherited instructions, or the full child transcript in the result file, so that it stays focused.
69. As a Pi user, I want a failed result file to include the error and any terminal partial text, so that failure diagnosis has useful context.
70. As a Pi user, I want a killed result file to include available partial text, so that completed work is not discarded unnecessarily.
71. As a Pi user, I want an explicit placeholder when no final textual result exists, so that an empty file is not mistaken for write failure.
72. As a Pi user, I want completion and failure messages to include the UUID, display name, bounded result preview, and result path, so that the parent can identify the child and decide whether to read the full file.
73. As a Pi user, I do not want a `get_result` tool, so that result delivery remains push-based and the interface stays small.
74. As a Pi user, I want the extension to dispose a terminal child automatically, so that cleanup is not another parent obligation.
75. As a Pi user, I want terminal child context released after the result is durable, so that completed model history and extension state do not accumulate.
76. As a Pi user, I want the temporary result file to survive child disposal, so that the parent can read it after being notified.
77. As a Pi user, I want result files left to operating-system temporary-file cleanup, so that the extension needs no retention database or consumption tracking.
78. As a Pi user, I want a disposed UUID treated as unknown, so that a stale control call cannot target any later child.
79. As a Pi user, I want each active child's display name and short UUID shown in Pi's existing footer, so that background work is recognizable without another terminal or panel.
80. As a Pi user, I want the footer to show up to three display-name/short-ID handles and a `+N` remainder, so that it remains compact.
81. As a Pi user, I want the footer status cleared when no child is active, so that the extension leaves no permanent clutter.
82. As a Pi user, I want progress to leave the compact footer unchanged, so that it remains an activity indicator rather than a log.
83. As a Pi user, I want parent session shutdown, switching, and reload to reject questions, run child shutdown hooks, abort active children without results, silently finish finalizing children, and dispose everything without new notifications, so that no child outlives an owner that cannot consume its result.
84. As a Pi user, I want committed `/tree` navigation to close child delivery, abort active children without results, silently dispose finalizing children, clear status before moving branches, and leave one non-triggering notice that workspace changes were not reverted, so that no subagent becomes a zombie on another timeline.
85. As a Pi user, I want the tools to remain functional in non-TUI Pi modes, so that background delegation is not coupled to footer rendering.
86. As a Pi user, I accept that the footer indicator is TUI-only, so that headless modes do not require a replacement display.
87. As an extension maintainer, I want child sessions created through Pi's public SDK, so that the extension does not reimplement the agent loop.
88. As an extension maintainer, I want child sessions and identifiers to remain runtime-only, so that the extension persists only its deliberate temporary result contract.
89. As an extension maintainer, I want the first completion, failure, or explicit kill transition to win one idempotent finalization path, so that races produce one terminal status, result, notification policy, and disposal.
90. As an extension maintainer, I want Pi `0.84.2` to be the initial compatibility target, so that the implementation does not carry speculative SDK-version adapters.

## Implementation Decisions

- Add a new `pi-subagents` package to the monorepo and register its extension in the repository's installable extension manifest.
- Expose three parent-session tools: `subagent`, `message_subagent`, and `kill_subagent`.
- `subagent` requires a non-empty caller-selected `display_name` and `prompt`. It accepts an optional `model_profile` whose default is `inherit`.
- Generate one UUID for every accepted launch with the runtime's standard UUID facility. Return the full UUID as `id` together with `display_name`; the UUID is the sole control identifier.
- Treat `display_name` as reusable presentation metadata. Permit duplicate display names. Do not persist runtime identity registries, terminal records, or identity tombstones; UUID and display-name metadata may appear only in temporary result files and parent-visible messages.
- Require the full `id` in `message_subagent` and `kill_subagent`. Short UUID prefixes are display-only and are never accepted as control identifiers.
- Do not expose a context or inheritance parameter in the first version. Every child begins with no parent conversation messages.
- Restrict `model_profile` to `inherit`, `low`, `medium`, `high`, and `xhigh`.
- Load model profile definitions and an optional `maxConcurrent` value from a global `subagents.json` in Pi's agent configuration directory. Do not load project-level overrides in the first version. The file shape is:

  ```json
  {
    "maxConcurrent": 4,
    "profiles": {
      "low": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-5",
        "thinkingLevel": "low"
      }
    }
  }
  ```

  Each configured profile requires non-empty `provider` and `model` strings plus a Pi thinking level. A missing file uses defaults with no named profile mappings. Invalid JSON or malformed/unsupported profile definitions reject launch. `maxConcurrent` must be a positive integer and defaults to four when omitted; an invalid value emits a warning and falls back to four.
- Resolve `inherit` from the parent session's current model and thinking level. When a requested named profile has no mapping, resolve it as `inherit`, report the fallback in the successful tool response, and record `inherit` in the result. Continue rejecting unavailable configured models, unsupported thinking levels, malformed profile definitions, and inheritance without an active parent model.
- Create each child as an independent in-process Pi `AgentSession` using Pi's public SDK and an in-memory child session manager.
- Give each child a separately constructed resource loader and extension runner. Bind child extensions so they receive normal child `session_start` and `session_shutdown` lifecycle behavior.
- Inherit the parent's effective system prompt, working directory, current model, and thinking level. Recreate capabilities through a fresh `DefaultResourceLoader` using the same global/project configuration: rediscover configured extensions and skills, use the parent's active work-tool names as the child allowlist, and fail startup visibly if an active work tool cannot be rediscovered. The child conversation itself remains fresh.
- Treat this as configuration-equivalent inheritance, not exact runtime cloning. Pi SDK `0.84.2` does not expose the parent resource loader or executable tool/extension definitions, so temporary `pi -e` extensions, SDK-inline extension factories, additional parent-only resource paths, and runtime-injected custom tools do not carry over. Do not add custom resource scanners or cloning registries to compensate.
- Apply a child tool denylist on every child tool-registry rebuild for `subagent`, `message_subagent`, and `kill_subagent`, preventing recursive orchestration.
- Add one child-only custom tool, `message_parent`, after applying the inherited work-tool set.
- Append a fresh-subagent role section to the inherited effective system prompt. State that the child is not the parent, has no inherited parent conversation, works under an authoritative parent, shares the workspace, must stay within the delegated task, must inspect current state before edits, must not revert unrelated work, and must report conflicts rather than force changes.
- Send the delegated prompt as the child's first and final user message at launch. Delimit it with a minimal `delegated_task` text envelope carrying the UUID, display name, and fresh-context identity. Do not wrap the system prompt or conversation in role-like XML tags.
- Preserve Pi's native provider-neutral message roles. Do not synthesize literal system, user, or agent role tags.
- Retain inherited write-capable tools. The role contract, parent guidance, exact-edit behavior, and conflict reporting provide coordination, not isolation or permission enforcement.
- Add parent prompt guidance requiring the launch tool to be called by itself after other tool calls complete. A successful launch returns a terminating tool result so the parent run settles immediately.
- Add parent guidance not to modify the delegated scope while the UUID remains active. If a new parent turn needs overlapping work, the parent should message or kill that child first.
- Maintain one in-memory `Map<string, ChildRecord>` keyed by UUID and scoped to the parent extension instance. A record carries the immutable UUID and display name plus starting, running, waiting-for-parent, and finalizing lifecycle state.
- Count starting, running, and waiting children as active. A finalizing child accepts no controls, consumes no concurrency slot, and is omitted from the footer, but its record remains until disposal.
- Bind every asynchronous callback to its original record and handle it only while the registry still maps that UUID to the same record. Ignore callbacks after cleanup.
- Enforce the configured maximum number of active children. Reject an excess launch with the configured limit and active display-name/short-ID handles. Do not queue launches.
- Start child creation and execution asynchronously and return the full UUID and display name immediately after accepting the active record. Route asynchronous startup failures through normal failed finalization and parent notification.
- `message_subagent` requires an active UUID and message. If that child has a pending question, use the message as the answer and resolve the pending child tool call directly. Otherwise deliver it through the child session's steering method.
- Buffer guidance only against the addressed UUID while its session is starting. Once running, use Pi's native steering order. Answering a pending question does not consume, cancel, or reorder steering that Pi already queued.
- Reject parent messages and kill requests for malformed, unknown, or finalizing UUIDs and state that no active child can receive them. Disposed UUIDs are unknown because their records no longer exist.
- `message_parent` accepts `progress` and `question` kinds plus a message. It has an implicit destination and identity supplied by the owning child record; it does not accept a target identifier.
- Include the full UUID and display name in every child progress, question, completion, failure, and explicit-kill result visible to the parent.
- A progress call appends a visible custom message to the parent session, participates in future parent model context, uses follow-up ordering, and does not trigger a parent turn. The child tool returns immediately.
- Child prompt guidance limits progress calls to meaningful milestones. Do not automatically create progress events from ordinary child model or tool events.
- A question call marks the child waiting, updates the footer, appends a visible parent custom message, and wakes the parent using follow-up delivery and turn triggering.
- Keep the child's question tool execution pending until answered. Resolve the tool call directly with the parent's answer; do not route an answer through steering while the tool remains pending.
- Permit one pending question per child. Reject an additional question until the current one is answered or the child is killed.
- Do not impose an automatic question timeout. A waiting child remains active and consumes a concurrency slot until answered or killed.
- `kill_subagent` accepts an active UUID, synchronously claims killed finalization, requests cooperative abort, rejects any pending question, captures and writes the killed result, runs child shutdown, disposes the session, removes the record, and returns the result path through the kill tool result.
- Document that in-process kill is cooperative and cannot force-stop synchronous code or an extension that ignores cancellation.
- Do not emit a separate parent completion wake for a deliberate kill.
- Subscribe to child session events to capture the terminal assistant message's visible text and to maintain lifecycle state. Do not expose raw event streams as progress.
- Let the first natural completion, failure, or explicit kill claim finalization synchronously before any asynchronous cleanup. Ignore later terminal events for that record.
- Write one private temporary Markdown result file for every naturally completed, failed, or explicitly killed child. Create it with user-only permissions and publish its path only after the write completes atomically.
- Make the result file self-contained with the UUID, display name, terminal status, resolved model profile, exact delegated task, and a result section.
- For successful completion, extract text blocks from the terminal assistant message in order and write them verbatim. If no terminal text exists, write an explicit no-final-text result.
- For failure, include the error and terminal partial text when available. For explicit kill, include terminal partial text when available.
- Exclude thinking, tool calls, tool results, provider metadata, inherited system instructions, progress reports, questions, answers, and full conversation history from the result file.
- Leave temporary result files for operating-system cleanup. Do not retain a child session solely to preserve its result.
- Finalize natural completion and failure exactly once. Make the result durable, run child extension shutdown, dispose the child session, delete the registry record, and release strong references before emitting the parent notification. If lifecycle or tree cleanup closes parent delivery before emission, suppress the notification and result path; leave any unpublished temporary file to operating-system cleanup.
- While parent delivery remains open, send natural completion and failure as visible custom messages containing the full UUID, display name, bounded result preview, and result path. Use follow-up delivery and turn triggering so an idle parent wakes immediately and an active parent finishes its current run first.
- Use Pi's extension status slot under the `subagents` key. Show up to three handles followed by `+N` for additional children. Prefix each `display_name#short-id` handle with a static glyph whose semantic theme color applies only to the glyph: dim `◌` for starting, success-colored `*` for running, and warning-colored `?` for waiting. Refresh the status on every transition among those active states. Clear the status when no starting, running, or waiting child remains.
- Keep status rendering static. Do not add animation, elapsed time, token counts, progress text, a custom footer, or a persistent widget.
- On parent session shutdown, session switching, or extension reload, close parent delivery first. Cooperatively abort active children without creating results, reject pending questions, suppress unpublished paths and notifications from finalizing children, run child shutdown, dispose every session, clear the registry, and clear footer status.
- Handle `session_before_tree` as a hard timeline boundary. Before Pi changes the leaf, close launches, controls, and parent delivery; capture every non-disposed display-name/short-ID handle; cooperatively abort active children without creating results; reject pending questions; let finalizing children finish silent disposal; clear the registry and footer; and await cleanup. Do not migrate children.
- After committed navigation, emit one visible custom message with turn triggering disabled only when children were stopped. List their display-name/short-ID handles and state that existing workspace changes were not reverted. Then reopen launches, controls, and parent delivery. Opening `/tree`, cancelling it, or selecting the current leaf causes no cleanup because Pi emits no committed tree transition.
- After lifecycle or tree cleanup begins, ignore late child progress, question, and terminal callbacks except for the internal steps needed to finish silent disposal. Never let those callbacks emit a parent message on a new session or branch.
- Target Pi SDK version `0.84.2` for the initial implementation. Do not add compatibility branches for older `createAgentSession` option shapes.
- Keep the core tools functional in TUI, RPC, JSON, and print modes. Treat footer rendering as an optional TUI presentation concern.

## Testing Decisions

- Test at one high seam: load the complete extension through an ExtensionAPI-compatible harness with one injected child-session factory collaborator.
- Use the existing Scheduled Wake extension tests as prior art for capturing registered tools and lifecycle handlers, invoking the extension through its public surface, and observing outbound messages and status effects.
- Let the injected child-session factory return a behavioral fake that supports prompt start, event subscription, steering, abort, extension shutdown, disposal, current messages, and child-only tool execution. Do not expose the production registry or helper functions to tests.
- Keep tests behavioral. Assert tool results, child interactions, parent messages, status output, result-file contents, and lifecycle effects rather than map entries, private states, callback counts unrelated to observable behavior, or helper call order.
- Verify that the extension registers the three parent tools with UUID-based control schemas and registers `message_parent` only in child sessions.
- Verify that each accepted launch returns a full generated UUID and exact display name in a terminating result.
- Verify duplicate display names are accepted with distinct UUIDs and that short UUIDs are never accepted by control tools.
- Verify that launch omits any conversation-context option and starts a child with no parent messages.
- Verify that launch inherits the effective system prompt, cwd, work-tool names, extensions, skills, model, and thinking level while excluding orchestration tools.
- Verify that the fresh role contract identifies the child as distinct from the parent, describes the shared workspace, limits scope, and defines conflict behavior.
- Verify that the delegated task is the first child user message and its envelope contains the full UUID, display name, and fresh-context identity.
- Verify `inherit` model behavior and each configured model profile.
- Verify an unconfigured named profile visibly falls back to `inherit`, while malformed, unavailable, and unsupported profile configurations fail clearly without leaving an active child.
- Verify the active-child limit defaults to four when `maxConcurrent` is omitted.
- Verify a valid positive `maxConcurrent` changes the accepted active-child count and that the next launch reports active display-name/short-ID handles without queueing.
- Verify zero, negative, fractional, and otherwise invalid `maxConcurrent` values produce a warning and fall back to four.
- Verify a normal `message_subagent` call targets the full UUID and reaches that child's steering method.
- Verify guidance sent while a child is starting remains bound to that UUID and reaches only its eventual session.
- Verify malformed, short, unknown, and finalizing UUIDs reject message and kill calls, including a formerly valid UUID after disposal.
- Verify progress includes UUID and display name, creates one visible model-context parent message with follow-up ordering and no parent turn trigger, and resolves the child tool immediately.
- Verify progress does not alter the footer beyond the active handle and does not appear in the result file.
- Verify a question includes UUID and display name, creates a visible parent message, triggers the parent, leaves the child tool pending, and changes the footer glyph from success-colored `*` to warning-colored `?`.
- Verify the first `message_subagent` call while a question is pending resolves that exact question rather than steering, removes the waiting marker, and lets the child continue.
- Verify answering a question does not consume or reorder steering already queued by Pi and that a later message with no pending question uses steering.
- Verify a second simultaneous question is rejected and no automatic timeout resolves a pending question.
- Verify explicit kill by UUID rejects a pending question, aborts and disposes the child, clears status, writes a killed result, returns its path, and emits no separate completion wake.
- Verify completion followed by kill stays completed, kill followed by completion stays killed, and either ordering produces one result and one acknowledgement policy.
- Verify natural completion writes UUID, display name, agreed Markdown metadata, and terminal assistant text before notifying the parent.
- Verify multiple terminal text blocks retain their order.
- Verify successful completion with no text writes the explicit placeholder.
- Verify failure writes its error and available partial text.
- Verify explicit kill writes available partial text.
- Verify result files exclude thinking, tool calls, tool results, progress, questions, answers, and full conversation history.
- Verify result files are private and remain readable after child disposal.
- Verify completion and failure notifications are emitted only after child disposal, include UUID and display name, use follow-up delivery with turn triggering enabled, and appear exactly once while parent delivery remains open.
- Verify a finalizing child releases its concurrency slot and footer position, rejects controls, and loses its registry record at disposal.
- Verify footer status prefixes starting, running, and waiting handles with only the dim `◌`, success-colored `*`, and warning-colored `?` glyph respectively; refreshes on active-state transitions; shows three handles plus `+N`; and clears when no active child remains.
- Verify parent session shutdown, switching, and reload abort active children without results, silently dispose finalizing children without publishing paths or notifications, reject pending questions, clear status, and remain idempotent.
- Verify `session_before_tree` closes launches, controls, and delivery; aborts active children without results; silently disposes finalizing children; rejects questions; clears status before navigation; and ignores late callbacks except for disposal.
- Verify `session_tree` emits one visible non-triggering cancellation notice with stopped handles and the workspace warning, emits nothing when no child was stopped, and then permits new launches.
- Verify non-TUI execution does not require a footer implementation and retains the model-facing behavior.
- Use temporary directories for result-file tests and clean test-owned files after assertions. Do not introduce a production filesystem adapter solely for tests.

## Out of Scope

- Forking, cloning, summarizing, parsing, or otherwise inheriting the parent conversation.
- A `context`, `fork`, or `inherit_context` launch parameter in the first version.
- LLM-generated handoff summaries.
- Live synchronization between parent and child contexts.
- Persisted or resumable child sessions.
- Persisted UUID registries, display-name registries, identity tombstones, or restoration of terminal controls.
- Unique or reserved display names.
- Preserving, migrating, or reparenting active children across committed parent `/tree` navigation.
- Parent-visible result delivery or completion notifications for children cancelled or silently disposed by parent lifecycle or tree cleanup.
- A result polling or result retrieval tool.
- Retaining a completed child until an explicit parent cleanup call.
- Full child transcripts or conversation viewers.
- Progress inferred automatically from model deltas or tool activity.
- Multiple simultaneous pending questions for one child.
- Automatic question timeouts, default answers, or escalation policies.
- Queued launches or a configurable scheduler.
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

- A **parent session** is the Pi session whose extension instance launches and owns subagents.
- A **child session** is an independent, in-process Pi `AgentSession` created for one delegated task.
- A **subagent ID** is the full generated UUID returned by `subagent`; it is the sole identifier accepted by parent control tools and is never restored after its record is disposed.
- A **display name** is caller-selected, reusable presentation metadata. It has no uniqueness, lookup, persistence, or lifecycle semantics.
- A **short ID** is a UUID prefix shown only beside the display name in human-facing status and messages. It is never accepted as a control identifier.
- An **active subagent** is starting, running, or waiting for a parent answer. Active children consume concurrency slots and accept controls appropriate to their state.
- A **finalizing subagent** has a winning terminal outcome and accepts no controls or concurrency slot while its result and disposal complete.
- A **delegated task** is the launch prompt delivered as the child's sole initial user message.
- A **model profile** is a global named mapping to one model and thinking level. `inherit` is resolved from the parent rather than stored as a mapping.
- **`maxConcurrent`** is the global positive-integer limit for starting, running, and waiting subagents; it defaults to four.
- A **pending question** is one unresolved child `message_parent` tool execution. Parent steering cannot answer it because steering is delivered only after the current tool execution; `message_subagent` therefore resolves it directly without disturbing already queued steering.
- A **tree cancellation** is lifecycle cleanup caused by committed parent `/tree` navigation. It cancels active children without results, silently disposes finalizing children without parent-visible paths or wakes, and leaves workspace changes untouched.
- The footer is an activity indicator, not a durable source of truth or a communication log.
- Same-process child sessions reduce orchestration code but share the parent's event loop, memory, and failure domain.
- The implementation-ready first version deliberately chooses fresh delegation, runtime-only UUID identity, push-based results, explicit communication, cooperative cancellation, hard tree ownership boundaries, and immediate terminal disposal over broader orchestration features.
