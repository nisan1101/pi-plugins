# pi-subagents

Fresh, in-process background subagents for [Pi](https://pi.dev). A child receives one delegated task without inheriting the parent conversation, while the parent remains free to continue working.

## Install

Install the repository package:

```bash
pi install https://github.com/nisan1101/pi-plugins
```

The repository manifest loads this extension automatically alongside the other plugins.

## Parent tools

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `subagent` | `display_name`, `prompt`, optional `model_profile` | Starts a child in the background and immediately returns a full UUID. Pi wakes the parent automatically when the child completes, fails, or asks a blocking question, so the parent may end its turn right after launch or keep working on unrelated scope. Do not wait with a Bash `sleep`, `set_timer`, or status poll. |
| `message_subagent` | full `id`, `message` | Steers the addressed child after its current tool-call batch, or answers its pending question directly. |
| `kill_subagent` | full `id` | Signals cooperative cancellation and immediately acknowledges the child as killed (no result); shutdown and disposal continue in the background. |

The UUID is the only control identifier. Display names are reusable labels, and short UUID prefixes are display-only. Do not modify a delegated scope while its UUID is active; send guidance or kill the child first.

## Configuration

Configuration is global at `$PI_CODING_AGENT_DIR/subagents.json`, which defaults to `~/.pi/agent/subagents.json`:

```json
{
  "maxConcurrent": 4,
  "profiles": {
    "low": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "thinkingLevel": "low"
    },
    "high": {
      "provider": "anthropic",
      "model": "claude-opus-4-6",
      "thinkingLevel": "high"
    }
  }
}
```

- `maxConcurrent` limits starting, running, and waiting children. It defaults to `4`; an invalid value warns and falls back to `4`. Excess launches are rejected rather than queued.
- `inherit` is the default profile and uses the parent's current model and thinking level.
- Named profiles are `low`, `medium`, `high`, and `xhigh`. A configured mapping requires an available provider/model and a thinking level supported by that model.
- Requesting a named profile with no mapping—including when the file or `profiles` object is absent—falls back to `inherit` and says so in the successful launch response. Malformed configuration and configured profiles that are invalid or unavailable still reject launch.
- Project-local profile overrides are not supported.

## Communication and results

Children receive a private `message_parent` tool:

- `progress` reports a meaningful milestone without waking the parent or blocking the child. It is recorded immediately. If the parent is busy, the report does not enter that run's already-captured model context; it remains available to future parent turns.
- `question` blocks the child until `message_subagent` answers it. If the parent is busy, the question is queued as steering after the parent's current tool-call batch and before its next model call. If the parent is idle, it starts a turn immediately. One question may be pending per child, with no automatic timeout.

Parent guidance follows the same safe boundary in the other direction: `message_subagent` steers a running child after its current tool-call batch and before its next model call. An answer to a pending question instead completes the child's blocked `message_parent` tool call directly. Neither direction aborts an in-flight tool.

Natural completion or failure releases the child's active slot and queues the parent notification exactly once before finishing session cleanup, so slow cleanup cannot delay the actionable boundary. The notification inlines the child's terminal text directly. The result is the visible terminal text verbatim (multiple text blocks preserved in order); it excludes thinking, tool activity, communication messages, provider metadata, and the full transcript. Failure additionally inlines the error, and an explicit placeholder is used when the child produced no terminal text. The result is not truncated and no file is written—if you need an on-disk artifact, tell the child to write one in the delegated prompt.

Explicit kill claims the killed outcome and releases any pending child question immediately. For an instantiated child, cancellation is signalled before the bare acknowledgement returns; for a child still starting, it is signalled as soon as construction finishes. Abort, shutdown, and disposal then continue through the same exactly-once cleanup path in the background. The acknowledgement contains no partial text or artifact, and the child sends no later completion wake. To keep in-progress work, message the child to summarize and let it complete naturally instead. There is no result-polling tool.

## Footer

In TUI mode, active children appear in Pi's existing footer with a static themed lifecycle glyph: dim `◌` while starting, success-colored `*` while running, and warning-colored `?` while waiting for a parent answer. Only the glyph is colored; each handle remains `display-name#1234abcd`. The footer shows up to three handles and a `+N` remainder, then clears when no child is active.

The footer is optional presentation only. Launch, communication, results, and cleanup also work in RPC, JSON, and print modes.

## Activity log

From launch onward, each child appends a private plain-text activity log to `<tmpdir>/pi-subagents-<parentPid>/<uuid>.log`, in every run mode. Each line carries a short local `HH:MM:SS` prefix. The log records assistant text on message completion, tool activity (name plus success/failure) at tool-execution start and end, the parent exchange (progress, question, waiting-for-parent, answer), and the terminal outcome (completed / failed / killed). Thinking is never written.

The file is created at launch and only ever appended, so you can follow a running child live—for example `tail -n +1 -F "<path>"`—and attaching later still shows prior history. The per-parent-process directory is removed on shutdown and `/tree` navigation cleanup.

## Live viewer

In interactive (TUI) mode, `/subagents` opens an arrow-key picker of the active children (display name, short UUID prefix, and lifecycle phase). Enter selects; Esc cancels. Selecting a child opens its live output in an external multiplexer window that follow-tails the activity log from its start—Pi never renders the transcript itself.

Display support is pluggable: an ordered list of backends is tried and the first available one is used. The built-in list ships one backend:

- **zellij** — available when Pi runs inside a zellij session and the `zellij` binary is on `PATH`. Opens a named floating pane running `tail -n +1 -F "<log>"`.

When no supported multiplexer is available—or when opening one fails—the command surfaces the exact manual command to watch the log yourself (`tail -n +1 -F "<log>"`) plus a nudge to run Pi inside a supported multiplexer. That command is shown in the UI only and is never injected into parent-model context. The viewer is read-only: it cannot steer, answer, or kill the child. Outside interactive mode, `/subagents` reports that it needs interactive mode and does nothing.


## Lifecycle and limitations

- `kill_subagent` is cooperative. Same-process synchronous code, or an extension that ignores cancellation, cannot be force-stopped.
- Shutdown, session switching, and `/reload` close parent delivery, reject pending questions, cooperatively abort active children without results, silently finish disposal, and clear footer state.
- Committed `/tree` navigation performs the same cleanup before moving branches, then posts one non-triggering notice listing stopped handles. Opening or cancelling the selector, or selecting the current leaf, does not stop children.
- Pi SDK `0.84.2` has no confirmed non-cancellable tree pre-commit hook. If a later extension vetoes navigation after this extension handles `session_before_tree`, the children remain stopped and controls remain closed until the extension/session reloads.
- Cleanup never reverts workspace changes already made by a child.

## Fresh-context boundary

Each child is runtime-only and starts with no parent conversation messages. It receives the parent's effective system prompt, working directory, selected model configuration, active work-tool names, and freshly rediscovered configured extensions and skills. Temporary `pi -e` extensions, SDK-inline factories, parent-only resource paths, and runtime-injected custom tools cannot be cloned through Pi SDK `0.84.2`.

Children cannot launch or control subagents recursively. After completion, failure, kill, lifecycle cleanup, or tree cleanup, their sessions are disposed and UUIDs become unknown. They cannot be resumed or polled. Forking or inheriting parent conversation context is not part of this version.

## Compatibility and development

The verified compatibility target is Pi SDK `0.84.2`.

```bash
npm install
npm test
npm run typecheck
npm pack --dry-run
```
