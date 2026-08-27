# 03 — List all branch subagents through a parent tool

**What to build:** Give the parent agent a `list_subagents` tool that reports every subagent known on the active branch, including long-dead checkpointed records, through one stable newest-first view.

**Blocked by:** 02 — Checkpoint subagent history and reconcile tree navigation.

**Status:** ready-for-agent

- [ ] `list_subagents` is available to the parent and accepts no identifier or polling parameters.
- [ ] The tool returns every record on the active branch, including active and checkpointed terminal records.
- [ ] Each record includes its full UUID, display name, creation time, and user-facing status.
- [ ] User-facing statuses are limited to `starting`, `running`, `waiting`, `completed`, `failed`, and `killed`; the internal finalization phase is never exposed.
- [ ] Records are sorted by creation time descending, with the newest subagent first.
- [ ] An empty branch produces a clear successful response rather than an error.
- [ ] Results remain consistent after Pi restart, session resume, explicit kill, natural completion, failure, and committed tree navigation.
- [ ] The tool is excluded from child sessions alongside the other parent-only orchestration tools.
- [ ] Behavioral tests verify field completeness, ordering, every status, empty history, branch isolation, and recovered terminal records.
