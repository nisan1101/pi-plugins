import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fauxProvider } from "@earendil-works/pi-ai";

import { createSubagentsExtension } from "../extensions/subagents.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const NAMED_PROFILES = ["low", "medium", "high", "xhigh"];

function fakeChild(overrides = {}) {
  return {
    messages: [],
    getActiveToolNames: () => ["read", "write", "message_parent"],
    async steer() {},
    async prompt() {},
    subscribe() {
      return () => {};
    },
    async abort() {},
    async shutdown() {},
    dispose() {},
    ...overrides,
  };
}

function callTool(tool, params, context = {}) {
  return tool.execute("call", params, undefined, undefined, context);
}

function assertCallsInAnyOrder(actual, expected) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

async function loadExtension(t, createChildSession, overrides = {}) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-subagents-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  });

  const tools = new Map();
  const statuses = [];
  const warnings = [];
  const sent = [];
  const handlers = new Map();
  let parentIdle = overrides.parentIdle ?? true;
  createSubagentsExtension({ createChildSession })({
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    getActiveTools() {
      return overrides.activeTools ?? ["read", "write", "subagent"];
    },
    getThinkingLevel() {
      return overrides.thinkingLevel ?? "high";
    },
    sendMessage(message, options) {
      sent.push({ message, options });
    },
  });

  const subagent = tools.get("subagent");
  assert.ok(subagent);
  const model = "model" in overrides ? overrides.model : { provider: "test", id: "parent-model" };
  const context = {
    cwd: overrides.cwd ?? "/workspace",
    mode: overrides.mode ?? "tui",
    model,
    thinkingLevel: overrides.thinkingLevel ?? "high",
    modelRegistry: overrides.modelRegistry ?? {},
    getSystemPrompt() {
      return overrides.systemPrompt ?? "parent system prompt";
    },
    isProjectTrusted() {
      return overrides.projectTrusted ?? true;
    },
    isIdle() {
      return parentIdle;
    },
    ui: {
      theme: overrides.theme ?? { fg: (color, text) => `<${color}>${text}</${color}>` },
      setStatus(key, text) {
        statuses.push({ key, text });
      },
      notify(message, type) {
        warnings.push({ message, type });
      },
    },
  };

  const executeTool = (name, params) => {
    const tool = tools.get(name);
    assert.ok(tool);
    return callTool(tool, params, context);
  };
  return {
    agentDir,
    tools,
    statuses,
    warnings,
    sent,
    async emit(event, payload = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler({ type: event, ...payload }, context);
      }
    },
    setIdle(value) {
      parentIdle = value;
    },
    execute: (params) => executeTool("subagent", params),
    message: (params) => executeTool("message_subagent", params),
    kill: (params) => executeTool("kill_subagent", params),
  };
}

// Installing the repository manifest loads the complete parent tool surface and no fork-context API.
test("repository package installs the fresh subagent parent tools", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
  const entry = manifest.pi.extensions.find((path) =>
    path.endsWith("/pi-subagents/extensions/subagents.ts"),
  );
  assert.ok(entry);

  const { default: installedExtension } = await import(new URL(entry, repositoryRoot));
  const tools = new Map();
  installedExtension({
    on() {},
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  });

  assert.deepEqual([...tools.keys()].sort(), ["kill_subagent", "message_subagent", "subagent"]);
  assert.equal(tools.has("message_parent"), false);
  const launchSchema = tools.get("subagent").parameters;
  assert.deepEqual(Object.keys(launchSchema.properties).sort(), ["display_name", "model_profile", "prompt"]);
  assert.deepEqual([...launchSchema.required].sort(), ["display_name", "prompt"]);
});

