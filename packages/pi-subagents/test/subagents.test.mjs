import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { fauxProvider } from "@earendil-works/pi-ai";

import { createSubagentsExtension } from "../extensions/subagents.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const NAMED_PROFILES = ["low", "medium", "high", "xhigh"];

function fakeChild(overrides = {}) {
  return {
    messages: [],
    getActiveToolNames: () => ["read", "write", "message_parent"],
    async steer() {},
    async prompt() {},
    async shutdown() {},
    dispose() {},
    ...overrides,
  };
}

function callTool(tool, params, context = {}) {
  return tool.execute("call", params, undefined, undefined, context);
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
  const model = overrides.model ?? { provider: "test", id: "parent-model" };
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
    async emit(event) {
      for (const handler of handlers.get(event) ?? []) await handler({ type: event }, context);
    },
    setIdle(value) {
      parentIdle = value;
    },
    execute: (params) => executeTool("subagent", params),
    message: (params) => executeTool("message_subagent", params),
  };
}

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
    /^(research#[0-9a-f]{8} ){2}research#[0-9a-f]{8} \+1$/i,
  );
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
  assert.match(extension.statuses.at(-1).text, /asker#[0-9a-f]{8}\?$/i);
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for background subagent work.");
}

// Successful completion publishes one durable focused result only after child disposal.
test("natural completion writes a private result, disposes the child, and wakes the parent once", async (t) => {
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

  assert.deepEqual(lifecycle, ["shutdown", "dispose"]);
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-completed");
  assert.equal(message.details.id, launch.details.id);
  assert.equal(message.details.display_name, "finisher");
  assert.deepEqual(options, { deliverAs: "followUp", triggerTurn: true });
  assert.match(message.content, /finisher/);
  assert.match(message.content, new RegExp(launch.details.id));
  assert.match(message.content, /First result block\.\nSecond result block\./);
  assert.match(message.content, /result\.md/);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });

  const resultPath = message.details.result_path;
  t.after(() => rm(dirname(resultPath), { recursive: true, force: true }));
  assert.equal((await stat(resultPath)).mode & 0o777, 0o600);
  const result = await readFile(resultPath, "utf8");
  assert.match(result, new RegExp(launch.details.id));
  assert.match(result, /Display name: finisher/);
  assert.match(result, /Status: completed/);
  assert.match(result, /Model profile: inherit/);
  assert.match(result, /Model: test\/parent-model/);
  assert.match(result, /Thinking level: high/);
  assert.match(result, /Return the exact finding\./);
  assert.match(result, /First result block\.\nSecond result block\./);
  assert.doesNotMatch(result, /hidden reasoning|toolCall|secret|private-provider|transcript text/);
  await assert.rejects(
    extension.message({ id: launch.details.id, message: "Too late." }),
    /no active subagent/i,
  );
});

// Once terminal finalization begins, the UUID stops accepting controls and leaves active status.
test("finalizing child rejects parent messages before disposal", async (t) => {
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
  const extension = await loadExtension(t, async () => child);
  const launch = await extension.execute({ display_name: "finalizer", prompt: "Finish." });
  await shutdownStarted.promise;

  await assert.rejects(
    extension.message({ id: launch.details.id, message: "Too late." }),
    /no active subagent/i,
  );
  assert.deepEqual(steered, []);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });

  allowShutdown.resolve();
  await waitFor(() => extension.sent.length === 1);
  const resultPath = extension.sent[0].message.details.result_path;
  t.after(() => rm(dirname(resultPath), { recursive: true, force: true }));
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
  assert.deepEqual(lifecycle, ["shutdown", "dispose"]);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  assert.equal(extension.sent[0].message.customType, "subagent-failed");
  assert.match(extension.sent[0].message.content, /missing-tool/);
  assert.match(extension.sent[0].message.content, new RegExp(launch.details.id));
  assert.match(extension.sent[0].message.content, /could not load active tools: write/i);
  assert.deepEqual(extension.sent[0].options, { deliverAs: "followUp", triggerTurn: true });
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
    assert.match(fallback.statuses.at(-1).text, /^a#[0-9a-f]{8} b#[0-9a-f]{8} c#[0-9a-f]{8} \+1$/i);
  }
});

// Invalid launch policy is rejected before identity, status, or child resources are allocated.
test("invalid and unavailable profiles leave no active child", async (t) => {
  const cases = [
    { source: "{", error: /Cannot parse subagents\.json/ },
    { source: JSON.stringify({}), error: /profile low is not configured/i },
    {
      source: JSON.stringify({
        profiles: { low: { provider: "missing", model: "model", thinkingLevel: "low" } },
      }),
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
        modelRegistry: {
          find: () => scenario.model,
          hasConfiguredAuth: () => true,
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
  const resultPath = extension.sent[0].message.details.result_path;
  t.after(() => rm(dirname(resultPath), { recursive: true, force: true }));
  assert.match(await readFile(resultPath, "utf8"), /_No final textual result\._/);
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
  const resultPath = extension.sent[0].message.details.result_path;
  t.after(() => rm(dirname(resultPath), { recursive: true, force: true }));
  assert.match(await readFile(resultPath, "utf8"), /\{"started":true,"skill":true,"tool":true,"parent":true\}/);
});
