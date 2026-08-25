<!-- triage: ready-for-agent -->

# Subagent Output Viewer

## Problem Statement

Subagents run in-process and headless. While a subagent is active, the parent
agent and the user only ever see three moments per child: the launch
acknowledgement, any intentional `message_parent` progress or question, and the
final result. There is no way to watch what a subagent is actually doing in
flight — its tool calls, its assistant text, whether it is progressing or stuck.

Users want to open a live view of one active subagent's output on demand. Pi
should not render that view inside its own TUI; the display should be produced by
an external terminal multiplexer the user already runs, so that Pi stays out of
window management and transcript rendering. The first supported multiplexer is
zellij, with room to add zmx, tmux, and others without reworking the extension.

Separately, the messages a subagent surfaces (launch, progress, completion) carry
no time information, so neither the parent agent nor the user can tell how long a
subagent has been running or whether it is progressing quickly or slowly.

## Solution

Add an on-demand live output viewer for active subagents, plus wall-clock
timestamps on subagent lifecycle messages.

Every subagent writes its activity, from launch onward, to a private append-only
log file — one file per subagent. A small formatter turns the subagent's
in-process event stream into plain-text lines (assistant text, tool activity,
lifecycle markers) and appends them to that file. The file is the bridge between
the in-process subagent and any external process that can read a file.

A new `/subagents` command lists the active subagents in an arrow-key picker.
Selecting one opens its live output in an external multiplexer window that streams
the log file (for zellij, a floating pane running a follow-tail of the log). Esc
cancels the picker. If no supported multiplexer is available, the command explains
that Pi will not render the output itself and that the user should run Pi inside a
supported multiplexer.

The display mechanism sits behind a small display-backend interface so that new
multiplexers can be added as additional backends without touching the command, the
formatter, or the log bridge. The extension selects the first available backend.

Finally, subagent lifecycle messages (launch acknowledgement, progress,
completion/failure) and every log line carry a wall-clock timestamp. The extension
computes no elapsed time or deltas; it stamps the raw wall-clock and lets each
reader — the parent agent or the user — interpret duration and pace as they wish.

## User Stories

1. As a user, I want a `/subagents` command that lists the currently active subagents, so that I can choose one to watch.
2. As a user, I want each listed subagent shown by its display name and short UUID prefix, so that I can recognize which child is which.
3. As a user, I want each listed subagent to indicate its lifecycle phase, so that I can tell starting from running from waiting at a glance.
4. As a user, I want to move through the list with the arrow keys, so that selection matches Pi's other pickers.
5. As a user, I want Enter to open the selected subagent's live output, so that selection is unambiguous.
6. As a user, I want Esc to cancel the picker without opening anything, so that I can back out safely.
7. As a user, I want the selected subagent's output to open in an external multiplexer window, so that Pi does not have to render a transcript inside its own TUI.
8. As a zellij user, I want the output to open in a floating pane, so that it overlays my current layout without disrupting it.
9. As a user, I want the viewer to stream the subagent's output live, so that I can watch tool calls and assistant text as they happen.
10. As a user, I want the log to capture activity from the moment the subagent launched, so that attaching to an already-running subagent still shows its history, not just future events.
11. As a user, I want to close and reopen the viewer without losing history, so that a glance away does not cost me the transcript.
12. As a user, I want to open the viewer for a subagent that just started and see it fill in as work begins, so that an empty window is expected, not an error.
13. As a user, I want a clear message when no supported multiplexer is available, so that I understand Pi will not render the output itself and know how to enable it.
14. As a user, I want only active subagents listed, so that the picker reflects what I can actually watch.
15. As a user, I want a helpful message when there are no active subagents, so that an empty picker is explained rather than shown blank.
16. As a user, I want `/subagents` to tell me it needs interactive mode when run outside the TUI, so that non-interactive modes fail clearly.
17. As a user, I want the log to include the subagent's assistant text, so that I can read what it produced.
18. As a user, I want the log to include tool activity (which tool ran and whether it succeeded), so that I can follow what the subagent did.
19. As a user, I want the log to mark when the subagent is waiting for a parent answer, so that a pause in output is explained rather than looking like a stall.
20. As a user, I want the log to record progress reports, questions, and the parent's answers, so that the viewer reflects the full parent-child exchange.
21. As a user, I want thinking excluded from the log, so that the viewer stays focused on output and does not persist raw reasoning to a temp file.
22. As a user, I want each log line to carry a wall-clock timestamp, so that I can judge pace by eye or pipe the stream through my own timing tool.
23. As a user, I want the launch acknowledgement to carry a wall-clock timestamp, so that the parent agent and I have an anchor to measure elapsed time against.
24. As a user, I want progress reports to carry a wall-clock timestamp, so that I can tell when a milestone was reached.
25. As a user, I want completion and failure messages to carry a wall-clock timestamp, so that I can tell when the subagent finished and how long it took.
26. As a parent agent, I want raw wall-clock timestamps rather than pre-computed durations, so that I can interpret elapsed time and pace however the task requires.
27. As a user, I want `message_parent` progress to remain available, so that the parent model still receives curated mid-flight milestones in its context even when I am not watching the viewer.
28. As a user, I want subagent log files cleaned up when the session shuts down or navigates the tree, so that watched runs do not accumulate temporary files.
29. As a maintainer, I want a new multiplexer to be addable as an additional display backend without changing the command, the formatter, or the log bridge, so that display support is genuinely pluggable.
30. As a maintainer, I want the extension to select the first available display backend, so that detection is automatic and predictable.
31. As a user, I want opening the viewer to be read-only, so that watching a subagent cannot accidentally steer or kill it.
32. As a user, I want the log written regardless of run mode, so that I can tail a subagent's log file manually even without a supported multiplexer.

