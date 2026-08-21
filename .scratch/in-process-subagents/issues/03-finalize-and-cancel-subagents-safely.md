# 03 — Finalize and cancel subagents safely

**What to build:** Complete every child exactly once across natural failure, explicit kill, parent shutdown or replacement, and committed tree navigation. Terminal results stay safe and focused, blocked questions are cancelled during cleanup, and no late child callback can wake the wrong parent timeline.

**Blocked by:** 02 — Communicate with active subagents.

**Status:** ready-for-agent

- [ ] Natural failure produces the agreed private result metadata, error, and available terminal partial text, disposes the child, and notifies the parent exactly once while delivery remains open.
- [ ] Successful, failed, and explicitly killed results preserve visible terminal text blocks in order and exclude thinking, tool calls, tool results, communication messages, provider metadata, and full transcripts.
- [ ] Empty terminal text uses an explicit placeholder, result files have user-only permissions, and unpublished temporary files are left only to operating-system cleanup.
- [ ] `kill_subagent` requires an active full UUID, claims killed finalization, cooperatively aborts the child, cancels a blocked question, writes available partial text, disposes the child, and returns the result path without a second wake.
- [ ] The first natural completion, failure, or explicit kill wins; later terminal events cannot change status or create another result or acknowledgement.
- [ ] A finalizing child rejects controls, disappears from the footer, and releases its concurrency slot before disposal removes its registry record.
- [ ] Shutdown, session switch, and extension reload close parent delivery, abort active children without results, silently dispose finalizing children, cancel blocked questions, clear status, and emit no new notifications.
- [ ] Committed tree navigation closes launches, controls, and delivery before the leaf changes; aborts active children without results; silently disposes finalizing children; cancels blocked questions; and clears status before navigation completes.
- [ ] After tree navigation, one visible non-triggering notice lists stopped handles and warns that existing workspace changes were not reverted; no notice appears when no child was stopped.
- [ ] Opening or cancelling `/tree`, or selecting the current leaf, leaves children untouched because no committed tree transition occurred.
- [ ] Late progress, question, startup, completion, and failure callbacks after cleanup cannot emit onto a new session or branch.
- [ ] Behavioral tests cover both completion/kill orderings, cooperative cleanup, blocked-question cancellation, silent lifecycle cleanup, tree cleanup, and late callbacks.
