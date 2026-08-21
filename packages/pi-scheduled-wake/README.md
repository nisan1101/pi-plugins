# pi-scheduled-wake

A [pi](https://pi.dev) extension that lets the agent schedule a future turn, become idle, and continue later without another user prompt.

The extension manages only timers. Use `zmx` when available—or another process manager—to own local long-running processes; scheduled wakes can also revisit remote asynchronous state such as Kubernetes pod readiness.

## Behaviour

- **Releases the agent** — `schedule_wake` returns immediately; when called as the only tool in its batch, its terminating result ends the current agent run.
- **Wakes without user input** — when the timer expires, an idle Pi session starts a new agent turn.
- **Does not interrupt active work** — if the user already has the agent working, the wake is queued as a follow-up.
- **Advisory, not completion-driven** — a wake tells the agent to inspect current local or remote state; it does not claim the work finished.
- **Session-scoped** — pending wakes are cleared when the Pi session shuts down and are not restored later.
- **Process-agnostic** — the extension never starts, polls, or kills background processes.

## Agent workflow

For a local long-running command, prefer zmx when available and give the session a meaningful name:

```bash
zmx run build-check -d npm test
```

Then call `schedule_wake` with a self-contained reason that includes that session name:

```text
Wake in 60 seconds. Check zmx session build-check with zmx list. If it is
still active, schedule another wake; if it ended, inspect exit_code and report.
```

On wake, use `zmx list` for a non-blocking status check. Active tasks have no `ended` field; completed tasks include `ended` and `exit_code`. Do not use `zmx wait` when the task may still be active because it blocks.

If zmx is unavailable, use another process manager and put its session or job name plus the corresponding status check in the wake reason. Avoid unmanaged raw `&` or `nohup`.

A wake can instead revisit remote work without a local process, such as checking whether a Kubernetes pod became Ready. Its reason should name the remote target, the status command, and what to do for pending and completed states.

## Install

Install the monorepo directly from GitHub:

```bash
pi install https://github.com/nisan1101/pi-plugins
```

## Development

```bash
npm install
npm test
npm run typecheck
```

See `SPEC.md` for the complete behavior and deliberate exclusions.
