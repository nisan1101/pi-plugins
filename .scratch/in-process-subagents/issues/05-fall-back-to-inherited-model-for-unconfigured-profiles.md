# 05 — Fall back to inherited model for unconfigured profiles

**What to build:** Let a subagent launch continue with the parent model and thinking level when its requested named model profile has no global configuration, while keeping genuine configuration and model errors explicit.

**Blocked by:** None — can start immediately.

**Type:** task

**Status:** resolved

- [x] Requesting `low`, `medium`, `high`, or `xhigh` with no corresponding global profile entry launches the child using the parent model and thinking level, including when the configuration file or `profiles` object is absent.
- [x] The successful launch response identifies the requested profile and states that `inherit` was used, so the fallback is visible in TUI, print, JSON, and RPC workflows without a separate TUI-only notification.
- [x] The child result records `inherit` as the model profile and records the inherited model and thinking level that actually ran; it does not add separate requested-profile metadata.
- [x] Malformed or unsupported profile definitions, configured profiles with unavailable models or authentication, unsupported thinking levels, and an unavailable parent model continue to reject launch without allocating an active child.
- [x] Behavioral checks cover both the successful missing-profile fallback and the unchanged error cases.
- [x] The product specification and user documentation describe the fallback boundary and no longer claim that an unconfigured named profile is rejected.

## Answer

Unconfigured named profiles now resolve to the parent's model and thinking level, announce the fallback in the successful tool response, and record `inherit` in result metadata. Invalid or unusable configurations still fail before child allocation.

Verified all four named-profile fallbacks across parent execution modes, unchanged configuration and model errors, 24 subagent tests, 10 scheduled-wake regressions, and both package type checks.

Context: [feature map](../map.md).
