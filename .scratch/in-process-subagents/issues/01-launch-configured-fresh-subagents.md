# 01 — Launch configured fresh subagents

**What to build:** Add the installable subagent extension and make one UUID-addressed, display-labelled child run end to end from background launch through successful result delivery and automatic disposal. The child starts with a fresh conversation while inheriting the parent’s effective project contract, and launch policy comes from the global model-profile and concurrency configuration.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `subagent` accepts a non-empty display name and prompt, supports the agreed model profiles, and returns a terminating result containing the exact display name and a generated full UUID.
- [x] Duplicate display names are accepted with distinct UUIDs; display names never act as control identifiers.
- [x] Launch returns immediately while child creation and execution continue asynchronously.
- [x] The child starts with no parent conversation messages and receives the delegated task as its first and final user message with UUID, display name, and fresh-context identity.
- [x] The child inherits the parent’s effective system guidance, cwd, active work tools, extensions, skills, model, and thinking level while orchestration tools remain unavailable.
- [x] The child role contract establishes parent authority, shared-workspace safety, narrow delegated scope, fresh-file inspection, and conflict reporting without unrelated reversion.
- [x] Global profile resolution supports `inherit`, `low`, `medium`, `high`, and `xhigh`; invalid or unavailable profiles fail without leaving an active child.
- [x] `maxConcurrent` defaults to four, accepts positive configured values, warns and falls back on invalid values, and rejects excess launches without queuing.
- [x] A successful child writes the agreed private temporary result, is disposed, and then notifies the parent exactly once with its UUID, display name, preview, and path.
- [x] TUI status shows display-name/short-ID handles and clears after disposal, while launch and completion remain functional without a TUI.
- [x] Behavioral tests exercise the extension through its registered tool and lifecycle surface using an injected child-session collaborator.

## Answer

Implemented the fresh in-process launch path, global profile/concurrency policy, configuration-equivalent resource rediscovery, compact status, private successful results, and post-disposal parent notification. Behavioral tests cover the injected child-session seam and one production SDK resource/lifecycle flow.
