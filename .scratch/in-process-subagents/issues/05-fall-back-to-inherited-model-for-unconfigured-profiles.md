# 05 — Fall back to inherited model for unconfigured profiles

**What to build:** Let a subagent launch continue with the parent model and thinking level when its requested named model profile has no global configuration, while keeping genuine configuration and model errors explicit.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Requesting `low`, `medium`, `high`, or `xhigh` with no corresponding global profile entry launches the child using the parent model and thinking level, including when the configuration file or `profiles` object is absent.
- [ ] The successful launch response identifies the requested profile and states that `inherit` was used, so the fallback is visible in TUI, print, JSON, and RPC workflows without a separate TUI-only notification.
- [ ] The child result records `inherit` as the model profile and records the inherited model and thinking level that actually ran; it does not add separate requested-profile metadata.
- [ ] Malformed or unsupported profile definitions, configured profiles with unavailable models or authentication, unsupported thinking levels, and an unavailable parent model continue to reject launch without allocating an active child.
- [ ] Behavioral checks cover both the successful missing-profile fallback and the unchanged error cases.
- [ ] The product specification and user documentation describe the fallback boundary and no longer claim that an unconfigured named profile is rejected.
