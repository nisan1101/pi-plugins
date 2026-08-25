import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentToolResult,
  type CreateAgentSessionOptions,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CONFIG_FILE = "subagents.json";
const DEFAULT_MAX_CONCURRENT = 4;
const ORCHESTRATION_TOOLS = ["subagent", "message_subagent", "kill_subagent"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_NAMES = ["inherit", "low", "medium", "high", "xhigh"] as const;

type Model = NonNullable<CreateAgentSessionOptions["model"]>;
type ChildTool = NonNullable<CreateAgentSessionOptions["customTools"]>[number];
type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;
type ModelProfile = (typeof PROFILE_NAMES)[number];
type NamedModelProfile = Exclude<ModelProfile, "inherit">;

const NAMED_PROFILE_NAMES: readonly NamedModelProfile[] = ["low", "medium", "high", "xhigh"];
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface ProfileConfig {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
}

interface SubagentsConfig {
  maxConcurrent: number;
  profiles: Partial<Record<NamedModelProfile, ProfileConfig>>;
}

interface ChildMessage {
  role: string;
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
}

interface ChildSessionEvent {
  type: string;
  message?: ChildMessage;
}

interface ChildSession {
  steer(text: string): Promise<void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: ChildSessionEvent) => void): () => void;
  readonly messages: readonly ChildMessage[];
  getActiveToolNames(): string[];
  shutdown(): Promise<void>;
  dispose(): void;
}

interface ChildSessionOptions {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  model: Model;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
  tools: string[];
  messageParentTool: ChildTool;
  excludeTools: string[];
}

type CreateChildSession = (options: ChildSessionOptions) => Promise<ChildSession>;

type ChildState =
  | { phase: "starting"; guidance: string[] }
  | { phase: "running"; child: ChildSession }
  | { phase: "waiting"; child: ChildSession; resolve(answer: string): void; reject(error: Error): void }
  | { phase: "finalizing"; child?: ChildSession };

interface ChildRecord {
  id: string;
  displayName: string;
  prompt: string;
  profile: ModelProfile;
  model: Model;
  thinkingLevel: ThinkingLevel;
  state: ChildState;
  finalization?: Promise<string>;
  lastAssistant?: ChildMessage;
  unsubscribe?: () => void;
}

interface MessageParentDetails {
  id: string;
  display_name: string;
  answer?: string;
}

interface SubagentsExtensionOptions {
  createChildSession?: CreateChildSession;
}

async function createPiChildSession(options: ChildSessionOptions): Promise<ChildSession> {
  const settingsManager = SettingsManager.create(options.cwd, options.agentDir, {
    projectTrusted: options.projectTrusted,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: options.systemPrompt,
    appendSystemPrompt: [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: [...options.tools, "message_parent"],
    customTools: [options.messageParentTool],
    excludeTools: options.excludeTools,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.cwd),
  });
  await session.bindExtensions({ mode: "print" });

  return {
    steer: (text) => session.steer(text),
    prompt: (text) => session.prompt(text),
    abort: () => session.abort(),
    subscribe: (listener) => session.subscribe((event) => listener(event as ChildSessionEvent)),
    get messages() {
      return session.messages;
    },
    getActiveToolNames: () => session.getActiveToolNames(),
    shutdown: () => session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
    dispose: () => session.dispose(),
  };
}

function childRolePrompt(parentPrompt: string): string {
  return `${parentPrompt}\n\n# Fresh subagent role\n\nYou are a fresh subagent, not the parent agent. You have no parent conversation history. The parent remains authoritative and has delegated one narrow task to you.\n\nYou share the parent's working directory with concurrent work. Inspect current file contents before editing. Modify files only when the delegated task explicitly asks for implementation. Never revert unrelated changes. If current work conflicts with the delegated task, stop and report the conflict instead of forcing a resolution.\n\nUse message_parent with kind progress only for meaningful milestones, not routine tool activity. Use kind question when you must block for parent guidance.`;
}

function delegatedTask(record: ChildRecord): string {
  return `--- delegated_task ---\nsubagent_id: ${record.id}\ndisplay_name: ${record.displayName}\ncontext: fresh; no parent conversation inherited\ntask:\n${record.prompt}\n--- end delegated_task ---`;
}

const NO_FINAL_TEXT = "_No final textual result._";

