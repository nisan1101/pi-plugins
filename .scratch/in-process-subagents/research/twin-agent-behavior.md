# Twin agent behavior in `@gotgenes/pi-subagents`

## Scope and verdict

Inspected `gotgenes/pi-packages` `main` at commit `ca2d442213b1df68388c5729e3cce0e39d63c986`, package `packages/pi-subagents`.
The package pins `@earendil-works/pi-coding-agent` `0.80.5` for development (`pnpm-lock.yaml:251-268`).

The built-in **twin** is the unoverridden `general-purpose` agent in `promptMode: "append"`; `twin` is a UI label for append mode, not a distinct agent type (`packages/pi-subagents/src/config/default-agents.ts:13-24`; `packages/pi-subagents/src/ui/display.ts:125-128`).
It copies the parent's effective system-prompt text and current model, normally uses the same cwd, and can optionally prepend a textual parent-conversation digest.
It does **not** clone the parent's live resource loader, extension runtime, active tools, runtime-only extension registrations, or current thinking level.

The proposed v1—construct a new `DefaultResourceLoader` and rediscover resources—is therefore substantially the same model as twin today.
It reproduces settings/package-discoverable resources, not the exact runtime-only parent environment.

## Selection and parent snapshot

The embedded `general-purpose` definition has an empty custom prompt, append mode, and no model, thinking, context, background, or tool-list override (`packages/pi-subagents/src/config/default-agents.ts:13-24`).
Before each invocation, custom agent definitions are reloaded; global/project definitions overlay defaults, so `.pi/agents/general-purpose.md` can replace or disable the built-in (`packages/pi-subagents/src/tools/agent-tool.ts:66-79`; `packages/pi-subagents/src/config/agent-types.ts:43-58`; `packages/pi-subagents/docs/configuration.md:23`).
Unknown types fall back to `general-purpose`; known disabled types fail (`packages/pi-subagents/src/tools/spawn-config.ts:74-95`).

After invocation settings are resolved, `AgentTool.execute()` captures a spawn-time `ParentSnapshot` and then dispatches foreground or background work (`packages/pi-subagents/src/tools/agent-tool.ts:67-81,117-130`).
`ParentSnapshot` contains only `cwd`, effective `systemPrompt`, current `model`, `modelRegistry`, and optional prebuilt `parentContext` (`packages/pi-subagents/src/lifecycle/parent-snapshot.ts:14-24,33-45`).
It contains no tools, extensions, loader, settings manager, skills, resource paths, or thinking level.
This is deliberate: queued agents retain state from request time rather than reading mutable parent context when a slot opens (`packages/pi-subagents/docs/architecture/architecture.md:18-19`).

`inherit_context` defaults false.
When true, user/assistant text and compaction summaries are rendered into `# Parent Conversation Context`; tool results and other roles are omitted (`packages/pi-subagents/src/session/context.ts:34-52,60-79`).
That text is prepended to the child's first task prompt, rather than cloning the parent branch/session (`packages/pi-subagents/src/lifecycle/subagent-session.ts:117-123`).

## Prompt behavior

`buildAgentPrompt()` places the parent's effective prompt first, followed by:

1. A fixed `<sub_agent_context>` bridge.
2. `<active_agent name="general-purpose"/>`.
3. A child environment block containing cwd, git branch, and platform.
4. `<agent_instructions>` only when the agent definition has a non-empty custom body.

The built-in twin has no custom body, so the fourth section is absent (`packages/pi-subagents/src/session/prompts.ts:39-88`; `packages/pi-subagents/src/config/default-agents.ts:22-23`).
The parent prefix is kept verbatim for prompt-cache reuse unless the child runs in a different cwd; then only the exact inherited `Current working directory: <parent>` footer is removed so Pi's fresh child footer is authoritative (`packages/pi-subagents/src/session/prompts.ts:99-138`; `packages/pi-subagents/docs/configuration.md:19-21`).