## Implementation Decisions

- **Log bridge.** Each subagent gets one private append-only log file under a
  per-parent-process directory in the system temp location, keyed by subagent
  UUID. The file is created at launch and written from launch onward. Writing
  happens in all run modes; only the `/subagents` command and the display are
  TUI-only.

- **Log formatter.** A pure function maps subagent stream events to plain-text log
  lines. It subscribes at message-level granularity: assistant text on message
  completion, and tool activity on tool-execution start and end. It also emits
  lifecycle markers for waiting-for-parent, progress, question, answer, and
  terminal outcome (completed / failed / killed). Thinking is excluded. Each line
  is prefixed with a wall-clock timestamp (`HH:MM:SS` in the log).

- **Log sink.** File appends go through an injectable sink so tests never touch the
  filesystem. The default sink appends to the subagent's log file.

- **Display backend interface.** A `SubagentDisplay` has a stable `id`, an
  `isAvailable()` predicate (environment plus binary presence), and a
  `show(view)` method. `view` carries `{ subagentId, title, logPath }`. The
  interface expresses intent ("show this subagent's live output"); each backend
  owns its mechanism. Backends are held in an ordered array; the extension selects
  the first whose `isAvailable()` returns true. The array is injectable through the
  existing extension options (alongside `createChildSession`), and defaults to the
  built-in list.

- **Zellij backend (v1).** `isAvailable()` checks that the zellij session
  environment variable is set and the `zellij` binary is on PATH. `show()` opens a
  named floating pane running a follow-tail of the log file from its start. The
  argv construction is a pure function so it can be unit-tested without spawning
  zellij.

- **`/subagents` command.** Registered via the extension API. Requires interactive
  mode. Lists active subagents (display name, short UUID prefix, phase) in an
  arrow-key picker built from the documented SelectList pattern; Enter selects, Esc
  cancels. On selection it resolves the first available backend and calls
  `show()`. With no active subagents, no available backend, or non-interactive
  mode, it notifies with the corresponding explanation instead of opening a view.

- **Timestamps.** The extension stamps raw wall-clock only and computes no elapsed
  time or deltas. Launch acknowledgement, progress, and completion/failure
  messages include an ISO wall-clock timestamp in their text so the parent agent
  can subtract them. Log lines use a short local `HH:MM:SS` prefix for the human
  reader.

- **`message_parent` progress retained.** Progress continues to be delivered into
  parent-model context without triggering a turn. The viewer serves the user; the
  progress channel serves the parent model. They are complementary, not redundant.

- **Cleanup.** The per-parent-process log directory is removed during the existing
  shutdown and tree-navigation cleanup paths. Reopening a viewer while a subagent
  is still active is allowed and simply spawns another follower on the same file.

## Testing Decisions

- **What makes a good test here.** Tests assert externally observable behavior:
  which backend `show()` is called with which `view`, what lines the formatter
  produces for a given event sequence, what argv the zellij backend builds for a
  given environment, and how the command responds when there are no active
  subagents, no available backend, or it runs outside the TUI. Tests do not assert
  private state, file paths, or internal call ordering beyond what the behavior
  requires.

- **Modules tested.**
  - The extension via its single injection seam: a fake `displays` array and a
    fake `createChildSession`, exercising `/subagents` selection and asserting the
    resulting `show(view)`.
  - The log formatter as a pure function: event sequence in, log lines out,
    including timestamp prefix, lifecycle markers, and thinking exclusion.
  - The zellij backend's argv construction as a pure function: environment and view
    in, argv out; `isAvailable()` under present/absent environment.
  - The log sink injected as a fake so no test writes to the filesystem.

- **Prior art.** The existing subagents test suite already fakes
  `createChildSession` and a mock `pi` object and drives tools through a
  `callTool` helper. The new tests extend that mock to support command
  registration and add a fake `displays` array, following the same structure.

## Out of Scope

- Token-level streaming (message-level granularity only in v1).
- Rich ANSI or transcript rendering that mirrors Pi's own UI; the log is plain text.
- Viewing subagents that have already finalized; the picker is active-only with no
  grace period.
- Configuration in `subagents.json` to force, disable, or order display backends;
  detection is automatic in v1.
- Interactive control (steer, answer, kill) from inside the viewer window; the
  viewer is read-only.
- Elapsed-time or pace computation inside the extension; only raw wall-clock is
  emitted.
- Additional backends beyond zellij (zmx, tmux); the interface is designed to admit
  them, but only zellij ships in v1.

## Further Notes

- Because the viewer streams a plain file, a user who wants inter-line deltas can
  pipe the tail through an external timing tool (for example `ts -i` from
  moreutils) with no support code in the extension.
- A regular temp file is effectively RAM-speed for this workload: the OS page cache
  keeps an actively-written, actively-tailed file in memory, so no in-memory
  filesystem, FIFO, or socket is warranted. On Linux a tmpfs path could be
  substituted in one line if profiling ever showed disk in the hot path; it will
  not at token output rates.
- The viewer does not feed the parent model. The parent's only in-flight signal
  remains `message_parent` progress and questions, which is why that channel stays.