function terminalAssistant(messages: readonly ChildMessage[]): ChildMessage | undefined {
  return [...messages].reverse().find((message) => message.role === "assistant");
}

function assistantText(assistant: ChildMessage | undefined): string {
  if (!assistant || !Array.isArray(assistant.content)) return NO_FINAL_TEXT;
  const text = assistant.content
    .filter((block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
  return text || NO_FINAL_TEXT;
}

type TerminalStatus = "completed" | "failed" | "killed";

interface TerminalOutcome {
  status: TerminalStatus;
  error?: string;
  abort?: boolean;
}

function naturalOutcome(assistant: ChildMessage | undefined): TerminalOutcome {
  const failed = assistant?.stopReason === "error" || assistant?.stopReason === "aborted";
  return failed
    ? { status: "failed", error: assistant?.errorMessage ?? "Subagent failed." }
    : { status: "completed" };
}

function resultMarkdown(
  record: ChildRecord,
  status: TerminalStatus,
  result: string,
  error?: string,
): string {
  const resultSection =
    status === "completed"
      ? `## Result\n\n${result}`
      : status === "failed"
        ? `## Error\n\n${error ?? "Unknown error."}\n\n## Partial result\n\n${result}`
        : `## Partial result\n\n${result}`;
  return `# Subagent Result

- ID: ${record.id}
- Display name: ${record.displayName}
- Status: ${status}
- Model profile: ${record.profile}
- Model: ${record.model.provider}/${record.model.id}
- Thinking level: ${record.thinkingLevel}

## Delegated task

${record.prompt}

${resultSection}
`;
}

async function writeResult(
  record: ChildRecord,
  status: TerminalStatus,
  result: string,
  error?: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
  const pendingPath = join(directory, ".result.md.pending");
  const resultPath = join(directory, "result.md");
  await writeFile(pendingPath, resultMarkdown(record, status, result, error), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  await rename(pendingPath, resultPath);
  return resultPath;
}

function preview(result: string): string {
  const characters = [...result];
  return characters.length > 500 ? `${characters.slice(0, 500).join("")}…` : result;
}

function isActive(record: ChildRecord): boolean {
  return record.state.phase !== "finalizing";
}

function renderStatus(
  records: Iterable<ChildRecord>,
  theme?: ExtensionContext["ui"]["theme"],
): string | undefined {
  const handles = [...records].filter(isActive).map(({ displayName, id, state }) => {
    const handle = `${displayName}#${id.slice(0, 8)}`;
    if (!theme) return handle;
    const glyph =
      state.phase === "starting"
        ? theme.fg("dim", "◌")
        : state.phase === "running"
          ? theme.fg("success", "*")
          : theme.fg("warning", "?");
    return `${glyph} ${handle}`;
  });
  if (handles.length === 0) return undefined;
  const visible = handles.slice(0, 3);
  if (handles.length > 3) visible.push(`+${handles.length - 3}`);
  return visible.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readConfig(agentDir: string, ctx: ExtensionContext): Promise<SubagentsConfig> {
  let source: string;
  try {
    source = await readFile(join(agentDir, CONFIG_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { maxConcurrent: DEFAULT_MAX_CONCURRENT, profiles: {} };
    }
    throw new Error(`Cannot read ${CONFIG_FILE}: ${errorMessage(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${CONFIG_FILE}: ${errorMessage(error)}`);
  }
  if (!isRecord(raw)) throw new Error(`${CONFIG_FILE} must contain a JSON object.`);

  let maxConcurrent = DEFAULT_MAX_CONCURRENT;
  if (raw.maxConcurrent !== undefined) {
    if (Number.isInteger(raw.maxConcurrent) && (raw.maxConcurrent as number) > 0) {
      maxConcurrent = raw.maxConcurrent as number;
    } else {
      ctx.ui.notify(`Invalid maxConcurrent in ${CONFIG_FILE}; using ${DEFAULT_MAX_CONCURRENT}.`, "warning");
    }
  }

  const rawProfiles = raw.profiles === undefined ? {} : raw.profiles;
  if (!isRecord(rawProfiles)) throw new Error(`${CONFIG_FILE} profiles must be an object.`);
  const profiles: SubagentsConfig["profiles"] = {};
  for (const [name, value] of Object.entries(rawProfiles)) {
    if (!NAMED_PROFILE_NAMES.includes(name as NamedModelProfile)) {
      throw new Error(`Unsupported model profile ${name} in ${CONFIG_FILE}.`);
    }
    if (
      !isRecord(value) ||
      typeof value.provider !== "string" ||
      !value.provider.trim() ||
      typeof value.model !== "string" ||
      !value.model.trim() ||
      typeof value.thinkingLevel !== "string" ||
      !THINKING_LEVELS.includes(value.thinkingLevel as ThinkingLevel)
    ) {
      throw new Error(`Invalid model profile ${name} in ${CONFIG_FILE}.`);
    }
    profiles[name as NamedModelProfile] = {
      provider: value.provider,
      model: value.model,
      thinkingLevel: value.thinkingLevel as ThinkingLevel,
    };
  }

  return { maxConcurrent, profiles };
}

function resolveProfile(
  profile: ModelProfile,
  config: SubagentsConfig,
  ctx: ExtensionContext,
  inheritedThinkingLevel: ThinkingLevel,
): { profile: ModelProfile; model: Model; thinkingLevel: ThinkingLevel } {
  if (profile === "inherit") {
    if (!ctx.model) throw new Error("Cannot launch a subagent without an active parent model.");
    return { profile, model: ctx.model, thinkingLevel: inheritedThinkingLevel };
  }

  const configured = config.profiles[profile];
  if (!configured) return resolveProfile("inherit", config, ctx, inheritedThinkingLevel);
  const model = ctx.modelRegistry.find(configured.provider, configured.model);
  if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`Model profile ${profile} is unavailable: ${configured.provider}/${configured.model}.`);
  }
  if (!getSupportedThinkingLevels(model).includes(configured.thinkingLevel)) {
    throw new Error(
      `Model profile ${profile} requests unsupported thinking level ${configured.thinkingLevel}.`,
    );
  }
  return { profile, model, thinkingLevel: configured.thinkingLevel };
}

export function createSubagentsExtension({
  createChildSession = createPiChildSession,
}: SubagentsExtensionOptions = {}) {
  return function subagents(pi: ExtensionAPI) {
    const children = new Map<string, ChildRecord>();
    let controlsOpen = true;
    let deliveryOpen = true;
    let deliveryGeneration = 0;
    let treeStoppedHandles: string[] = [];
    // Pi bypasses its follow-up queue when triggerTurn is false, so preserve order until the parent settles.
    const pendingParentMessages: Array<{ generation: number; wakesParent: boolean; send(): void }> = [];
    const flushParentMessages = () => {
      if (!deliveryOpen) {
        pendingParentMessages.length = 0;
        return;
      }
      while (pendingParentMessages.length > 0) {
        const next = pendingParentMessages.shift()!;
        if (next.generation !== deliveryGeneration) continue;
        next.send();
        if (next.wakesParent) return;
      }
    };
    const deliverParentMessage = (
      ctx: ExtensionContext,
      wakesParent: boolean,
      send: () => void,
      generation = deliveryGeneration,
) => {
      if (!deliveryOpen || generation !== deliveryGeneration) return;
      const guardedSend = () => {
        if (deliveryOpen && generation === deliveryGeneration) send();
      };
      if (ctx.isIdle() && pendingParentMessages.length === 0) guardedSend();
      else {
        pendingParentMessages.push({ generation, wakesParent, send: guardedSend });
        if (ctx.isIdle()) flushParentMessages();
      }
    };
    pi.on("agent_settled", flushParentMessages);

    const updateStatus = (ctx: ExtensionContext) => {
      if (ctx.mode === "tui") ctx.ui.setStatus("subagents", renderStatus(children.values(), ctx.ui.theme));
    };

    const closeDelivery = () => {
      deliveryOpen = false;
      deliveryGeneration += 1;
      pendingParentMessages.length = 0;
    };

    const ensureControlsOpen = () => {
      if (!controlsOpen) throw new Error("Subagent controls are unavailable during parent session transition.");
    };

    const createMessageParentTool = (record: ChildRecord, ctx: ExtensionContext) =>
      defineTool({
        name: "message_parent",
        label: "Message Parent",
        description: "Report meaningful progress or ask the parent a blocking question.",
        parameters: Type.Object({
          kind: StringEnum(["progress", "question"] as const),
          message: Type.String({ minLength: 1 }),
        }),
        async execute(_toolCallId, { kind, message }): Promise<AgentToolResult<MessageParentDetails>> {
          if (!message.trim()) throw new Error("message must not be empty.");
          const state = record.state;
          if (children.get(record.id) !== record || state.phase === "starting" || state.phase === "finalizing") {
            throw new Error("The parent session is no longer available.");
          }
          const details: MessageParentDetails = { id: record.id, display_name: record.displayName };
          if (kind === "question") {
            if (state.phase === "waiting") throw new Error("Subagent is already waiting for a parent answer.");
            const answer = new Promise<string>((resolve, reject) => {
              record.state = { phase: "waiting", child: state.child, resolve, reject };
            });
            updateStatus(ctx);
            deliverParentMessage(ctx, true, () =>
              pi.sendMessage(
                {
                  customType: "subagent-question",
                  content: `Subagent ${record.displayName} (${record.id}) asks:\n\n${message}`,
                  display: true,
                  details,
                },
                { deliverAs: "followUp", triggerTurn: true },
              ),
            );
            const response = await answer;
            return {
              content: [{ type: "text" as const, text: `Parent answered: ${response}` }],
              details: { ...details, answer: response },
            };
          }
          const send = () =>
            pi.sendMessage(
              {
                customType: "subagent-progress",
                content: `Subagent ${record.displayName} (${record.id}) progress:\n\n${message}`,
                display: true,
                details,
              },
              { deliverAs: "followUp", triggerTurn: false },
            );
          deliverParentMessage(ctx, false, send);
          return {
            content: [{ type: "text" as const, text: "Progress reported to parent." }],
            details,
          };
        },
      });

    const disposeChild = async (child: ChildSession, { abort = false }: { abort?: boolean } = {}) => {
      if (abort) {
        try {
          await child.abort();
        } catch {}
      }
      try {
        await child.shutdown();
      } catch {}
      try {
        child.dispose();
      } catch {}
    };

    const claimFinalization = (
      record: ChildRecord,
      ctx: ExtensionContext,
      child: ChildSession | undefined,
      { status, error, abort = false }: TerminalOutcome,
): Promise<string> | undefined => {
      if (children.get(record.id) !== record || !isActive(record)) return undefined;

      const previousState = record.state;
      record.state = { phase: "finalizing", child };
      if (status === "killed" && previousState.phase === "waiting") {
        previousState.reject(new Error("Subagent was killed."));
      }
      updateStatus(ctx);
      const generation = deliveryGeneration;

      const finalization = (async () => {
        if (child && abort) {
          try {
            await child.abort();
          } catch {}
        }
        const assistant = record.lastAssistant ?? terminalAssistant(child?.messages ?? []);
        const result = assistantText(assistant);
        let resultPath: string;
        try {
          resultPath = await writeResult(record, status, result, error);
        } finally {
          record.unsubscribe?.();
          record.unsubscribe = undefined;
          if (child) await disposeChild(child);
          if (children.get(record.id) === record) children.delete(record.id);
          updateStatus(ctx);
        }

        if (status !== "killed") {
          deliverParentMessage(
            ctx,
            true,
            () =>
              pi.sendMessage(
                {
                  customType: status === "completed" ? "subagent-completed" : "subagent-failed",
                  content:
                    `Subagent ${record.displayName} (${record.id}) ${status}.\n\n` +
                    (error ? `${error}\n\n` : "") +
                    `${preview(result)}\n\nResult: ${resultPath}`,
                  display: true,
                  details: { id: record.id, display_name: record.displayName, result_path: resultPath },
                },
                { deliverAs: "followUp", triggerTurn: true },
              ),
            generation,
          );
        }
        return resultPath;
      })();
      record.finalization = finalization;
      return finalization;
    };

    const claimNaturalFinalization = (record: ChildRecord, ctx: ExtensionContext, child: ChildSession) =>
      claimFinalization(
        record,
        ctx,
        child,
        naturalOutcome(record.lastAssistant ?? terminalAssistant(child.messages)),
      );

    const runChild = async (record: ChildRecord, ctx: ExtensionContext, options: ChildSessionOptions) => {
      let child: ChildSession | undefined;
      let promptStarted = false;
      try {
        child = await createChildSession(options);
        if (children.get(record.id) !== record || !isActive(record)) {
          await disposeChild(child, { abort: true });
          return;
        }

        record.unsubscribe = child.subscribe((event) => {
          if (children.get(record.id) !== record) return;
          if (event.type === "message_end" && event.message?.role === "assistant") {
            record.lastAssistant = event.message;
          }
          if (event.type === "agent_settled" && isActive(record)) {
            void claimNaturalFinalization(record, ctx, child!)?.catch(() => {});
          }
        });

        const expectedTools = [...options.tools, "message_parent"];
        const missingTools = expectedTools.filter((name) => !child!.getActiveToolNames().includes(name));
        if (missingTools.length > 0) {
          throw new Error(`Child could not load active tools: ${missingTools.join(", ")}`);
        }

        const startup = record.state;
        if (startup.phase !== "starting") return;
        promptStarted = true;
        const prompt = child.prompt(delegatedTask(record));
        const startupSteering = startup.guidance.map((message) => child!.steer(message));
        record.state = { phase: "running", child };
        updateStatus(ctx);
        await Promise.all(startupSteering);
        await prompt;
        if (children.get(record.id) !== record || !isActive(record)) return;

        await claimNaturalFinalization(record, ctx, child);
      } catch (error) {
        if (children.get(record.id) === record && isActive(record)) {
          await claimFinalization(record, ctx, child, {
            status: "failed",
            error: errorMessage(error),
            abort: promptStarted,
          });
        }
      }
    };

    const cleanupOwnedChildren = async (ctx: ExtensionContext) => {
      controlsOpen = false;
      closeDelivery();

      const childCleanups: ChildSession[] = [];
      const finalizations: Promise<string>[] = [];
      for (const record of children.values()) {
        const state = record.state;
        if (state.phase === "finalizing") {
          if (record.finalization) finalizations.push(record.finalization);
          continue;
        }
        if (state.phase === "waiting") {
          state.reject(new Error("The parent session is no longer available."));
        }
        record.unsubscribe?.();
        record.unsubscribe = undefined;
        const child = state.phase === "starting" ? undefined : state.child;
        record.state = { phase: "finalizing", child };
        if (child) childCleanups.push(child);
      }
      children.clear();
      updateStatus(ctx);

      await Promise.allSettled([
        ...childCleanups.map((child) => disposeChild(child, { abort: true })),
        ...finalizations,
      ]);
    };

    pi.on("session_shutdown", (_event, ctx) => cleanupOwnedChildren(ctx));

    // ponytail: later tree cancellation can leave children stopped; keep this safety-first boundary until Pi adds a confirmed pre-commit hook.
    pi.on("session_before_tree", async (_event, ctx) => {
      treeStoppedHandles = [...children.values()].map(
        ({ displayName, id }) => `${displayName}#${id.slice(0, 8)}`,
      );
      await cleanupOwnedChildren(ctx);
    });

    pi.on("session_tree", (_event, _ctx) => {
      if (treeStoppedHandles.length > 0) {
        const stopped = treeStoppedHandles;
        pi.sendMessage(
          {
            customType: "subagents-tree-cancelled",
            content:
              `Tree navigation stopped subagents: ${stopped.join(", ")}.\n\n` +
              "Existing workspace changes were not reverted.",
            display: true,
            details: { stopped },
          },
          { deliverAs: "followUp", triggerTurn: false },
        );
      }
      treeStoppedHandles = [];
      controlsOpen = true;
      deliveryOpen = true;
    });

    pi.registerTool({
      name: "message_subagent",
      label: "Message Subagent",
      description: "Send guidance to one active subagent using its full UUID.",
      parameters: Type.Object({
        id: Type.String(),
        message: Type.String({ minLength: 1 }),
      }),
      async execute(_toolCallId, { id, message }, _signal, _onUpdate, ctx) {
        ensureControlsOpen();
        if (!UUID_PATTERN.test(id)) throw new Error("id must be a full subagent UUID.");
        if (!message.trim()) throw new Error("message must not be empty.");
        const record = children.get(id);
        if (!record || record.state.phase === "finalizing") {
          throw new Error(`No active subagent with UUID ${id}.`);
        }
        const state = record.state;
        if (state.phase === "waiting") {
          record.state = { phase: "running", child: state.child };
          updateStatus(ctx);
          state.resolve(message);
          return {
            content: [{ type: "text" as const, text: `Answered ${record.displayName} (${id}).` }],
            details: { id, display_name: record.displayName },
          };
        }
        if (state.phase === "starting") {
          state.guidance.push(message);
          return {
            content: [{ type: "text" as const, text: `Buffered guidance for ${record.displayName} (${id}).` }],
            details: { id, display_name: record.displayName },
          };
        }
        await state.child.steer(message);
        return {
          content: [{ type: "text" as const, text: `Steered ${record.displayName} (${id}).` }],
          details: { id, display_name: record.displayName },
        };
      },
    });

    pi.registerTool({
      name: "kill_subagent",
      label: "Kill Subagent",
      description:
        "Cooperatively stop one active subagent by full UUID. This cannot force-stop synchronous code or extensions that ignore cancellation.",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_toolCallId, { id }, _signal, _onUpdate, ctx) {
        ensureControlsOpen();
        if (!UUID_PATTERN.test(id)) throw new Error("id must be a full subagent UUID.");
        const record = children.get(id);
        if (!record || record.state.phase === "finalizing") {
          throw new Error(`No active subagent with UUID ${id}.`);
        }

        const state = record.state;
        const child = state.phase === "starting" ? undefined : state.child;
        const finalization = claimFinalization(record, ctx, child, { status: "killed", abort: true });
        if (!finalization) throw new Error(`No active subagent with UUID ${id}.`);
        const resultPath = await finalization;

        return {
          content: [
            {
              type: "text" as const,
              text: `Cooperatively killed ${record.displayName} (${id}). Result: ${resultPath}`,
            },
          ],
          details: { id, display_name: record.displayName, result_path: resultPath },
        };
      },
    });

    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description:
        "Launch one fresh in-process background subagent. Call this tool by itself after other tool calls finish; every successful launch terminates the current parent run. Do not modify the delegated scope while its returned UUID remains active.",
      parameters: Type.Object({
        display_name: Type.String({ minLength: 1 }),
        prompt: Type.String({ minLength: 1 }),
        model_profile: Type.Optional(StringEnum(PROFILE_NAMES)),
      }),
      async execute(_toolCallId, { display_name, prompt, model_profile = "inherit" }, _signal, _onUpdate, ctx) {
        ensureControlsOpen();
        if (!display_name.trim()) throw new Error("display_name must not be empty.");
        if (!prompt.trim()) throw new Error("prompt must not be empty.");

        const agentDir = getAgentDir();
        const config = await readConfig(agentDir, ctx);
        if ([...children.values()].filter(isActive).length >= config.maxConcurrent) {
          throw new Error(
            `Subagent limit ${config.maxConcurrent} reached: ${renderStatus(children.values()) ?? "no active handles"}.`,
          );
        }

        const resolvedProfile = resolveProfile(
          model_profile,
          config,
          ctx,
          ctx.thinkingLevel ?? pi.getThinkingLevel(),
        );

        const record: ChildRecord = {
          id: randomUUID(),
          displayName: display_name,
          prompt,
          profile: resolvedProfile.profile,
          model: resolvedProfile.model,
          thinkingLevel: resolvedProfile.thinkingLevel,
          state: { phase: "starting", guidance: [] },
        };
        children.set(record.id, record);
        updateStatus(ctx);

        const tools = pi.getActiveTools().filter((name) => !ORCHESTRATION_TOOLS.includes(name));
        void runChild(record, ctx, {
          cwd: ctx.cwd,
          agentDir,
          projectTrusted: ctx.isProjectTrusted(),
          model: resolvedProfile.model,
          thinkingLevel: resolvedProfile.thinkingLevel,
          systemPrompt: childRolePrompt(ctx.getSystemPrompt()),
          tools,
          messageParentTool: createMessageParentTool(record, ctx),
          excludeTools: ORCHESTRATION_TOOLS,
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Started ${record.displayName} (${record.id}).` +
                (model_profile === resolvedProfile.profile
                  ? ""
                  : ` Model profile ${model_profile} is not configured; using inherit.`),
            },
          ],
          details: { id: record.id, display_name: record.displayName },
          terminate: true,
        };
      },
    });
  };
}

export default createSubagentsExtension();