// Launch is background-only and reusable display names never become identity.
test("launch returns distinct UUID handles without waiting for child startup", async (t) => {
  const startup = deferred();
  const creations = [];
  const extension = await loadExtension(t, (options) => {
    creations.push(options);
    return startup.promise;
  });

  const first = await extension.execute({ display_name: "research", prompt: "Inspect the API." });
  const second = await extension.execute({ display_name: "research", prompt: "Inspect the tests." });
  await extension.execute({ display_name: "research", prompt: "Inspect the docs." });
  await extension.execute({ display_name: "research", prompt: "Inspect the config." });
  await assert.rejects(
    extension.execute({ display_name: "research", prompt: "Do not queue this." }),
    /limit 4 reached/i,
  );

  assert.equal(first.terminate, true);
  assert.equal(second.terminate, true);
  assert.equal(first.details.display_name, "research");
  assert.equal(second.details.display_name, "research");
  assert.match(first.details.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(second.details.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first.details.id, second.details.id);
  assert.equal(creations.length, 4);
  assert.match(
    extension.statuses.at(-1).text,
    /^(<dim>◌<\/dim> research#[0-9a-f]{8} ){2}<dim>◌<\/dim> research#[0-9a-f]{8} \+1$/i,
  );
});

// Footer glyphs distinguish every active lifecycle state without styling the child handle.
test("footer distinguishes starting, running, and waiting subagents", async (t) => {
  const startup = deferred();
  const promptStarted = deferred();
  const finishPrompt = deferred();
  let childOptions;
  const child = fakeChild({
    async prompt() {
      promptStarted.resolve();
      await finishPrompt.promise;
    },
  });
  const extension = await loadExtension(t, async (options) => {
    childOptions = options;
    await startup.promise;
    return child;
  });

  const launch = await extension.execute({ display_name: "lifecycle", prompt: "Exercise every state." });
  assert.match(extension.statuses.at(-1).text, /^<dim>◌<\/dim> lifecycle#[0-9a-f]{8}$/i);

  startup.resolve();
  await promptStarted.promise;
  assert.match(extension.statuses.at(-1).text, /^<success>\*<\/success> lifecycle#[0-9a-f]{8}$/i);

  const question = callTool(childOptions.messageParentTool, { kind: "question", message: "Continue?" });
  assert.match(extension.statuses.at(-1).text, /^<warning>\?<\/warning> lifecycle#[0-9a-f]{8}$/i);

  await extension.message({ id: launch.details.id, message: "Continue." });
  await question;
  assert.match(extension.statuses.at(-1).text, /^<success>\*<\/success> lifecycle#[0-9a-f]{8}$/i);

  finishPrompt.resolve();
  await waitFor(() => extension.sent.some(({ message }) => message.customType === "subagent-completed"));
});

// Parent guidance stays bound to a full UUID and switches from startup buffering to native steering.
test("parent messages buffer during startup and steer only the addressed running child", async (t) => {
  const startups = [deferred(), deferred()];
  const runs = [deferred(), deferred()];
  const steered = [[], []];
  const timelines = [[], []];
  const children = steered.map((messages, index) =>
    fakeChild({
      async steer(message) {
        timelines[index].push(`steer:${message}`);
        messages.push(message);
      },
      async prompt() {
        timelines[index].push("prompt");
        await runs[index].promise;
      },
    }),
  );
  let created = 0;
  const extension = await loadExtension(t, () => startups[created++].promise);
  const first = await extension.execute({ display_name: "first", prompt: "First task." });
  const second = await extension.execute({ display_name: "second", prompt: "Second task." });

  const buffered = await extension.message({ id: first.details.id, message: "Use the public API." });
  await extension.message({ id: first.details.id, message: "Preserve startup order." });
  await extension.message({ id: second.details.id, message: "Only for the second child." });
  assert.match(buffered.content[0].text, /buffered/i);
  assert.deepEqual(steered, [[], []]);

  startups[0].resolve(children[0]);
  startups[1].resolve(children[1]);
  await waitFor(() => steered[0].length === 2 && steered[1].length === 1);
  assert.deepEqual(steered, [
    ["Use the public API.", "Preserve startup order."],
    ["Only for the second child."],
  ]);
  assert.deepEqual(timelines, [
    ["prompt", "steer:Use the public API.", "steer:Preserve startup order."],
    ["prompt", "steer:Only for the second child."],
  ]);

  const delivered = await extension.message({ id: first.details.id, message: "Also inspect callers." });
  assert.match(delivered.content[0].text, /steered/i);
  assert.deepEqual(steered, [
    ["Use the public API.", "Preserve startup order.", "Also inspect callers."],
    ["Only for the second child."],
  ]);
  await assert.rejects(extension.message({ id: "not-a-uuid", message: "No." }), /full.*uuid/i);
  await assert.rejects(
    extension.message({ id: second.details.id.slice(0, 8), message: "No." }),
    /full.*uuid/i,
  );
  await assert.rejects(
    extension.message({ id: "00000000-0000-4000-8000-000000000000", message: "No." }),
    /no active subagent/i,
  );
});

// Child progress is visible parent context, never a parent tool, and never wakes either agent.
test("child progress reports identity without waking the parent or changing activity status", async (t) => {
  const run = deferred();
  const child = fakeChild({
    async prompt() {
      await run.promise;
    },
  });
  let creation;
  const extension = await loadExtension(
    t,
    async (options) => {
      creation = options;
      return child;
    },
    { parentIdle: false },
  );
  const launch = await extension.execute({ display_name: "reporter", prompt: "Report a milestone." });
  await waitFor(() => creation !== undefined);
  const status = extension.statuses.at(-1);

  assert.equal(extension.tools.has("message_parent"), false);
  assert.deepEqual(Object.keys(creation.messageParentTool.parameters.properties).sort(), ["kind", "message"]);
  const result = await callTool(creation.messageParentTool, {
    kind: "progress",
    message: "Inspected every caller.",
  });

  assert.match(result.content[0].text, /reported/i);
  assert.deepEqual(extension.statuses.at(-1), status);
  assert.equal(extension.sent.length, 0);
  extension.setIdle(true);
  await extension.emit("agent_settled");
  assert.equal(extension.sent.length, 1);
  assert.deepEqual(extension.sent[0].options, { deliverAs: "followUp", triggerTurn: false });
  assert.equal(extension.sent[0].message.customType, "subagent-progress");
  assert.equal(extension.sent[0].message.details.id, launch.details.id);
  assert.equal(extension.sent[0].message.details.display_name, "reporter");
  assert.match(extension.sent[0].message.content, new RegExp(launch.details.id));
  assert.match(extension.sent[0].message.content, /reporter/);
  assert.match(extension.sent[0].message.content, /Inspected every caller\./);
});

// A blocking child question is answered directly without consuming Pi's existing steering queue.
test("parent answer resolves one waiting question and later messages resume steering", async (t) => {
  const promptStarted = deferred();
  const run = deferred();
  const steered = [];
  const child = fakeChild({
    async steer(message) {
      steered.push(message);
    },
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
  });
  let creation;
  const extension = await loadExtension(
    t,
    async (options) => {
      creation = options;
      return child;
    },
    { parentIdle: false },
  );
  await writeFile(join(extension.agentDir, "subagents.json"), JSON.stringify({ maxConcurrent: 1 }));
  const launch = await extension.execute({ display_name: "asker", prompt: "Stop if ambiguous." });
  await promptStarted.promise;
  await extension.message({ id: launch.details.id, message: "Queued before the question." });
  await callTool(creation.messageParentTool, { kind: "progress", message: "Progress before question." });

  t.mock.timers.enable({ apis: ["setTimeout"] });
  let questionSettled = false;
  const question = callTool(creation.messageParentTool, {
    kind: "question",
    message: "Which API should I preserve?",
  }).finally(() => {
    questionSettled = true;
  });
  assert.equal(extension.sent.length, 0);
  extension.setIdle(true);
  await extension.emit("agent_settled");
  assert.equal(extension.sent.length, 2);
  t.mock.timers.tick(2_147_483_647);
  await Promise.resolve();

  assert.equal(questionSettled, false);
  assert.match(extension.statuses.at(-1).text, /^<warning>\?<\/warning> asker#[0-9a-f]{8}$/i);
  assert.deepEqual(
    extension.sent.map(({ message }) => message.customType),
    ["subagent-progress", "subagent-question"],
  );
  const questionNotice = extension.sent[1];
  assert.deepEqual(questionNotice.options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal(questionNotice.message.details.id, launch.details.id);
  assert.equal(questionNotice.message.details.display_name, "asker");
  assert.match(questionNotice.message.content, /Which API should I preserve\?/);
  await assert.rejects(
    extension.execute({ display_name: "blocked", prompt: "Do not start." }),
    /limit 1 reached/i,
  );
  await assert.rejects(
    callTool(creation.messageParentTool, { kind: "question", message: "A second question." }),
    /already waiting/i,
  );

  const answered = await extension.message({ id: launch.details.id, message: "Preserve the public API." });
  assert.match(answered.content[0].text, /answered/i);
  assert.deepEqual(steered, ["Queued before the question."]);
  assert.equal((await question).details.answer, "Preserve the public API.");
  assert.doesNotMatch(extension.statuses.at(-1).text, /\?/);

  await extension.message({ id: launch.details.id, message: "Continue." });
  assert.deepEqual(steered, ["Queued before the question.", "Continue."]);
});

// Explicit kill acknowledges with no result, rejects a blocked question, and never sends a second wake.
test("kill aborts a waiting child and returns a bare acknowledgement", async (t) => {
  const run = deferred();
  const promptStarted = deferred();
  const lifecycle = [];
  const child = fakeChild({
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden reasoning" },
          { type: "text", text: "Work completed before cancellation." },
        ],
      },
    ],
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
    async abort() {
      lifecycle.push("abort");
      run.resolve();
    },
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  let creation;
  const extension = await loadExtension(t, async (options) => {
    creation = options;
    return child;
  });
  const launch = await extension.execute({ display_name: "cancelled", prompt: "Work until stopped." });
  await promptStarted.promise;

  const question = callTool(creation.messageParentTool, {
    kind: "question",
    message: "Should I continue?",
  });
  const questionRejected = assert.rejects(question, /killed/i);
  await assert.rejects(extension.kill({ id: launch.details.id.slice(0, 8) }), /full.*uuid/i);
  const killed = await extension.kill({ id: launch.details.id });
  await questionRejected;

  assertCallsInAnyOrder(lifecycle, ["abort", "shutdown", "dispose"]);
  assert.equal(killed.details.id, launch.details.id);
  assert.equal(killed.details.display_name, "cancelled");
  assert.match(killed.content[0].text, /cooperative/i);
  assert.doesNotMatch(killed.content[0].text, /result/i);
  assert.equal(killed.details.result_path, undefined);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  assert.equal(extension.sent.length, 1);
  assert.equal(extension.sent[0].message.customType, "subagent-question");
  await assert.rejects(extension.kill({ id: launch.details.id }), /no active subagent/i);
  await assert.rejects(extension.message({ id: launch.details.id, message: "Too late." }), /no active subagent/i);

  // Kill returns a bare acknowledgement: no partial text carried back.
  assert.doesNotMatch(killed.content[0].text, /Work completed before cancellation/);
});

// A kill claimed before prompt failure remains the only terminal outcome and cleanup owner.
test("kill wins a simultaneous natural failure without duplicate cleanup or notification", async (t) => {
  const promptStarted = deferred();
  const lifecycle = [];
  let rejectPrompt;
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Partial work." }] }],
    async prompt() {
      promptStarted.resolve();
      await new Promise((_, reject) => {
        rejectPrompt = reject;
      });
    },
    async abort() {
      lifecycle.push("abort");
      rejectPrompt(new Error("aborted by parent"));
    },
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  const extension = await loadExtension(t, async () => child);
  const launch = await extension.execute({ display_name: "racer", prompt: "Race cancellation." });
  await promptStarted.promise;

  const killed = await extension.kill({ id: launch.details.id });
  await Promise.resolve();

  assertCallsInAnyOrder(lifecycle, ["abort", "shutdown", "dispose"]);
  assert.equal(extension.sent.length, 0);
  assert.equal(killed.details.result_path, undefined);
  assert.doesNotMatch(killed.content[0].text, /Partial work|aborted by parent/);
});

// Killing during construction returns immediately and disposes the child if startup later finishes.
test("kill claims a starting child and late startup is cleaned silently", async (t) => {
  const startup = deferred();
  const lifecycle = [];
  const child = fakeChild({
    async abort() {
      lifecycle.push("abort");
    },
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  const extension = await loadExtension(t, () => startup.promise);
  const launch = await extension.execute({ display_name: "starting", prompt: "Start slowly." });

  const killed = await extension.kill({ id: launch.details.id });
  assert.equal(killed.details.result_path, undefined);
  assert.doesNotMatch(killed.content[0].text, /result/i);
  assert.deepEqual(lifecycle, []);
  assert.equal(extension.sent.length, 0);

  startup.resolve(child);
  await waitFor(() => lifecycle.includes("dispose"));
  assertCallsInAnyOrder(lifecycle, ["abort", "shutdown", "dispose"]);
  assert.equal(extension.sent.length, 0);
});

// Child construction preserves the project contract without copying parent conversation messages.
test("launch creates one fresh child with inherited capabilities and a delimited task", async (t) => {
  const run = deferred();
  const promptStarted = deferred();
  const prompts = [];
  const child = fakeChild({
    async prompt(text) {
      prompts.push(text);
      promptStarted.resolve();
      await run.promise;
    },
  });
  let creation;
  const extension = await loadExtension(t, async (options) => {
    creation = options;
    return child;
  });

  const result = await extension.execute({ display_name: "worker", prompt: "Implement the narrow change." });
  await promptStarted.promise;

  assert.equal(creation.cwd, "/workspace");
  assert.equal(creation.projectTrusted, true);
  assert.deepEqual(creation.model, { provider: "test", id: "parent-model" });
  assert.equal(creation.thinkingLevel, "high");
  assert.deepEqual(creation.tools, ["read", "write"]);
  assert.deepEqual(creation.excludeTools, ["subagent", "message_subagent", "kill_subagent"]);
  assert.equal(creation.messageParentTool.name, "message_parent");
  assert.equal("messages" in creation, false);
  assert.match(creation.systemPrompt, /^parent system prompt/);
  assert.match(creation.systemPrompt, /fresh subagent, not the parent agent/i);
  assert.match(creation.systemPrompt, /no parent conversation history/i);
  assert.match(creation.systemPrompt, /parent remains authoritative/i);
  assert.match(creation.systemPrompt, /share.*working directory.*concurrent work/i);
  assert.match(creation.systemPrompt, /inspect current file contents before editing/i);
  assert.match(creation.systemPrompt, /modify files only when.*explicitly asks/i);
  assert.match(creation.systemPrompt, /never revert unrelated changes/i);
  assert.match(creation.systemPrompt, /conflicts.*stop and report/i);
  assert.match(creation.systemPrompt, /final assistant message is delivered to the parent verbatim/i);
  assert.match(creation.systemPrompt, /artifacts only when the delegated task asks/i);
  assert.match(creation.systemPrompt, /message_parent.*meaningful milestones.*question/i);
  assert.equal(child.messages.length, 0);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], new RegExp(`subagent_id: ${result.details.id}`));
  assert.match(prompts[0], /display_name: worker/);
  assert.match(prompts[0], /context: fresh; no parent conversation inherited/);
  assert.match(prompts[0], /task:\nImplement the narrow change\./);
});

// Named profiles resolve only through the global configuration and parent model registry.
test("configured model profiles select their model and thinking level", async (t) => {
  const startup = deferred();
  const creations = [];
  const models = new Map(
    NAMED_PROFILES.map((name) => [
      `test/${name}-model`,
      { provider: "test", id: `${name}-model`, reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } },
    ]),
  );
  const extension = await loadExtension(
    t,
    (options) => {
      creations.push(options);
      return startup.promise;
    },
    {
      modelRegistry: {
        find(provider, model) {
          return models.get(`${provider}/${model}`);
        },
        hasConfiguredAuth() {
          return true;
        },
      },
    },
  );
  await writeFile(
    join(extension.agentDir, "subagents.json"),
    JSON.stringify({
      profiles: Object.fromEntries(
        NAMED_PROFILES.map((name) => [
          name,
          { provider: "test", model: `${name}-model`, thinkingLevel: name },
        ]),
      ),
    }),
  );

  for (const name of NAMED_PROFILES) {
    await extension.execute({ display_name: name, prompt: `Run ${name}.`, model_profile: name });
  }

  assert.deepEqual(
    creations.map(({ model, thinkingLevel }) => [model.id, thinkingLevel]),
    [
      ["low-model", "low"],
      ["medium-model", "medium"],
      ["high-model", "high"],
      ["xhigh-model", "xhigh"],
    ],
  );
});

// Every missing named profile falls back visibly across parent execution modes.
test("unconfigured model profiles visibly fall back to inherited model", async (t) => {
  const scenarios = [
    { profile: "low", mode: "tui" },
    { profile: "medium", mode: "print", config: {} },
    { profile: "high", mode: "json", config: { maxConcurrent: 4 } },
    { profile: "xhigh", mode: "rpc", config: { profiles: {} } },
  ];

  for (const { profile, mode, config } of scenarios) {
    const creations = [];
    const child = fakeChild({
      messages: [{ role: "assistant", content: [{ type: "text", text: "Inherited result." }] }],
    });
    const extension = await loadExtension(
      t,
      async (options) => {
        creations.push(options);
        return child;
      },
      { mode },
    );
    if (config) await writeFile(join(extension.agentDir, "subagents.json"), JSON.stringify(config));

    const launch = await extension.execute({
      display_name: "fallback",
      prompt: "Use the available profile.",
      model_profile: profile,
    });

    assert.match(
      launch.content[0].text,
      new RegExp(`profile ${profile} is not configured; using inherit`, "i"),
    );
    assert.equal(extension.warnings.length, 0);
    assert.equal(creations[0].model.id, "parent-model");
    assert.equal(creations[0].thinkingLevel, "high");

    await waitFor(() => extension.sent.length === 1);
  }
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for background subagent work.");
}

// Successful completion inlines one focused result only after child disposal.
test("natural completion inlines the result, disposes the child, and wakes the parent once", async (t) => {
  const lifecycle = [];
  const child = fakeChild({
    messages: [
      { role: "user", content: [{ type: "text", text: "transcript text must stay private" }] },
      {
        role: "assistant",
        provider: "private-provider-metadata",
        content: [
          { type: "thinking", thinking: "hidden reasoning" },
          { type: "text", text: "First result block.\n" },
          { type: "toolCall", name: "read", arguments: { path: "secret" } },
          { type: "text", text: "Second result block." },
        ],
      },
    ],
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  const extension = await loadExtension(t, async () => child);

  const launch = await extension.execute({ display_name: "finisher", prompt: "Return the exact finding." });
  await waitFor(() => extension.sent.length === 1);

  assertCallsInAnyOrder(lifecycle, ["shutdown", "dispose"]);
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-completed");
  assert.equal(message.details.id, launch.details.id);
  assert.equal(message.details.display_name, "finisher");
  assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
  assert.match(message.content, /finisher/);
  assert.match(message.content, new RegExp(launch.details.id));
  assert.match(message.content, /First result block\.\nSecond result block\./);
  assert.doesNotMatch(message.content, /result\.md/);
  assert.equal(message.details.result_path, undefined);
  // Inlined result excludes hidden reasoning, tool activity, provider metadata, and the restated task.
  assert.doesNotMatch(message.content, /hidden reasoning|toolCall|secret|private-provider|Return the exact finding/);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  await assert.rejects(
    extension.message({ id: launch.details.id, message: "Too late." }),
    /no active subagent/i,
  );
});

// The full terminal text is inlined verbatim, past the old bounded-preview boundary.
test("completion inlines a long result without truncating at the old preview length", async (t) => {
  const longResult = "X".repeat(2000);
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: longResult }] }],
  });
  const extension = await loadExtension(t, async () => child);

  await extension.execute({ display_name: "verbose", prompt: "Produce a long answer." });
  await waitFor(() => extension.sent.length === 1);

  const { message } = extension.sent[0];
  assert.equal(message.customType, "subagent-completed");
  assert.match(message.content, new RegExp(longResult));
  assert.doesNotMatch(message.content, /…/);
  assert.equal(message.details.result_path, undefined);
});

// Terminal message events remain the source of the focused result even when the session view lags.
test("terminal assistant event supplies the completed result text", async (t) => {
  let listener;
  const child = fakeChild({
    subscribe(next) {
      listener = next;
      return () => {};
    },
    async prompt() {
      listener({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "Captured terminal text." },
          ],
        },
      });
    },
  });
  const extension = await loadExtension(t, async () => child);

  await extension.execute({ display_name: "event-result", prompt: "Capture the event." });
  await waitFor(() => extension.sent.length === 1);

  assert.match(extension.sent[0].message.content, /Captured terminal text\./);
  assert.equal(extension.sent[0].message.details.result_path, undefined);
  assert.doesNotMatch(extension.sent[0].message.content, /hidden/);
});

