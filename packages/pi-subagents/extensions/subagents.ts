import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSupportedThinkingLevels, StringEnum } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CONFIG_FILE = "subagents.json";
const DEFAULT_MAX_CONCURRENT = 4;
const ORCHESTRATION_TOOLS = ["subagent", "message_subagent", "kill_subagent"];
const PROFILE_NAMES = ["inherit", "low", "medium", "high", "xhigh"] as const;

type Model = NonNullable<CreateAgentSessionOptions["model"]>;
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
}

interface ChildSession {
  prompt(text: string): Promise<void>;
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
  excludeTools: string[];
}

type CreateChildSession = (options: ChildSessionOptions) => Promise<ChildSession>;

interface ChildRecord {
  id: string;
  displayName: string;
  prompt: string;
  profile: ModelProfile;
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
    tools: options.tools,
    excludeTools: options.excludeTools,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(options.cwd),
  });
  await session.bindExtensions({ mode: "print" });

  return {
    prompt: (text) => session.prompt(text),
    get messages() {
      return session.messages;
    },
    getActiveToolNames: () => session.getActiveToolNames(),
    shutdown: () => session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
    dispose: () => session.dispose(),
  };
}

function childRolePrompt(parentPrompt: string): string {
  return `${parentPrompt}\n\n# Fresh subagent role\n\nYou are a fresh subagent, not the parent agent. You have no parent conversation history. The parent remains authoritative and has delegated one narrow task to you.\n\nYou share the parent's working directory with concurrent work. Inspect current file contents before editing. Modify files only when the delegated task explicitly asks for implementation. Never revert unrelated changes. If current work conflicts with the delegated task, stop and report the conflict instead of forcing a resolution.`;
}

function delegatedTask(record: ChildRecord): string {
  return `--- delegated_task ---\nsubagent_id: ${record.id}\ndisplay_name: ${record.displayName}\ncontext: fresh; no parent conversation inherited\ntask:\n${record.prompt}\n--- end delegated_task ---`;
}

const NO_FINAL_TEXT = "_No final textual result._";

function terminalText(messages: readonly ChildMessage[]): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant || !Array.isArray(assistant.content)) return NO_FINAL_TEXT;
  const text = assistant.content
    .filter((block): block is { type: "text"; text: string } =>
      isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
  return text || NO_FINAL_TEXT;
}

function resultMarkdown(record: ChildRecord, options: ChildSessionOptions, result: string): string {
  return `# Subagent Result

- ID: ${record.id}
- Display name: ${record.displayName}
- Status: completed
- Model profile: ${record.profile}
- Model: ${options.model.provider}/${options.model.id}
- Thinking level: ${options.thinkingLevel}

## Delegated task

${record.prompt}

## Result

${result}
`;
}

async function writeResult(record: ChildRecord, options: ChildSessionOptions, result: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
  const pendingPath = join(directory, ".result.md.pending");
  const resultPath = join(directory, "result.md");
  await writeFile(pendingPath, resultMarkdown(record, options, result), {
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

function renderStatus(records: Iterable<ChildRecord>): string | undefined {
  const handles = [...records].map(({ displayName, id }) => `${displayName}#${id.slice(0, 8)}`);
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

  const rawProfiles = raw.profiles ?? {};
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
): { model: Model; thinkingLevel: ThinkingLevel } {
  if (profile === "inherit") {
    if (!ctx.model) throw new Error("Cannot launch a subagent without an active parent model.");
    return { model: ctx.model, thinkingLevel: inheritedThinkingLevel };
  }

  const configured = config.profiles[profile];
  if (!configured) throw new Error(`Model profile ${profile} is not configured.`);
  const model = ctx.modelRegistry.find(configured.provider, configured.model);
  if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`Model profile ${profile} is unavailable: ${configured.provider}/${configured.model}.`);
  }
  if (!getSupportedThinkingLevels(model).includes(configured.thinkingLevel)) {
    throw new Error(
      `Model profile ${profile} requests unsupported thinking level ${configured.thinkingLevel}.`,
    );
  }
  return { model, thinkingLevel: configured.thinkingLevel };
}

export function createSubagentsExtension({
  createChildSession = createPiChildSession,
}: SubagentsExtensionOptions = {}) {
  return function subagents(pi: ExtensionAPI) {
    const children = new Map<string, ChildRecord>();

    const updateStatus = (ctx: ExtensionContext) => {
      if (ctx.mode === "tui") ctx.ui.setStatus("subagents", renderStatus(children.values()));
    };

    const runChild = async (record: ChildRecord, ctx: ExtensionContext, options: ChildSessionOptions) => {
      const child = await createChildSession(options);
      let shutdownAttempted = false;
      let disposeAttempted = false;
      try {
        if (children.get(record.id) !== record) return;
        const missingTools = options.tools.filter((name) => !child.getActiveToolNames().includes(name));
        if (missingTools.length > 0) {
          throw new Error(`Child could not load active tools: ${missingTools.join(", ")}`);
        }
        await child.prompt(delegatedTask(record));
        if (children.get(record.id) !== record) return;

        const result = terminalText(child.messages);
        const resultPath = await writeResult(record, options, result);
        shutdownAttempted = true;
        await child.shutdown();
        disposeAttempted = true;
        child.dispose();
        children.delete(record.id);
        updateStatus(ctx);

        pi.sendMessage(
          {
            customType: "subagent-completed",
            content:
              `Subagent ${record.displayName} (${record.id}) completed.\n\n` +
              `${preview(result)}\n\nResult: ${resultPath}`,
            display: true,
            details: { id: record.id, display_name: record.displayName, result_path: resultPath },
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      } catch (error) {
        if (!shutdownAttempted) {
          try {
            await child.shutdown();
          } catch {}
        }
        if (!disposeAttempted) {
          try {
            child.dispose();
          } catch {}
        }
        throw error;
      }
    };

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
        if (!display_name.trim()) throw new Error("display_name must not be empty.");
        if (!prompt.trim()) throw new Error("prompt must not be empty.");

        const agentDir = getAgentDir();
        const config = await readConfig(agentDir, ctx);
        if (children.size >= config.maxConcurrent) {
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
          profile: model_profile,
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
          excludeTools: ORCHESTRATION_TOOLS,
        }).catch((error) => {
          children.delete(record.id);
          updateStatus(ctx);
          pi.sendMessage(
            {
              customType: "subagent-failed",
              content: `Subagent ${record.displayName} (${record.id}) failed to start: ${errorMessage(error)}`,
              display: true,
              details: { id: record.id, display_name: record.displayName },
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
        });

        return {
          content: [{ type: "text" as const, text: `Started ${record.displayName} (${record.id}).` }],
          details: { id: record.id, display_name: record.displayName },
          terminate: true,
        };
      },
    });
  };
}

export default createSubagentsExtension();
