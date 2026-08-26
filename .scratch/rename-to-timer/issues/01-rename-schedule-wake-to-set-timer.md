# 01 — Rename the `schedule_wake` plugin and tool to `timer` / `set_timer`

**What to build:** The `pi-scheduled-wake` plugin ships as `pi-timer`, exposing a
single model-callable tool named `set_timer` in place of `schedule_wake`.
Scheduling behaviour is unchanged — the agent sets a relative timer, its run
ends, and a later turn wakes it to re-check external state. Only the names, the
one model-facing parameter, and the surrounding text/docs change. After this
ticket the whole repo (code, tests, docs, spec) refers to the tool as
`set_timer` and the plugin as `pi-timer`, and the suite is green from the new
paths.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

## Locked decisions (veto any line before implementing)

- **Tool name:** `schedule_wake` → `set_timer`; label `Schedule Wake` → `Set Timer`.
- **Parameter:** `afterSeconds` → `seconds` (reads as `set_timer(seconds, reason)`); `reason` unchanged.
- **Description/snippet/guidelines:** rewritten and **positively framed** to counter two wrong priors `set_timer` recruits — (a) that a timer runs *alongside* current work: the text must state the call **ends the current run** and a **later turn wakes** the agent when the timer fires; (b) that timers can be listed/cancelled: no such operations exist, so the text must not imply them. Keep the existing substance: advisory re-check (reschedule only while pending), call it **alone** after all other tool calls (a non-terminating sibling defeats early termination), prefer named `zmx` sessions for local jobs, usable for remote conditions like Kubernetes pod readiness.
- **Persisted marker strings:** `scheduled-wake-state` → `timer-state`, `scheduled-wake-cancelled` → `timer-cancelled`, `scheduled-wake` → `timer`. ⚠️ One-time consequence: a session resumed across the upgrade won't recover a wake persisted by the old build — negligible for a private `0.1.0`, but this is the single line with any correctness cost. Flip to "keep old strings" if you'd rather preserve cross-upgrade recovery.
- **Internal identifiers:** rename for consistency — `WAKE_*_TYPE` → `TIMER_*_TYPE`, `PendingWake` → `PendingTimer`, `RuntimeWake` → `RuntimeTimer`, `pendingWakes` → `pendingTimers`, `wakeId` → `timerId`, and the `readPendingWakes`/`findPendingWakes`/`persistPendingWakes` helpers to the timer vocabulary.
- **User-facing strings:** tool result and messages move to timer language ("Set a timer for N seconds", "Timer fired.", interrupted-timer recovery notice).
- **SPEC concept term:** the mechanism is now accurately a "timer", so rename the domain term "scheduled wake" → "timer" throughout `SPEC.md` and retitle it.
- **Package identity:** `git mv` dir `pi-scheduled-wake` → `pi-timer`, `extensions/scheduled-wake.ts` → `extensions/timer.ts`, `test/scheduled-wake.test.mjs` → `test/timer.test.mjs`; update `package.json` `name`/`keywords`/`description`, root `package.json` extension path, root `README.md` bullet, and the package `README.md`.
- **Sibling prose:** update the two `pi-subagents` strings and its README that say "you don't need to schedule a wake or poll for it" to reference `set_timer`.
- **Version:** bump `pi-timer` `0.1.0` → `0.2.0`. No back-compat `schedule_wake` alias — hard rename.

## Acceptance criteria

- [ ] The registered tool is `set_timer` (label "Set Timer") with parameters `seconds` (positive, ≤ runtime max) and non-empty `reason`; validation rejects zero/negative/non-finite delays and blank reasons exactly as before.
- [ ] Scheduling behaviour is byte-for-byte equivalent to today: returns a terminating result immediately, arms the timer, persists a complete pending-timer snapshot, fires one visible wake after the delay, keeps multiple timers independent, clears timers on shutdown, and reports interrupted timers on resume without rearming.
- [ ] The tool's description/snippet/guidelines state (positively) that the call ends the current run and a later turn wakes the agent, retain the "call it alone" and advisory-re-check guidance, and imply no list/cancel operations.
- [ ] No occurrence of `schedule_wake`, `Schedule Wake`, `scheduled-wake`, `scheduled_wake`, or "scheduled wake" remains outside `.scratch/`.
- [ ] Plugin lives at `packages/pi-timer/` with file/test renamed, `package.json` name `pi-timer` at version `0.2.0`, and root `README.md` + root `package.json` pointing at the new path.
- [ ] `pi-subagents` no longer tells the agent to "schedule a wake"; it references `set_timer`.
- [ ] `SPEC.md` describes the mechanism as a "timer" and names the tool `set_timer`; it still accurately describes behaviour and deliberate exclusions.
- [ ] Monorepo `npm test` and `npm run typecheck` are green (hard gate).
- [ ] Smoke check (not a gate): the extension loads under `pi`, the tool appears as `set_timer`, and a short timer fires a wake.