// Provider failures inline their visible partial answer without leaking the child transcript.
test("natural failure inlines the error and partial text and wakes the parent once", async (t) => {
  const lifecycle = [];
  const child = fakeChild({
    messages: [
      { role: "user", content: [{ type: "text", text: "private transcript" }] },
      {
        role: "assistant",
        stopReason: "error",
        errorMessage: "provider failed",
        provider: "private-provider",
        content: [
          { type: "thinking", thinking: "hidden reasoning" },
          { type: "text", text: "Available partial result." },
          { type: "toolCall", name: "read", arguments: { path: "secret" } },
        ],
      },
    ],
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  const extension = await loadExtension(t, async () => child);

  const launch = await extension.execute({ display_name: "failing", prompt: "Try the provider." });
  await waitFor(() => extension.sent.length === 1);

  assertCallsInAnyOrder(lifecycle, ["shutdown", "dispose"]);
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-failed");
  assert.equal(message.details.id, launch.details.id);
  assert.equal(message.details.display_name, "failing");
  assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
  assert.match(message.content, /provider failed/);
  assert.match(message.content, /Available partial result\./);

  assert.equal(message.details.result_path, undefined);
  // Failure inlines the error and partial text while excluding transcript and provider metadata.
  assert.doesNotMatch(message.content, /hidden reasoning|toolCall|secret|private-provider|private transcript/);
});

// Once terminal finalization begins, the UUID stops accepting controls and leaves active status.
test("completion wins kill and releases its slot before disposal", async (t) => {
  const shutdownStarted = deferred();
  const allowShutdown = deferred();
  const steered = [];
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }],
    async steer(message) {
      steered.push(message);
    },
    async shutdown() {
      shutdownStarted.resolve();
      await allowShutdown.promise;
    },
  });
  const replacementStartup = deferred();
  let creations = 0;
  const extension = await loadExtension(t, async () => (creations++ === 0 ? child : replacementStartup.promise));
  await writeFile(join(extension.agentDir, "subagents.json"), JSON.stringify({ maxConcurrent: 1 }));
  const launch = await extension.execute({ display_name: "finalizer", prompt: "Finish." });
  await shutdownStarted.promise;

  await assert.rejects(
    extension.message({ id: launch.details.id, message: "Too late." }),
    /no active subagent/i,
  );
  assert.deepEqual(steered, []);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  await assert.rejects(extension.kill({ id: launch.details.id }), /no active subagent/i);
  const replacement = await extension.execute({ display_name: "replacement", prompt: "Use the free slot." });
  assert.match(extension.statuses.at(-1).text, /^<dim>◌<\/dim> replacement#[0-9a-f]{8}$/i);
  assert.notEqual(replacement.details.id, launch.details.id);

  allowShutdown.resolve();
  await waitFor(() => extension.sent.length === 1);
  assert.equal(extension.sent[0].message.details.result_path, undefined);
});

