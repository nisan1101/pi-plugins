# 01 — Subagent activity log

**What to build:** Every subagent records what it does to a private, append-only
log file from the moment it launches, so a user (or another process) can follow a
subagent's activity in real time by tailing that file — in any run mode. This
ticket delivers only the log; no command and no viewer yet.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Each subagent gets one private append-only log file, created at launch, under a per-parent-process directory in the system temp location, keyed by the subagent UUID.
- [ ] The log is written in all run modes (tui, print, rpc, json), not only TUI.
- [ ] A pure formatter maps the subagent's in-process event stream to plain-text log lines at message-level granularity: assistant text on message completion, and tool activity (tool name + success/failure) on tool-execution start and end.
- [ ] The formatter emits lifecycle markers: waiting-for-parent, progress report, question, parent answer, and terminal outcome (completed / failed / killed).
- [ ] Thinking is excluded from the log.
- [ ] Each log line is prefixed with a short local wall-clock timestamp (`HH:MM:SS`). No elapsed time or deltas are computed.
- [ ] File appends go through an injectable sink so tests never touch the filesystem; the default sink appends to the subagent's log file.
- [ ] The per-parent-process log directory is removed during the existing shutdown and tree-navigation cleanup paths.
- [ ] Reopening/attaching to an already-running subagent's log shows prior history (the file is not truncated on attach).
- [ ] The pure formatter is unit-tested: an event sequence in produces the expected log lines, including timestamp prefix, lifecycle markers, and thinking exclusion.
