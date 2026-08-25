# 06 — Show subagent lifecycle indicators in the footer

**What to build:** Make each active subagent's lifecycle state visible at a glance in Pi's existing footer status while preserving the compact handle list and optional TUI-only presentation.

**Blocked by:** None — can start immediately.

**Type:** task

**Status:** resolved

- [x] Each TUI footer handle is prefixed with a static state glyph: `◌` while starting, `*` while running, and `?` while waiting for a parent answer.
- [x] Only the glyph is themed: starting uses the dim color, running uses the success color, and waiting uses the warning color; the handle remains in the footer's normal text style.
- [x] The footer refreshes when a child launches, finishes starting, asks a blocking question, and resumes after the parent answers, so the displayed glyph matches its current controllable lifecycle state.
- [x] Finalizing, completed, failed, and killed children remain absent from the footer; their existing result and notification behavior is unchanged.
- [x] The existing limit of three visible handles, `+N` overflow indicator, stable ordering, short display-only IDs, and clearing when no active child remains are preserved.
- [x] Indicators remain static—no animation, elapsed time, progress text, token counts, custom footer, or persistent widget is added.
- [x] RPC, JSON, and print workflows remain independent of footer presentation.
- [x] Behavioral checks cover each visible state and transition, overflow, cleanup, and non-TUI behavior.
- [x] The product specification and user documentation describe the glyph and color semantics.

## Answer

Active footer handles now show a static, theme-colored lifecycle glyph while leaving each display name and short ID unstyled. Status refreshes cover launch, startup completion, blocking questions, and parent answers; existing overflow, finalization, cleanup, and non-TUI behavior remains unchanged.

Verified 25 subagent behavior tests, 10 scheduled-wake regressions, and both package type checks.

Context: [feature map](../map.md).