// The terminal event claims completion before the prompt promise yields back to orchestration.
test("terminal completion event beats a later kill call", async (t) => {
  const promptStarted = deferred();
  const allowPromptReturn = deferred();
  let shutdownBegan = false;
  const allowShutdown = deferred();
  let listener;
  const child = fakeChild({
    subscribe(next) {
      listener = next;
      return () => {};
    },
    async prompt() {
      promptStarted.resolve();
      await allowPromptReturn.promise;
    },
    async shutdown() {
      shutdownBegan = true;
      await allowShutdown.promise;
    },
  });
  const extension = await loadExtension(t, async () => child);
  const launch = await extension.execute({ display_name: "event-winner", prompt: "Finish by event." });
  await promptStarted.promise;

  listener({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Event won." }] },
  });
  listener({ type: "agent_settled" });
  await waitFor(() => shutdownBegan);

  await assert.rejects(extension.kill({ id: launch.details.id }), /no active subagent/i);
  allowShutdown.resolve();
  await waitFor(() => extension.sent.length === 1);
  allowPromptReturn.resolve();

  assert.equal(extension.sent[0].message.details.result_path, undefined);
  assert.match(extension.sent[0].message.content, /Event won\./);
});

// Configuration-equivalent inheritance fails visibly instead of silently dropping a parent work tool.
test("startup failure disposes a child that cannot rediscover every active work tool", async (t) => {
  const lifecycle = [];
  let prompted = false;
  const child = fakeChild({
    getActiveToolNames: () => ["read"],
    async prompt() {
      prompted = true;
    },
    async abort() {
      lifecycle.push("abort");
    },
    async shutdown() {
      lifecycle.push("shutdown");
    },
    dispose() {
      lifecycle.push("dispose");
    },
  });
  const extension = await loadExtension(t, async () => child);

  const launch = await extension.execute({ display_name: "missing-tool", prompt: "Use write." });
  await waitFor(() => extension.sent.length === 1);

  assert.equal(prompted, false);
  assertCallsInAnyOrder(lifecycle, ["shutdown", "dispose"]);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  assert.equal(extension.sent[0].message.customType, "subagent-failed");
  assert.match(extension.sent[0].message.content, /missing-tool/);
  assert.match(extension.sent[0].message.content, new RegExp(launch.details.id));
  assert.match(extension.sent[0].message.content, /could not load active tools: write/i);
  assert.deepEqual(extension.sent[0].options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal(extension.sent[0].message.details.result_path, undefined);
  assert.match(extension.sent[0].message.content, /_No final textual result\._/);
});

// Parent lifecycle cleanup closes delivery before aborting every owned child and is idempotent.
test("session shutdown silently cancels active, waiting, starting, and finalizing children", async (t) => {
  const runs = [deferred(), deferred()];
  const starts = [deferred(), deferred()];
  const lifecycle = [[], [], [], []];
  const creations = [];
  const activeChildren = [0, 1].map((index) =>
    fakeChild({
      async prompt() {
        starts[index].resolve();
        await runs[index].promise;
      },
      async abort() {
        lifecycle[index].push("abort");
        if (index === 0) runs[index].reject(new Error("late child failure"));
        else runs[index].resolve();
      },
      async shutdown() {
        lifecycle[index].push("shutdown");
      },
      dispose() {
        lifecycle[index].push("dispose");
      },
    }),
  );
  const finalShutdownStarted = deferred();
  const allowFinalShutdown = deferred();
  const finalizingChild = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Should stay unpublished." }] }],
    async shutdown() {
      lifecycle[2].push("shutdown");
      finalShutdownStarted.resolve();
      await allowFinalShutdown.promise;
    },
    dispose() {
      lifecycle[2].push("dispose");
    },
  });
  const lateStartup = deferred();
  const lateChild = fakeChild({
    async abort() {
      lifecycle[3].push("abort");
    },
    async shutdown() {
      lifecycle[3].push("shutdown");
    },
    dispose() {
      lifecycle[3].push("dispose");
    },
  });
  let created = 0;
  const extension = await loadExtension(
    t,
    async (options) => {
      creations.push(options);
      const index = created++;
      if (index < 2) return activeChildren[index];
      if (index === 2) return finalizingChild;
      return lateStartup.promise;
    },
    { parentIdle: false },
  );

  const running = await extension.execute({ display_name: "running", prompt: "Keep running." });
  const waiting = await extension.execute({ display_name: "waiting", prompt: "Ask first." });
  await Promise.all(starts.map(({ promise }) => promise));
  await callTool(creations[0].messageParentTool, { kind: "progress", message: "Queued progress." });
  const question = callTool(creations[1].messageParentTool, {
    kind: "question",
    message: "Queued question?",
  });
  const questionRejected = assert.rejects(question, /no longer available/i);
  await extension.execute({ display_name: "finalizing", prompt: "Finish now." });
  await finalShutdownStarted.promise;
  await extension.execute({ display_name: "starting", prompt: "Still starting." });
  assert.equal(extension.sent.length, 0);

  const shutdown = extension.emit("session_shutdown", { reason: "reload" });
  await waitFor(() => extension.statuses.at(-1)?.text === undefined);
  await questionRejected;
  await assert.rejects(extension.message({ id: running.details.id, message: "Too late." }), /unavailable/i);
  await assert.rejects(extension.kill({ id: waiting.details.id }), /unavailable/i);
  await assert.rejects(
    extension.execute({ display_name: "new", prompt: "Too late." }),
    /unavailable/i,
  );
  allowFinalShutdown.resolve();
  await shutdown;

  lateStartup.resolve(lateChild);
  await waitFor(() => lifecycle[3].includes("dispose"));
  await assert.rejects(
    callTool(creations[0].messageParentTool, { kind: "progress", message: "Late progress." }),
    /no longer available/i,
  );
  extension.setIdle(true);
  await extension.emit("agent_settled");
  await extension.emit("session_shutdown", { reason: "quit" });

  assertCallsInAnyOrder(lifecycle[0], ["abort", "shutdown", "dispose"]);
  assertCallsInAnyOrder(lifecycle[1], ["abort", "shutdown", "dispose"]);
  assertCallsInAnyOrder(lifecycle[2], ["shutdown", "dispose"]);
  assertCallsInAnyOrder(lifecycle[3], ["abort", "shutdown", "dispose"]);
  assert.equal(extension.sent.length, 0);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
});

