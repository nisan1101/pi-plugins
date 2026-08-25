# Inline Subagent Results

## Problem Statement

When a subagent finishes, the parent does not get its result — it gets a 500-character preview plus a filesystem path to a temporary `result.md`. To actually use the full result, the parent must spend an extra `read` round-trip on a file it never asked to exist. The full terminal text is what the parent wanted in context in the first place, so the extension now maintains two representations of the same data: a truncated inline preview and a durable-but-redundant file.

The file also captures metadata the parent already knows — the UUID, display name, selected profile, model, thinking level, and the delegated task the parent itself wrote — restating the launch instead of delivering the answer.

On kill, the situation is worse: the parent gets a path to "partial text" scraped from a mid-abort assistant message. That text is not a terminal result; it is whatever the child happened to say last (often a half-thought or a tool-call preamble). It reads like a result but is not one, and the parent that just chose to kill the child had already signalled it does not want that output.

## Solution

Deliver the subagent's terminal result inline. On natural completion and failure, the parent's single wake message carries the child's verbatim terminal text directly in its content — no preview truncation, no temporary file, no path. If the parent wants an artifact on disk, it instructs the child to write one in the delegated prompt; producing files becomes the child's explicit, parent-directed work rather than a side channel the framework invents.

On kill, the tool result is a bare acknowledgement — no scraped partial text, no file, no path. A parent that wants to salvage in-progress work uses `message_subagent` ("summarize what you have") and lets the child complete naturally, which yields a real terminal result through the normal completion path.

This aligns completion results with how `message_parent` progress reports already behave (inline, visible, no file), and removes the temporary-file machinery entirely.

## User Stories

1. As a Pi user, I want a completed subagent's full terminal text delivered inline in the parent wake message, so that I can use the result without an extra file read.
2. As a Pi user, I want the completion result verbatim rather than truncated, so that structured or long answers are not silently cut at 500 characters.
3. As a Pi user, I want multiple terminal text blocks preserved in their original order inline, so that structured final answers are not scrambled.
4. As a Pi user, I want a failed subagent's error and any terminal partial text delivered inline, so that I can diagnose the failure without reading a file.
5. As a Pi user, I want an explicit placeholder when a completed or failed child produced no terminal text, so that an empty result is not mistaken for a delivery bug.
6. As a Pi user, I do not want a temporary result file written on completion, failure, or kill, so that the extension leaves no filesystem side effects I did not request.
7. As a Pi user, I do not want a result path in any parent message or tool result, so that there is nothing extra to open or clean up.
8. As a Pi user, I do not want redundant launch metadata (profile, model, thinking level, restated delegated task) in the result, so that the delivery is the answer, not a description of the request.
9. As a Pi user, I want the completion and failure wake to keep the child's display name and UUID, so that I can still identify which delegated task finished.
10. As a Pi user, I want to instruct a child to write a file when I actually need an on-disk artifact, so that file creation is explicit, parent-directed work with a path I chose.
11. As a Pi user, I want killing a child to return a bare acknowledgement, so that I am not handed incomplete text scraped from a mid-abort message.
12. As a Pi user, I do not want a file or path produced by a kill, so that abandoning work leaves nothing behind to inspect or delete.
13. As a Pi user, I want to salvage in-progress work by asking the child to summarize and letting it complete, so that I get a real terminal result instead of a scraped fragment.
14. As a Pi user, I want completion and failure to still wake the parent exactly once, so that inline delivery does not change turn behavior.
15. As a Pi user, I want kill to still emit no second completion wake, so that the kill tool result remains the single acknowledgement.
16. As a Pi user, I want inline results to still respect an active parent run's settle boundary, so that a finishing child does not interrupt a parent tool batch.
17. As an extension maintainer, I want the temporary-file writing code removed, so that there is no atomic-rename, permission, or temp-directory machinery to maintain.
18. As an extension maintainer, I want the finalization path to no longer produce a result path, so that its callers depend only on the inline message and disposal completion.

## Implementation Decisions

