# 03 — Finalize and cancel subagents safely

**What to build:** Complete every child exactly once across natural failure, explicit kill, parent shutdown or replacement, and committed tree navigation. Terminal results stay safe and focused, blocked questions are cancelled during cleanup, and no late child callback can wake the wrong parent timeline.

**Blocked by:** 02 — Communicate with active subagents.

**Status:** resolved

- [x] Natural failure produces the agreed private result metadata, error, and available terminal partial text, disposes the child, and notifies the parent exactly once while delivery remains open.
- [x] Successful, failed, and explicitly killed results preserve visible terminal text blocks in order and exclude thinking, tool calls, tool results, communication messages, provider metadata, and full transcripts.
- [x] Empty terminal text uses an explicit placeholder, result files have user-only permissions, and unpublished temporary files are left only to operating-system cleanup.
- [x] `kill_subagent` requires an active full UUID, claims killed finalization, cooperatively aborts the child, cancels a blocked question, writes available partial text, disposes the child, and returns the result path without a second wake.
- [x] The first natural completion, failure, or explicit kill wins; later terminal events cannot change status or create another result or acknowledgement.
- [x] A finalizing child rejects controls, disappears from the footer, and releases its concurrency slot before disposal removes its registry record.
- [x] Shutdown, session switch, and extension reload close parent delivery, abort active children without results, silently dispose finalizing children, cancel blocked questions, clear status, and emit no new notifications.
- [x] Committed tree navigation closes launches, controls, and delivery before the leaf changes; aborts active children without results; silently disposes finalizing children; cancels blocked questions; and clears status before navigation completes.
- [x] After tree navigation, one visible non-triggering notice lists stopped handles and warns that existing workspace changes were not reverted; no notice appears when no child was stopped.
- [x] Opening or cancelling `/tree`, or selecting the current leaf, leaves children untouched because no committed tree transition occurred.
- [x] Late progress, question, startup, completion, and failure callbacks after cleanup cannot emit onto a new session or branch.
- [x] Behavioral tests cover both completion/kill orderings, cooperative cleanup, blocked-question cancellation, silent lifecycle cleanup, tree cleanup, and late callbacks.

## Answer

Implemented idempotent natural, failed, and killed finalization; focused private result files; cooperative kill and blocked-question cancellation; silent session cleanup; and hard tree timeline cleanup with one non-triggering workspace warning.

Pi SDK `0.84.2` has no confirmed pre-commit tree hook. The required `session_before_tree` safety boundary means a later extension veto can leave children stopped; opening or cancelling the selector and selecting the current leaf remain untouched because Pi emits no tree lifecycle event for those cases.

Context: [feature map](../map.md).