// A committed tree transition stops old-timeline children before navigation and warns without waking.
test("tree navigation closes the old timeline and reopens controls after one cancellation notice", async (t) => {
  const runs = [deferred(), deferred()];
  const starts = [deferred(), deferred()];
  const creations = [];
  const steered = [];
  const children = [0, 1].map((index) =>
    fakeChild({
      async prompt() {
        starts[index].resolve();
        await runs[index].promise;
      },
      async steer(message) {
        steered.push(message);
      },
      async abort() {
        runs[index].resolve();
      },
    }),
  );
  const replacementStartup = deferred();
  let created = 0;
  const extension = await loadExtension(
    t,
    async (options) => {
      creations.push(options);
      return created < 2 ? children[created++] : replacementStartup.promise;
    },
    { parentIdle: false },
  );
  const first = await extension.execute({ display_name: "first", prompt: "Old branch one." });
  const second = await extension.execute({ display_name: "second", prompt: "Old branch two." });
  await Promise.all(starts.map(({ promise }) => promise));

  // No tree lifecycle event means opening, cancelling, or selecting the current leaf changes nothing.
  await extension.message({ id: first.details.id, message: "Still on this leaf." });
  assert.deepEqual(steered, ["Still on this leaf."]);
  const question = callTool(creations[1].messageParentTool, {
    kind: "question",
    message: "Should this survive navigation?",
  });
  const questionRejected = assert.rejects(question, /no longer available/i);

  const beforeTree = extension.emit("session_before_tree", {
    preparation: { targetId: "target", oldLeafId: "old" },
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  await assert.rejects(extension.message({ id: first.details.id, message: "Closed." }), /unavailable/i);
  await assert.rejects(extension.kill({ id: second.details.id }), /unavailable/i);
  await questionRejected;
  await beforeTree;
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  assert.equal(extension.sent.length, 0);
  await assert.rejects(
    callTool(creations[0].messageParentTool, { kind: "progress", message: "Late old-branch progress." }),
    /no longer available/i,
  );

  await extension.emit("session_tree", { newLeafId: "new", oldLeafId: "old" });
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagents-tree-cancelled");
  assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: false });
  assert.match(message.content, new RegExp(`first#${first.details.id.slice(0, 8)}`));
  assert.match(message.content, new RegExp(`second#${second.details.id.slice(0, 8)}`));
  assert.match(message.content, /workspace changes were not reverted/i);

  const replacement = await extension.execute({ display_name: "replacement", prompt: "New branch work." });
  assert.notEqual(replacement.details.id, first.details.id);
});

