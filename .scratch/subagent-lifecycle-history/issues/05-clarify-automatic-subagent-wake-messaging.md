# 05 — Clarify automatic subagent wake messaging

**What to build:** Make all model-facing subagent launch messaging clearly tell the parent agent that it may end its turn immediately after launch. The guidance must explicitly reject waiting with a Bash sleep, setting a timer, or polling because Pi automatically notifies the parent when the child completes, fails, or asks a blocking question.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The launch tool description and successful launch result explicitly say that the parent agent may end its turn.
- [ ] The messaging explicitly says not to use a Bash `sleep`, `set_timer`, or status polling while waiting for a subagent.
- [ ] The messaging explains that completion, failure, and blocking questions automatically notify the parent.
- [ ] The guidance remains correct for inherited and named model profiles.
- [ ] Related model-facing orchestration descriptions do not contradict the launch guidance.
- [ ] User-facing documentation describes the same lifecycle guidance.
- [ ] Tests verify the required instructions without coupling to one complete exact string.
- [ ] No runtime lifecycle behavior changes.
