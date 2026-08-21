# 04 — Document and verify the extension

**What to build:** Make the completed fresh-context subagent extension ready to install and operate from the repository, with concise user guidance and one verified compatibility target. The deferred fork-context design remains outside the shipped interface.

**Blocked by:** 03 — Finalize and cancel subagents safely.

**Status:** ready-for-agent

- [ ] Repository installation exposes the subagent extension and its three parent tools without manual package wiring.
- [ ] Documentation explains launch, UUID-based controls, reusable display names, model profiles, configurable concurrency, progress, questions, explicit kill, result files, and footer handles.
- [ ] Documentation states the cooperative cancellation limitation and explains shutdown, session-switch, reload, and `/tree` cleanup behavior, including retained workspace changes.
- [ ] Documentation makes clear that children start fresh, are runtime-only, cannot recursively orchestrate subagents, and cannot be resumed or polled after disposal.
- [ ] No fork/context launch option or dormant fork implementation is included in the first version.
- [ ] The complete behavioral suite passes without depending on private registry state or implementation call order.
- [ ] Type checking passes against Pi SDK `0.84.2` without speculative compatibility branches.
- [ ] A smoke verification covers installability, successful launch, UUID steering, progress, a blocking question and answer, explicit kill, natural completion, and committed tree cleanup.
- [ ] Core behavior is verified in non-TUI execution and footer behavior is verified independently as optional TUI presentation.