// Navigating with no owned child emits no warning but still restores the tool surface.
test("empty tree navigation emits no notice and permits later launches", async (t) => {
  const startup = deferred();
  const extension = await loadExtension(t, () => startup.promise);

  await extension.emit("session_before_tree", {
    preparation: { targetId: "target", oldLeafId: "old" },
    signal: new AbortController().signal,
  });
  await extension.emit("session_tree", { newLeafId: "new", oldLeafId: "old" });

  assert.equal(extension.sent.length, 0);
  const launch = await extension.execute({ display_name: "new", prompt: "Start after navigation." });
  assert.equal(launch.details.display_name, "new");
});

// The configured active limit rejects instead of queueing and renders a compact actionable frontier.
test("global concurrency configuration bounds active launches", async (t) => {
  const startup = deferred();
  let creations = 0;
  const extension = await loadExtension(t, () => {
    creations += 1;
    return startup.promise;
  });
  await writeFile(join(extension.agentDir, "subagents.json"), JSON.stringify({ maxConcurrent: 2 }));

  await extension.execute({ display_name: "one", prompt: "First." });
  await extension.execute({ display_name: "two", prompt: "Second." });
  await assert.rejects(
    extension.execute({ display_name: "three", prompt: "Never queued." }),
    /limit 2 reached: one#[0-9a-f]{8} two#[0-9a-f]{8}/i,
  );
  assert.equal(creations, 2);

  for (const invalidLimit of [0, -1, 1.5, "4"]) {
    const fallback = await loadExtension(t, () => startup.promise);
    await writeFile(
      join(fallback.agentDir, "subagents.json"),
      JSON.stringify({ maxConcurrent: invalidLimit }),
    );
    for (const name of ["a", "b", "c", "d"]) {
      await fallback.execute({ display_name: name, prompt: name });
    }
    await assert.rejects(fallback.execute({ display_name: "e", prompt: "e" }), /limit 4 reached/i);
    assert.ok(
      fallback.warnings.some(
        ({ message, type }) =>
          message === "Invalid maxConcurrent in subagents.json; using 4." && type === "warning",
      ),
    );
    assert.match(
      fallback.statuses.at(-1).text,
      /^<dim>◌<\/dim> a#[0-9a-f]{8} <dim>◌<\/dim> b#[0-9a-f]{8} <dim>◌<\/dim> c#[0-9a-f]{8} \+1$/i,
    );
  }
});

