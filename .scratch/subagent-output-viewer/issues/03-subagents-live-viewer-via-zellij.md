# 03 — `/subagents` live viewer via zellij

**What to build:** A user running Pi in an interactive terminal can type
`/subagents`, see the active subagents in an arrow-key picker, select one, and
watch its live output stream in an external multiplexer window (a zellij floating
pane in v1). When no supported multiplexer is available, the user instead gets the
exact `tail` command to watch the log themselves. Pi never renders the transcript
itself. The display mechanism sits behind a pluggable backend interface so more
multiplexers can be added later without touching the command, formatter, or log.

**Blocked by:** 01 — Subagent activity log (the viewer streams the log file).

**Status:** resolved

- [x] A `SubagentDisplay` backend interface exists with a stable `id`, an `isAvailable()` predicate, and a `show(view)` method, where `view` carries the subagent id, a title, and the log path. Backends are held in an ordered array; the extension selects the first whose `isAvailable()` is true. The array is injectable through the existing extension options and defaults to the built-in list.
- [x] A zellij backend ships: `isAvailable()` returns true only when Pi is running inside a zellij session (session environment variable set) and the `zellij` binary is on PATH; `show()` opens a named floating pane that follow-tails the subagent's log from its start.
- [x] The zellij argv construction is a pure function, unit-tested without spawning zellij; `isAvailable()` is tested under present/absent environment.
- [x] A `/subagents` command is registered. When run outside interactive (TUI) mode it notifies that it requires interactive mode and does nothing.
- [x] When there are no active subagents, the command notifies accordingly and does not show a picker.
- [x] Otherwise the command shows an arrow-key picker of the active subagents (display name, short UUID prefix, lifecycle phase); Enter selects, Esc cancels. The picker is shown whether or not a backend is available.
- [x] On selection with an available backend, the subagent's live output opens in that backend's window (zellij floating pane).
- [x] On selection with no available backend, the command surfaces the exact command to watch manually (`tail -n +1 -F "<logPath>"`) plus a nudge to run Pi inside a supported multiplexer for automatic viewers.
- [x] If a backend is available but `show()` fails, the command falls back to surfacing the same manual `tail` command.
- [x] The manual `tail` command is surfaced in a way that is readable/copyable and is not injected into parent-model context.
- [x] Opening a viewer is read-only: it cannot steer, answer, or kill the subagent.
- [x] The extension is exercised through its single injection seam: a fake `displays` array (and the existing fake `createChildSession`) drives `/subagents` selection and asserts the resulting `show(view)` carries the correct subagent id, title, and log path. The mock `pi` gains command-registration support.

## Answer

Shipped in `packages/pi-subagents`:

- `extensions/subagent-display.ts` — the `SubagentDisplay` interface + `SubagentView`, the pure `zellijArgv`, `createZellijDisplay` (injectable `env`/`hasBinary`/`spawnPane`), `tailCommand`, and the ordered `defaultDisplays`.
- `extensions/subagents.ts` — `displays` injection option (defaults to `defaultDisplays`) and the `/subagents` command: interactive-mode guard, active-only picker via `ctx.ui.select` (display name, short UUID, phase), first-available backend selection, `show(view)`, and manual-`tail` fallback (with nudge when no backend, without on `show()` failure) surfaced through `ui.notify` only.
- `test/subagent-display.test.mjs` and command tests in `test/subagents.test.mjs` (mock `pi` gained `registerCommand`; harness gained a fake `displays` array and `ui.select`).

Note: used the built-in `ctx.ui.select` picker rather than hand-rolling `SelectList`; it provides arrow-key nav + Enter + Esc and the three fields are inlined per option.
