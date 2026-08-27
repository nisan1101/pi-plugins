# 01 — Acknowledge explicit subagent kills immediately

**What to build:** Make an explicit subagent kill complete immediately from the parent agent's perspective. The target becomes `killed` and the parent receives one confirmation without waiting for cooperative abort, child shutdown, or disposal; resource cleanup continues safely in the background.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Killing an active subagent with its full UUID immediately returns a confirmation that identifies it as killed.
- [ ] The cancellation signal is fired before the confirmation returns, but the tool does not wait for the child to become idle or for shutdown and disposal to finish.
- [ ] A child waiting on a parent question is released from that wait when killed.
- [ ] Starting, running, and waiting children each enter the same exactly-once terminal cleanup path.
- [ ] Repeated kill or message attempts after the kill claim are rejected without starting another cleanup.
- [ ] Late progress, questions, completion, and failure callbacks cannot wake the parent or replace the killed outcome.
- [ ] Explicit kill returns no partial child result or artifact and produces no later completion notification.
- [ ] Behavioral tests prove that confirmation returns while deliberately blocked abort and shutdown work remains unfinished.