// Invalid launch policy is rejected before identity, status, or child resources are allocated.
test("invalid and unavailable profiles leave no active child", async (t) => {
  const cases = [
    { source: "{", error: /Cannot parse subagents\.json/ },
    { source: JSON.stringify({ profiles: null }), error: /profiles must be an object/i },
    {
      source: JSON.stringify({
        profiles: { turbo: { provider: "test", model: "model", thinkingLevel: "high" } },
      }),
      error: /unsupported model profile turbo/i,
    },
    { source: JSON.stringify({}), noParent: true, error: /without an active parent model/i },
    {
      source: JSON.stringify({
        profiles: { low: { provider: "missing", model: "model", thinkingLevel: "low" } },
      }),
      error: /profile low is unavailable/i,
    },
    {
      source: JSON.stringify({
        profiles: { low: { provider: "test", model: "model", thinkingLevel: "low" } },
      }),
      model: { provider: "test", id: "model", reasoning: true },
      auth: false,
      error: /profile low is unavailable/i,
    },
    {
      source: JSON.stringify({
        profiles: { low: { provider: "test", model: "model", thinkingLevel: "xhigh" } },
      }),
      model: { provider: "test", id: "model", reasoning: true },
      error: /unsupported thinking level xhigh/i,
    },
    {
      source: JSON.stringify({
        profiles: { low: { provider: "", model: "model", thinkingLevel: "low" } },
      }),
      error: /invalid model profile low/i,
    },
  ];

  for (const scenario of cases) {
    let creations = 0;
    const extension = await loadExtension(
      t,
      async () => {
        creations += 1;
        throw new Error("factory should not run");
      },
      {
        model: scenario.noParent ? undefined : { provider: "test", id: "parent-model" },
        modelRegistry: {
          find: () => scenario.model,
          hasConfiguredAuth: () => scenario.auth ?? true,
        },
      },
    );
    await writeFile(join(extension.agentDir, "subagents.json"), scenario.source);

    await assert.rejects(
      extension.execute({ display_name: "invalid", prompt: "Do not start.", model_profile: "low" }),
      scenario.error,
    );
    assert.equal(creations, 0);
    assert.equal(extension.statuses.length, 0);
  }
});

