# Forked Parent Context for In-Process Subagents

## Problem Statement

Fresh background subagents receive the delegated task and current workspace but do not know the parent conversation that led to the delegation. For some future tasks, restating all relevant decisions, constraints, attempted approaches, tool findings, and user preferences in the delegated prompt may be repetitive or error-prone.

A proposed fork mode would let a child begin from a snapshot of the parent model context. However, the use cases, safety boundary, context-selection policy, token cost, provider behavior, and interaction with concurrent shared-workspace edits are not yet sufficiently understood. A child that sees the parent's history may mistake itself for the parent, continue the parent's broader agenda, act on stale state, or duplicate work the parent is still performing.

The feature must therefore remain separate from the implementation-ready fresh-subagent scope. This specification records the current proposed direction and the questions that must be resolved before forked context is promoted into a release.

## Solution

In a later plugin version, optionally allow a launch to request a forked child context. The child remains an independent, in-process Pi `AgentSession`, but its initial message history is populated from the parent's active Pi context at the instant of launch.

The fork preserves Pi's provider-neutral user, assistant, tool-result, custom-message, branch-summary, and compaction semantics rather than flattening the conversation or generating an LLM summary. The assistant message currently invoking the subagent is excluded so the child never receives an unmatched delegation tool call.

The inherited context is a static snapshot, not a live branch. The child receives a fork-specific role contract appended to the parent effective system prompt. That contract says the child is a clone derived from parent context, is not the parent, must perform only the final delegated task, must treat current workspace contents as authoritative over stale conversation statements, and must report rather than overwrite conflicts.

The final delegated task remains a new native user message with the minimal task delimiter used by fresh subagents. Communication, model profiles, result delivery, footer status, concurrency, cancellation, and automatic child disposal continue to use the first-version contracts.

This feature is deferred and not ready for implementation. Its public launch parameter and entry criteria require further iteration.

## User Stories

1. As a Pi user, I want to delegate a task with relevant parent conversation history, so that I do not have to restate every prior decision manually.
2. As a Pi user, I want forked context to be explicitly requested, so that normal subagents remain fresh and inexpensive.
3. As a Pi user, I want the default launch behavior to remain fresh, so that adding fork support does not change existing calls.
4. As a Pi user, I want the child to receive the parent context as it existed at launch, so that queued or delayed execution cannot silently read a newer conversation.
5. As a Pi user, I want the fork to preserve native user and assistant roles, so that conversational meaning is not reduced to a transcript.
6. As a Pi user, I want prior tool calls paired with their tool results, so that the child can understand evidence already gathered.
7. As a Pi user, I want compaction state honored, so that the child receives the same effective context rather than discarded pre-compaction history.
8. As a Pi user, I want relevant branch summaries and custom context messages preserved using Pi's normal conversion, so that the fork matches what Pi would send to a model.
9. As a Pi user, I want the current delegation tool call excluded, so that the child does not receive an assistant tool call without its result.
10. As a Pi user, I want no generated context summary, so that the fork does not add cost, latency, omissions, or nondeterministic reinterpretation.
11. As a Pi user, I want no text transcript substituted for native roles, so that tool and assistant history remains structurally meaningful.
12. As a Pi user, I want the child told that it is a forked clone rather than the parent, so that it does not assume ownership of the parent session.
13. As a Pi user, I want the child told that inherited context is a snapshot, so that it expects the parent may have continued afterward.
14. As a Pi user, I want current workspace contents treated as authoritative, so that stale contextual statements do not justify overwriting newer work.
15. As a Pi user, I want inherited history treated as background rather than a mandate to continue the parent's full agenda, so that the child remains within its delegated task.
16. As a Pi user, I want the delegated task to remain the final user message, so that it has a clear position after inherited history.
17. As a Pi user, I want the delegated task visibly delimited and labeled with the child identity and fork mode, so that its scope is unmistakable.
18. As a Pi user, I want fork mode to preserve the same model-profile behavior as fresh mode, so that context selection and model selection remain independent.
19. As a Pi user, I want fork mode to preserve inherited work tools and parent communication, so that a contextual child has no separate control protocol.
20. As a Pi user, I want progress, questions, answers, completion, and failure to behave identically across fresh and forked children, so that the parent does not need mode-specific communication logic.
21. As a Pi user, I want shared-workspace warnings strengthened for a forked child, so that seeing the parent's prior edits does not imply exclusive ownership.
22. As a Pi user, I want a forked child to report a conflict instead of force-writing, so that inherited intent cannot override current state.
23. As a Pi user, I want forked context to respect the selected model's context window, so that delegation does not fail unpredictably from excess inherited history.
24. As a Pi user, I want cross-model and cross-provider forks handled through Pi's adapters, so that provider-specific payload formats do not leak into the extension interface.
25. As a Pi user, I want unsupported or unsafe fork conditions rejected clearly, so that the extension never silently falls back to fresh context.
26. As a Pi user, I want result files to identify that a run used forked context, so that retained results remain understandable.
27. As a Pi user, I want a forked child disposed automatically after terminal result delivery, so that context inheritance does not create session retention.
28. As a Pi user, I do not want fork mode to persist or mutate the parent session, so that delegation cannot alter the parent's conversation tree.
29. As a Pi user, I do not want child messages merged back into the parent history automatically, so that only intentional communication and the terminal result cross the seam.
30. As an extension maintainer, I want fork support built on Pi's existing context conversion seam, so that provider message behavior stays centralized.
31. As an extension maintainer, I want fork behavior tested through the same extension harness as fresh behavior, so that context mode does not create a second testing architecture.
32. As an extension maintainer, I want fork mode developed only after representative use cases are documented, so that a high-cost feature is not built around hypothetical value.

