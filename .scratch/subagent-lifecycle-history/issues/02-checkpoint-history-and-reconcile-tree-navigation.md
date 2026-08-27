# 02 — Checkpoint subagent history and reconcile tree navigation

**What to build:** Preserve branch-local subagent history across Pi restarts and tree navigation. Previously active children become durable killed records rather than disappearing, and the parent receives one immediate, non-triggering confirmation while child cleanup continues in the background.

**Blocked by:** 01 — Acknowledge explicit subagent kills immediately.

**Status:** ready-for-agent

- [ ] Complete branch-local checkpoints retain every known subagent's full ID, display name, creation time, and user-facing status without pruning terminal records.
- [ ] Checkpoint recovery uses the newest valid marker on the active branch and does not import records that exist only on another branch or unrelated session.
- [ ] A Pi restart, reload, or later resume converts checkpointed `starting`, `running`, and `waiting` records to `killed`; it never restores or resumes their child sessions.
- [ ] Recovery emits one visible, non-triggering confirmation and writes a terminal marker so repeated starts do not repeat the notice.
- [ ] Already-terminal `completed`, `failed`, and `killed` records survive recovery unchanged.
- [ ] Cancelled tree navigation, opening the tree selector, and selecting the current leaf leave children, controls, and checkpoint history untouched.
- [ ] Committed tree navigation immediately claims active children as killed, invalidates their old-timeline deliveries, checkpoints the new branch, and sends its confirmation without waiting for background shutdown or disposal.
- [ ] The tree confirmation contains killed handles but no delegated prompts, results, errors, or explanation for the navigation.
- [ ] The tree confirmation retains the safety warning that existing workspace changes were not reverted.
- [ ] Late child callbacks cannot add progress, questions, or terminal results to the newly selected branch.
- [ ] Malformed checkpoint markers are skipped safely rather than blocking session startup or tree navigation.
- [ ] Behavioral tests cover restart recovery, idempotent notices, branch-local selection, downstream tree cancellation, committed navigation, immediate confirmation, and delayed cleanup.