The child loader uses `systemPromptOverride` for this assembled prompt and suppresses fresh context files and append-system files with `noContextFiles: true` and `appendSystemPromptOverride: () => []` (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:185-203`).
Thus parent `AGENTS.md`/`CLAUDE.md` rules already present in `ctx.getSystemPrompt()` survive as text, while the child does not independently append its cwd's context files.

## Resource rediscovery and extensions

At run time, `createSubagentSession()` resolves the effective cwd, detects its environment, assembles configuration, creates child settings, constructs a fresh resource loader, calls `reload()`, creates a persisted child session, and binds rediscovered extensions (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:150-180,181-224,226-253`).
The composition root wires the loader as `new DefaultResourceLoader(opts)` and the session through `createAgentSession()` (`packages/pi-subagents/src/index.ts:99-125`).

The loader receives the child cwd, normal Pi agent directory, a child settings view, prompt overrides, `noPromptTemplates: true`, `noThemes: true`, and `noContextFiles: true` (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:193-203`).
It receives none of the parent's `additionalExtensionPaths`, `additionalSkillPaths`, other additional resource paths, or inline extension factories.
In SDK 0.80.5 those constructor inputs default to empty; `reload()` reloads settings, resolves packages, imports enabled extension paths, and independently resolves skills (`@earendil-works/pi-coding-agent@0.80.5/dist/core/resource-loader.js:116-144,216-285,366-383,442-462`; options at `dist/core/resource-loader.d.ts:61-83`).

By default, settings/package-discoverable extensions are therefore loaded again into the child and initialized by `session.bindExtensions({})`, including a child `session_start` (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:236-245`).
The child is announced immediately before binding so integrations can register its identity first (`packages/pi-subagents/src/lifecycle/child-lifecycle.ts:16-29`).

`excludedExtensionPackages` derives a loader-only settings view that rewrites matched package entries to `extensions: []`; the child's own settings manager remains unchanged (`packages/pi-subagents/src/index.ts:106-113`; `packages/pi-subagents/src/session/package-exclusions.ts:41-74`).
This prevents those modules and factories from loading while leaving other package fields untouched (`packages/pi-subagents/docs/configuration.md:170-190`).

