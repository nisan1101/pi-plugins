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
| `subagent` | `display_name`, `prompt`, optional `model_profile` | Starts a child in the background and immediately returns a full UUID. Call it by itself after other tool calls; a successful launch terminates the parent run. |
| `message_subagent` | full `id`, `message` | Steers the addressed child, or answers its pending question. |
| `kill_subagent` | full `id` | Cooperatively stops the addressed child and returns its result path. |

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

- `progress` reports a meaningful milestone without waking the parent or blocking the child. The report remains visible in future parent model context.
- `question` wakes the parent and blocks the child until `message_subagent` answers it. One question may be pending per child, with no automatic timeout.

Natural completion or failure writes a user-only temporary `result.md`, disposes the child, and wakes the parent once with a bounded preview and path. The file records the UUID, display name, status, selected profile, model, thinking level, delegated task, and visible terminal text; it excludes thinking, tool activity, communication messages, provider metadata, and the full transcript.

Explicit kill also writes available partial text to `result.md`, but its tool result is the only acknowledgement—there is no second completion wake. Result files remain until operating-system temporary-file cleanup; there is no result polling tool.

## Footer

In TUI mode, active children appear in Pi's existing footer as `display-name#1234abcd`. A child waiting for an answer gains `?`. The footer shows up to three handles and a `+N` remainder, then clears when no child is active.

The footer is optional presentation only. Launch, communication, results, and cleanup also work in RPC, JSON, and print modes.

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
