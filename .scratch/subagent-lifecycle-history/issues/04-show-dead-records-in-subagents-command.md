# 04 — Show active and dead records in the subagents command

**What to build:** Expand `/subagents` into a newest-first branch-history picker. Active subagents can still open their live viewer, while completed, failed, and killed records remain visible as disabled rows that cannot be selected.

**Blocked by:** 03 — List all branch subagents through a parent tool.

**Status:** ready-for-agent

- [ ] `/subagents` displays every record known on the active branch rather than only active children.
- [ ] Rows show the subagent handle and one user-facing status, ordered by creation time descending.
- [ ] `starting`, `running`, and `waiting` rows are selectable and retain the existing live-viewer behavior.
- [ ] `completed`, `failed`, and `killed` rows are visibly disabled and cannot be selected or open a viewer.
- [ ] A branch containing only terminal records still opens the history picker instead of reporting that no active subagents exist.
- [ ] Cancelling the picker performs no action.
- [ ] Existing automatic viewer selection and manual follow-tail fallback remain unchanged for selectable active records.
- [ ] Outside interactive mode, the command continues to report that interactive mode is required and performs no action.
- [ ] Behavioral tests verify newest-first ordering, mixed active and terminal rows, dead-only history, disabled-row navigation, active selection, and cancellation.