Skills are independently rediscovered because `noSkills` is not set.
Parent-only additional skill paths and dynamically extended parent skill objects are not copied.
Prompt templates and themes are explicitly suppressed for the child (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:197-199`).
Child extensions may add their own resources during the child's `resources_discover` lifecycle, but that reruns discovery in the child rather than copying the parent's discovered state (`@earendil-works/pi-coding-agent@0.80.5/dist/core/agent-session.js:1717-1755`).

## Tools

The twin does not inherit the parent's tool registry or active tool names.
Omitting `toolNames` resolves to the fixed seven built-ins: `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls` (`packages/pi-subagents/src/config/agent-types.ts:94-99,133`).
These are passed to SDK `createAgentSession()` as a complete allowlist, with `subagent`, `get_subagent_result`, and `steer_subagent` supplied as a durable recursion denylist (`packages/pi-subagents/src/lifecycle/create-subagent-session.ts:29-36,213-223`).

SDK 0.80.5 applies `tools` before constructing built-in and extension tool registries and reapplies the allow/deny sets on every refresh (`@earendil-works/pi-coding-agent@0.80.5/dist/core/sdk.d.ts:38-46`; `dist/core/agent-session.js:1911-1977`).
A child-loaded extension can successfully call `registerTool`, but its tool is absent unless the agent definition explicitly names it (`packages/pi-subagents/docs/configuration.md:92-109,124-130`; `packages/pi-subagents/docs/architecture/architecture.md:454-465`).
The built-in twin consequently gets seven built-ins and no parent extension tools.

## Model and thinking

With no configured model or invocation override, `resolveInvocationModel()` returns the snapshotted current parent model (`packages/pi-subagents/src/config/invocation-config.ts:23-24`; `packages/pi-subagents/src/session/model-resolver.ts:37-48`).
Explicit model strings resolve against available configured models, exact then fuzzy; an invalid invocation model errors, while an invalid agent-file model falls back to the parent (`packages/pi-subagents/src/session/model-resolver.ts:32-48,56-77`).
The result is passed into child session creation (`packages/pi-subagents/src/session/session-config.ts:164-170`; `packages/pi-subagents/src/lifecycle/create-subagent-session.ts:213-224`).

Thinking is different: parent runtime thinking is not in `ParentSnapshot`.
Agent-file thinking wins over invocation thinking; otherwise `undefined` reaches the SDK (`packages/pi-subagents/src/config/invocation-config.ts:23-28`; `packages/pi-subagents/src/session/session-config.ts:169-170`).
SDK 0.80.5 then uses the child settings default, falls back to its own default, and clamps to model capability (`@earendil-works/pi-coding-agent@0.80.5/dist/core/sdk.js:113-129`).
Documentation saying thinking is inherited therefore means "no subagent override," not an exact copy of the parent's current thinking level.

## Workspaces, persistence, and lifecycle

The core has no built-in git-worktree implementation.
A registered `WorkspaceProvider` may prepare a child cwd at run start; otherwise the snapshot cwd is used (`packages/pi-subagents/src/lifecycle/subagent.ts:244-280`; `packages/pi-subagents/docs/architecture/architecture.md:440-448`).
Resource rediscovery consequently runs against the prepared workspace cwd.
The workspace is disposed when the initial run finishes or errors, while the child session may remain retained for resume (`packages/pi-subagents/src/lifecycle/subagent.ts:498-516,545-553`).
Resume re-prompts that existing session and does not prepare a new workspace (`packages/pi-subagents/src/lifecycle/subagent.ts:361-388`).

Child transcripts use Pi's JSONL `SessionManager` under `<parent-dir>/<parent-basename>/tasks/`, or a cwd-keyed temporary directory when the parent is not persisted (`packages/pi-subagents/src/session/session-dir.ts:12-37`; `packages/pi-subagents/src/lifecycle/create-subagent-session.ts:205-211`).
Foreground runs bypass the queue; background runs use FIFO concurrency admission (`packages/pi-subagents/src/lifecycle/subagent-manager.ts:161-222`).
The turn loop prepends optional parent context, forwards aborts, applies graceful turn limits, emits completion, and collects final assistant text (`packages/pi-subagents/src/lifecycle/subagent-session.ts:86-136`).

Completion does not immediately dispose the child session.
The live session is released after the consumed or unconsumed retention window, while its result and transcript pointer remain on the record (`packages/pi-subagents/src/lifecycle/subagent-manager.ts:101-112,276-299`; `packages/pi-subagents/src/lifecycle/subagent.ts:131-149,535-542`).
True disposal emits bounded child `session_shutdown`, disposes the SDK session, then emits the child `disposed` event (`packages/pi-subagents/src/lifecycle/subagent-session.ts:197-215`; `packages/pi-subagents/src/lifecycle/child-shutdown.ts:25,53-63,101-103`).

## Comparison with proposed v1

| Concern | Twin at inspected commit | Proposed v1 rediscovery implication |
| --- | --- | --- |
| System prompt | Snapshotted parent effective prompt plus child bridge/environment | Equivalent if v1 snapshots the effective prompt |
| Conversation | Optional formatted text, not a branch clone | Equivalent if v1 treats context as optional text |
| Model | Current parent model object | Equivalent |
| Thinking | Child default unless explicitly set | Not an exact parent clone |
| Installed/package extensions | Fresh loader rediscovers and rebinds | Equivalent |
| `pi -e`, additional paths, inline/runtime factories | Not propagated | Rediscovery alone cannot clone them |
| Parent tools | Ignored; fixed agent allowlist controls child | Rediscovery alone cannot clone them |
| Skills | Fresh child rediscovery | Equivalent only for settings-discoverable skills |
| Runtime-discovered resources | Reappear only if child extensions discover them again | Not an exact clone |

The repository explicitly records that parent `additionalExtensionPaths` are private and CLI `pi -e` paths are not exposed through the extension API; ephemeral extensions therefore do not propagate (`packages/pi-subagents/docs/decisions/0001-deferred-patches.md:23,31-49,72-73`, status `superseded`).
The current architecture still flags propagation of parent `pi -e` extensions as outside current behavior (`packages/pi-subagents/docs/architecture/architecture.md:52`).

**Conclusion:** v1's fresh `DefaultResourceLoader` is a faithful implementation of twin's existing *rediscovery* semantics.
It should not claim exact runtime cloning: the current snapshot and loader construction have no channel for parent-only tools, extension factories, additional resource paths, or current thinking state.