- On natural completion and failure, the parent wake message content carries the child's verbatim terminal assistant text inline. Remove the bounded preview; the full text is delivered.
- Do not impose a size cap on the inlined result. A verbose child is a prompt-discipline signal handled by instructing the child (e.g. to write a file), not a framework concern.
- Retain the existing terminal-text extraction: concatenate the terminal assistant message's visible text blocks in order, verbatim, excluding thinking, tool calls, tool results, provider metadata, and transcript history.
- Retain the explicit no-terminal-text placeholder for completion and failure when the child produced no visible text.
- Failure delivery inlines the error followed by any terminal partial text. Partial text remains valuable on failure because failure is not a deliberate abandonment.
- Remove temporary result-file creation for all terminal transitions (completion, failure, kill), including the atomic pending-write/rename step, user-only permissions handling, and temp-directory allocation.
- Drop the result path and any result-file metadata block from all parent-visible messages and tool results.
- The finalization path no longer returns a result path. Natural completion and failure emit the inline wake message; kill awaits disposal and returns a bare acknowledgement.
- `kill_subagent`'s tool result is a bare acknowledgement identifying the killed child by display name and UUID, with no partial text and no path in its content or details.
- Update the `kill_subagent` tool description to state that killing returns no result — no partial text and no artifact — so a caller that wants in-progress work uses `message_subagent` and lets the child complete instead.
- Confirmed no downstream consumers of the result path: every `result_path`/`resultPath` reference is internal to the extension and no test asserts on it, so removal is a pure deletion.
- Accept the deliberate failure/kill asymmetry: failure inlines error and partial text (not a chosen abandonment); kill returns nothing (a chosen abandonment).
- Remove the now-unused result-markdown builder and preview helper, and trim imports left unused by removing file writing.
- Add child role guidance that the child's final assistant message is the result delivered to the parent verbatim, and that on-disk artifacts should be produced only when the delegated task asks for them.
- Update the package README's communication-and-results section to describe inline delivery and the bare kill acknowledgement, removing references to `result.md`, previews, and result paths.

## Testing Decisions

- Good tests here assert external behavior: what the parent receives on completion, failure, and kill — not private finalization state, helper call order, or map internals.
- Test at the single existing seam: the injected `createChildSession` factory, driven through the extension's public ExtensionAPI surface via the existing harness. No new seam is introduced.
- Prior art: the extension's own suite (and the Scheduled Wake extension tests it is modeled on) for capturing registered tools, driving a behavioral child-session fake, and observing outbound parent messages.
- Behaviors to cover:
  - Completion wake content contains the child's full terminal text verbatim (including a case exceeding the old 500-character preview boundary) and no result path.
  - Multiple terminal text blocks appear inline in order.
  - Failure wake content contains the error and terminal partial text inline, with no result path.
  - Completion/failure with no terminal text delivers the placeholder inline.
  - Kill tool result is a bare acknowledgement with no partial text and no result path in content or details.
  - No temporary file is created by any terminal transition (assert via the injected filesystem boundary / absence of writes rather than by scanning the real temp dir).
  - Completion still wakes the parent once; kill still emits no second wake.

## Out of Scope

- Any size cap, summarization, or truncation of inlined results.
- Automatic file production by the extension; on-disk artifacts are the child's parent-directed work.
- A result-polling, resume, or `get_result` tool.
- Changes to progress reporting, question/answer flow, footer rendering, concurrency limits, model-profile resolution, or the fresh-context boundary.
- Changes to shutdown, session-switch, reload, or `/tree` cleanup, which already abort children without producing results.

## Further Notes

- This change makes completion results consistent with `message_parent` progress reports, which are already delivered inline with no file.
- Resolved during grilling: (1) no size cap — truly unbounded inline results; (2) losing scraped partial text on kill is accepted, and the kill tool description will say so explicitly; (3) the child role-prompt guidance is included; (4) the failure/kill asymmetry is intentional.
- Repo note: this tracker (`.scratch/<slug>/spec.md`) is the project's issue tracker per `docs/agents/issue-tracker.md`; the `ready-for-agent` triage label from the generic to-spec flow has no vocabulary here and is omitted.
