# pi-timer

A [pi](https://pi.dev) extension that lets the agent set a relative timer, end its current run, and continue in a later turn without another user prompt.

The extension manages timers and session-local interruption metadata only. Use `zmx` when available—or another process manager—to own local long-running processes; timers can also revisit remote asynchronous state such as Kubernetes pod readiness.

## Behaviour

- **Ends the current run** — `set_timer` returns immediately; when called as the only tool in its batch, its terminating result ends the current agent run.
- **Wakes a later turn** — when the timer fires, an idle Pi session starts a new agent turn without user input.
- **Does not interrupt active work** — if the user already has the agent working, the timer message is queued as a follow-up.
- **Advisory, not completion-driven** — a timer tells the agent to inspect current local or remote state; it does not claim the work finished.
- **Does not restore timers** — runtime timers stop with their Pi session and are never rearmed after resume.
- **Reports interrupted timers** — unresolved timer metadata persists in the session; the next prompt after resume tells the agent which checks were interrupted without starting a turn automatically.
- **Process-agnostic** — the extension never starts, polls, or kills background processes.

## Agent workflow

For a local long-running command, prefer zmx when available and give the session a meaningful name:

```bash
zmx run build-check -d npm test
```

Then call `set_timer` with a self-contained reason that includes that session name:

```text
Set a timer for 60 seconds. Check zmx session build-check with zmx list. If it is
still active, call set_timer again; if it ended, inspect exit_code and report.
```

When the timer fires, use `zmx list` for a non-blocking status check. Active tasks have no `ended` field; completed tasks include `ended` and `exit_code`. Do not use `zmx wait` when the task may still be active because it blocks.

If zmx is unavailable, use another process manager and put its session or job name plus the corresponding status check in the timer reason. Avoid unmanaged raw `&` or `nohup`.

A timer can instead revisit remote work without a local process, such as checking whether a Kubernetes pod became Ready. Its reason should name the remote target, the status command, and what to do for pending and completed states.

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