## Implementation Decisions

- Defer forked context to a second plugin version. Do not expose a dormant fork option in the first-version tool schema.
- Preserve fresh launch behavior as the default after fork support is eventually introduced.
- Require an explicit launch-time request for forked context. The final parameter name and shape remain a product decision to resolve before implementation.
- Capture parent context at launch time, not when a later concurrency slot or asynchronous child initialization begins.
- Build the snapshot from Pi's active context entries with compaction applied, using Pi's normal conversion to provider-neutral model messages.
- Preserve native Pi message roles and typed content. Do not wrap the inherited conversation in a custom envelope and do not create literal system, user, or agent tags.
- Exclude the assistant message that contains the current subagent launch call. The fork must end at the last complete parent interaction before delegation.
- Do not invoke an LLM to summarize, select, or rewrite inherited context.
- Do not flatten inherited messages into a human-readable transcript.
- Append a fork-specific role section to the parent's effective system prompt. Identify the child as a forked background clone, distinguish it from the authoritative parent, describe the snapshot as potentially stale, and limit work to the final delegated task.
- Keep the delegated task as a new final native user message using the minimal `delegated_task` text delimiter with the UUID, display name, and fork identity.
- Treat the fork as immutable startup input. Do not live-sync later parent messages, child messages, tool results, or system-prompt changes.
- Continue sharing the parent's current working directory, effective system guidance, active work tools, extensions, skills, model-profile resolution, communication tools, result contract, status behavior, concurrency limit, and cooperative cancellation policy.
- Continue excluding subagent orchestration tools from the child.
- Retain inherited write capability, but strengthen the child role contract: inherited context is evidence of prior work, not permission to overwrite current files.
- Require conflicting file state, failed exact edits, or evidence of concurrent ownership to produce a visible conflict result rather than a force write, revert, or automatic retry.
- Use an in-memory child session. Forking context does not create a persistent child branch, mutate the parent session tree, or add resume behavior.
- Let Pi's provider adapters serialize the provider-neutral context for Anthropic, OpenAI, Gemini, and other supported models. Do not build provider-specific role or tool-result serialization in the extension.
- Add fork identity to result-file metadata while keeping result contents otherwise identical to fresh mode.
- Reuse the first version's terminal finalization and immediate child disposal.
- Do not mark this specification implementation-ready until the unresolved product questions in Further Notes have explicit answers and representative use cases.