// Footer presentation is optional and an empty terminal answer still produces an explicit result.
test("fresh launch completes without TUI status or final text", async (t) => {
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "not visible" }] }],
  });
  const extension = await loadExtension(t, async () => child, { mode: "print" });

  await extension.execute({ display_name: "headless", prompt: "Check without a TUI." });
  await waitFor(() => extension.sent.length === 1);

  assert.equal(extension.statuses.length, 0);
  assert.equal(extension.sent[0].message.details.result_path, undefined);
  assert.match(extension.sent[0].message.content, /_No final textual result\._/);
});

// The production adapter rediscovers configured child extensions and skills through Pi's public SDK.
test("production child session rediscovers configured resources and runs extension lifecycle", async (t) => {
  const projectDir = await mkdtemp(join(tmpdir(), "pi-subagent-project-"));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  const parentFaux = fauxProvider({ provider: "subagent-test", models: [{ id: "child-model" }] });
  const extension = await loadExtension(t, undefined, {
    activeTools: ["read", "child_probe", "subagent"],
    cwd: projectDir,
    mode: "print",
    model: parentFaux.getModel(),
    thinkingLevel: "off",
    systemPrompt: "parent system marker",
  });
  const childExtensionPath = join(extension.agentDir, "child-extension.mjs");
  const skillDir = join(extension.agentDir, "skills", "rediscovered");
  const shutdownMarker = join(extension.agentDir, "child-shutdown");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: rediscovered\ndescription: Rediscovered skill marker.\n---\nUse the rediscovered skill.\n",
  );
  await writeFile(
    childExtensionPath,
    `import { writeFileSync } from "node:fs";
import { Type, fauxAssistantMessage, fauxProvider } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};

let started = false;
const faux = fauxProvider({ provider: "subagent-test", models: [{ id: "child-model" }] });
faux.setResponses([(context) => fauxAssistantMessage(JSON.stringify({
  started,
  skill: context.systemPrompt?.includes("Rediscovered skill marker") ?? false,
  tool: context.tools?.some(({ name }) => name === "child_probe") ?? false,
  parent: context.tools?.some(({ name }) => name === "message_parent") ?? false,
}))]);

export default function childProbe(pi) {
  pi.registerProvider(faux.provider);
  pi.registerTool({
    name: "child_probe",
    label: "Child probe",
    description: "Test child resource rediscovery.",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "probe" }], details: {} };
    },
  });
  pi.on("session_start", () => { started = true; });
  pi.on("session_shutdown", () => { writeFileSync(${JSON.stringify(shutdownMarker)}, "shutdown"); });
}
`,
  );
  await writeFile(
    join(extension.agentDir, "settings.json"),
    JSON.stringify({ extensions: [childExtensionPath], skills: [skillDir] }),
  );

  await extension.execute({ display_name: "real-child", prompt: "Report resource state." });
  await waitFor(() => extension.sent.length === 1);

  assert.equal(extension.sent[0].message.customType, "subagent-completed");
  assert.match(extension.sent[0].message.content, /\{"started":true,"skill":true,"tool":true,"parent":true\}/);
  assert.equal(await readFile(shutdownMarker, "utf8"), "shutdown");
  assert.equal(extension.sent[0].message.details.result_path, undefined);
});