## Testing Decisions

- Reuse the single high testing seam defined for the first version: the complete extension loaded through an ExtensionAPI-compatible harness with an injected child-session factory.
- Use the repository's `pi-qq` context construction as prior art for converting active session entries into the exact provider-neutral messages Pi sends to a model.
- Extend the fake parent session manager with realistic active-branch and compaction behavior rather than exposing a separate fork-specific context interface to tests.
- Keep tests behavioral. Observe the child session's supplied system prompt and message history rather than private snapshot helpers or array-manipulation functions.
- Verify that fresh mode remains unchanged and contains no parent conversation messages after fork support is added.
- Verify that a fork captures context at launch time even if the parent changes before child initialization completes.
- Verify that user, assistant, tool-call, and tool-result ordering is preserved.
- Verify that compaction and branch summaries are represented through Pi's normal context conversion.
- Verify that custom messages intended for model context remain present and extension-only custom entries remain absent.
- Verify that the current assistant delegation message is excluded and no unmatched `subagent` tool call reaches the child.
- Verify that the fork-specific role contract identifies the child as a clone, identifies the parent as authoritative, warns that the snapshot can be stale, and restricts work to the delegated task.
- Verify that the delegated task is the final user message and uses the fork identity in its task delimiter.
- Verify that no summarization model call or transcript-flattening path occurs.
- Verify that fork mode does not append to or branch the parent session manager.
- Verify that child progress, questions, answers, completion, failure, kill, result writing, footer status, and disposal remain behaviorally identical to fresh mode.
- Verify that fork result metadata identifies the context mode.
- Add cross-model fixtures only for behavior Pi's provider-neutral conversion does not already guarantee. Do not duplicate provider-adapter test suites in this extension.
- Define and test the eventual context-window rejection or compaction policy only after that product decision is settled.

## Out of Scope

- Implementing or exposing fork mode in the first plugin version.
- Treating this deferred specification as ready for agent implementation.
- LLM-generated summaries, semantic context selection, or parsed handoff documents.
- Wrapping the full parent conversation in XML or Markdown.
- Live synchronization between parent and child after launch.
- Automatic merging of child conversation back into the parent.
- Automatic merging, rebasing, reverting, or conflict resolution for shared workspace changes.
- Worktree, container, VM, or subprocess isolation.
- A persistent child session, conversation browser, resume operation, or retention policy.
- Provider-specific request payload construction.
- Forking abandoned session branches rather than the parent's active effective context.
- Changing model-profile, communication, result, status, concurrency, kill, or disposal semantics solely for fork mode.
- Silently degrading an unsuccessful fork request into a fresh child.

## Further Notes

- This specification is intentionally **on ice**. It records the current design hypothesis but is not ready for implementation.
- The motivating use cases need representative examples demonstrating that exact parent context is materially better than a carefully delegated fresh task.
- The public invocation shape remains unresolved: adding a two-value context enum, adding a fork-only boolean, or adding a separate launch operation each has migration and clarity tradeoffs.
- The maximum safe inherited-context size remains unresolved. Options include relying on Pi's effective compacted context, rejecting above a threshold, compacting before fork, or allowing the provider to reject overflow.
- Whether images and large tool results should always be inherited remains unresolved because exact fidelity, cost, privacy, and cross-model compatibility may conflict.
- Whether the parent's effective system prompt contains session-specific assumptions that should be rewritten for a fork remains an area for validation.
- The child will share the same workspace while the parent may continue after the snapshot. Prompt contracts reduce accidental overlap but do not provide isolation.
- A **forked context** is a provider-neutral snapshot of the parent model context at launch, not a filesystem fork, process fork, persistent session branch, or live link.
- A **forked child** is an independent child session whose startup history came from the parent snapshot and whose only continuing relationship is the explicit bidirectional communication channel.
- Promotion to an implementation-ready specification should require resolved use cases, invocation shape, context-size policy, multimodal/tool-result policy, and any necessary changes to the shared-workspace contract.
