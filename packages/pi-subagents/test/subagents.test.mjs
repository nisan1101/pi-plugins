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

// Drop the HH:MM:SS prefix so tests assert on log content, not the wall clock.
function stripTs(line) {
  return line.replace(/^\d{2}:\d{2}:\d{2} /, "");
}

// Matches an ISO 8601 wall-clock stamp; lifecycle messages embed the raw instant, no deltas.
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/;

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
  const commands = new Map();
  const selectCalls = [];
  const statuses = [];
  const warnings = [];
  const sent = [];
  const handlers = new Map();
  let parentIdle = overrides.parentIdle ?? true;
  const logLines = new Map();
  let logCleanups = 0;
  const logBridge = overrides.logBridge ?? {
    open(id) {
      const lines = logLines.get(id) ?? [];
      logLines.set(id, lines);
      return { path: `/fake/${id}.log`, append: (line) => lines.push(line) };
    },
    cleanup() {
      logCleanups += 1;
    },
  };
  createSubagentsExtension({ createChildSession, logBridge, displays: overrides.displays ?? [] })({
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
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
      overrides.onSend?.(message, options);
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
      async select(title, options) {
        selectCalls.push({ title, options });
        const choose = overrides.selectChoice;
        if (typeof choose === "function") return choose(options);
        return choose;
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
    logLines,
    logOf: (id) => logLines.get(id) ?? [],
    getLogCleanups: () => logCleanups,
    async emit(event, payload = {}) {
      for (const handler of handlers.get(event) ?? []) {
        await handler({ type: event, ...payload }, context);
      }
    },
    setIdle(value) {
      parentIdle = value;
    },
    selectCalls,
    execute: (params) => executeTool("subagent", params),
    message: (params) => executeTool("message_subagent", params),
    kill: (params) => executeTool("kill_subagent", params),
    runSubagents: (args = "") => {
      const command = commands.get("subagents");
      assert.ok(command, "subagents command is registered");
      return command.handler(args, context);
    },
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
  const commands = new Map();
  installedExtension({
    on() {},
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  });

  assert.deepEqual([...tools.keys()].sort(), ["kill_subagent", "message_subagent", "subagent"]);
  assert.equal(tools.has("message_parent"), false);
  assert.deepEqual([...commands.keys()], ["subagents"]);
  const launchSchema = tools.get("subagent").parameters;
  assert.deepEqual(Object.keys(launchSchema.properties).sort(), ["display_name", "model_profile", "prompt"]);
  assert.deepEqual([...launchSchema.required].sort(), ["display_name", "prompt"]);
});

const plainTheme = { fg: (_color, text) => text };

function renderLaunch(extension, result, args = {}, options = {}, context = {}) {
  return extension.tools.get("subagent").renderResult(
    result,
    { expanded: false, isPartial: false, ...options },
    plainTheme,
    { args, isError: false, ...context },
  ).render(200).map((line) => line.trimEnd());
}

test("launch results stay compact after child cleanup and expand to the unchanged full text", async (t) => {
  const extension = await loadExtension(t, async () => fakeChild());
  const args = { display_name: "renderer-review", prompt: "Review rendering." };
  const launch = await extension.execute(args);
  const persisted = JSON.parse(JSON.stringify(launch));
  await waitFor(() => extension.sent.length === 1);
  await extension.emit("session_shutdown");

  assert.deepEqual(renderLaunch(extension, persisted, args), [
    `Started renderer-review#${launch.details.id.slice(0, 8)} in background`,
  ]);
  assert.equal(
    renderLaunch(extension, persisted, args, { expanded: true }).join(" "),
    launch.content[0].text,
  );
  assert.deepEqual(launch, persisted);
});

for (const scenario of [
  {
    name: "launch errors remain visible rather than rendering as successful starts",
    details: { id: "a12bc345", display_name: "review", model_profile: "inherit" },
    text: "Subagent launch failed.",
    context: { isError: true },
  },
  {
    name: "launch errors without details retain their full text",
    text: "Subagent limit 4 reached.",
    context: { isError: true },
  },
  {
    name: "historical launch results without profile metadata retain their warnings",
    details: { id: "a12bc345", display_name: "review" },
    text: "Started review. Model profile high is not configured; using inherit.",
  },
  {
    name: "partial launch results retain their progress text",
    details: { id: "a12bc345", display_name: "review", model_profile: "inherit" },
    text: "Preparing the subagent.",
    options: { isPartial: true },
  },
]) {
  test(scenario.name, async (t) => {
    const extension = await loadExtension(t, async () => fakeChild());
    assert.deepEqual(renderLaunch(
      extension,
      { content: [{ type: "text", text: scenario.text }], details: scenario.details },
      {},
      scenario.options,
      scenario.context,
    ), [scenario.text]);
  });
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

  // Launch no longer forces termination; the parent decides whether to keep working.
  assert.equal(first.terminate, undefined);
  assert.equal(second.terminate, undefined);
  assert.match(first.content[0].text, /wakes you automatically when it completes, fails, or asks a blocking question/i);
  assert.match(first.content[0].text, ISO_TIMESTAMP);
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

test("footer prioritizes waiting children in launch order and restores order after answers", async (t) => {
  const runs = Array.from({ length: 4 }, () => deferred());
  const started = Array.from({ length: 4 }, () => deferred());
  const childOptions = [];
  const extension = await loadExtension(t, async (options) => {
    const index = childOptions.push(options) - 1;
    return fakeChild({
      async prompt() {
        started[index].resolve();
        await runs[index].promise;
      },
    });
  });
  t.after(async () => {
    runs.forEach((run) => run.resolve());
    await extension.emit("session_shutdown");
  });

  const launches = [];
  for (const name of ["first", "second", "third", "fourth"]) {
    launches.push(await extension.execute({ display_name: name, prompt: `Run ${name}.` }));
  }
  await Promise.all(started.map((start) => start.promise));

  const label = (index, waiting = false) => {
    const { display_name, id } = launches[index].details;
    const glyph = waiting ? "<warning>?</warning>" : "<success>*</success>";
    return `${glyph} ${display_name}#${id.slice(0, 8)}`;
  };
  const assertFooter = (...labels) => {
    assert.equal(extension.statuses.at(-1).text, [...labels, "+1"].join(" "));
  };
  assertFooter(label(0), label(1), label(2));

  const fourthQuestion = callTool(childOptions[3].messageParentTool, { kind: "question", message: "Continue fourth?" });
  assertFooter(label(3, true), label(0), label(1));

  // Ask in reverse launch order: waiting children must still retain launch order.
  const thirdQuestion = callTool(childOptions[2].messageParentTool, { kind: "question", message: "Continue third?" });
  assertFooter(label(2, true), label(3, true), label(0));

  await extension.message({ id: launches[2].details.id, message: "Continue third." });
  await thirdQuestion;
  assertFooter(label(3, true), label(0), label(1));

  await extension.message({ id: launches[3].details.id, message: "Continue fourth." });
  await fourthQuestion;
  assertFooter(label(0), label(1), label(2));
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

// Busy-parent progress is recorded immediately without waking or steering the parent.
test("child progress reaches a busy parent immediately without waking either agent", async (t) => {
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
  assert.equal(extension.sent.length, 1);
  assert.deepEqual(extension.sent[0].options, { triggerTurn: false });
  assert.equal(extension.sent[0].message.customType, "subagent-progress");
  assert.equal(extension.sent[0].message.details.id, launch.details.id);
  assert.equal(extension.sent[0].message.details.display_name, "reporter");
  assert.match(extension.sent[0].message.content, new RegExp(launch.details.id));
  assert.match(extension.sent[0].message.content, /reporter/);
  assert.match(extension.sent[0].message.content, /Inspected every caller\./);
  assert.match(extension.sent[0].message.content, ISO_TIMESTAMP);
});

// Idle-parent progress is recorded without starting a parent turn.
test("child progress reaches an idle parent without waking it", async (t) => {
  const run = deferred();
  let creation;
  const extension = await loadExtension(
    t,
    async (options) => {
      creation = options;
      return fakeChild({ async prompt() { await run.promise; } });
    },
  );
  await extension.execute({ display_name: "idle-reporter", prompt: "Report without waking." });
  await waitFor(() => creation !== undefined);

  await callTool(creation.messageParentTool, { kind: "progress", message: "Milestone reached." });

  assert.equal(extension.sent.length, 1);
  assert.equal(extension.sent[0].message.customType, "subagent-progress");
  assert.deepEqual(extension.sent[0].options, { triggerTurn: false });
});

// A blocking question reaches a busy parent immediately and its direct answer resumes the child.
test("blocking question steers a busy parent without waiting for settlement", async (t) => {
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

  assert.equal(extension.sent.length, 1);
  assert.equal(extension.sent[0].message.customType, "subagent-progress");

  let questionSettled = false;
  const question = callTool(creation.messageParentTool, {
    kind: "question",
    message: "Which API should I preserve?",
  }).finally(() => {
    questionSettled = true;
  });

  assert.equal(extension.sent.length, 2);
  assert.equal(questionSettled, false);
  assert.match(extension.statuses.at(-1).text, /^<warning>\?<\/warning> asker#[0-9a-f]{8}$/i);
  assert.deepEqual(
    extension.sent.map(({ message }) => message.customType),
    ["subagent-progress", "subagent-question"],
  );
  const questionNotice = extension.sent[1];
  assert.deepEqual(questionNotice.options, { deliverAs: "steer", triggerTurn: true });
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

// Kill confirms after signaling cancellation, without waiting for abort, shutdown, or disposal.
test("kill confirms while terminal cleanup remains unfinished", async (t) => {
  const promptStarted = deferred();
  const run = deferred();
  const abortStarted = deferred();
  const allowAbort = deferred();
  const shutdownStarted = deferred();
  const allowShutdown = deferred();
  const disposalFinished = deferred();
  let disposed = false;
  let creation;
  let listener;
  const child = fakeChild({
    subscribe(next) {
      listener = next;
      return () => {};
    },
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
    async abort() {
      abortStarted.resolve();
      await allowAbort.promise;
      run.resolve();
    },
    async shutdown() {
      shutdownStarted.resolve();
      await allowShutdown.promise;
    },
    dispose() {
      disposed = true;
      disposalFinished.resolve();
    },
  });
  const extension = await loadExtension(t, async (options) => {
    creation = options;
    return child;
  });
  const launch = await extension.execute({ display_name: "immediate", prompt: "Keep working." });
  await promptStarted.promise;

  let confirmed = false;
  const killing = extension.kill({ id: launch.details.id }).then((result) => {
    confirmed = true;
    return result;
  });
  await abortStarted.promise;
  await Promise.resolve();

  try {
    assert.equal(confirmed, true);
    const killed = await killing;
    assert.match(killed.content[0].text, /^Cooperatively killed immediate \([0-9a-f-]{36}\)\.$/);
    assert.equal(disposed, false);
    await assert.rejects(extension.kill({ id: launch.details.id }), /no active subagent/i);
    await assert.rejects(
      extension.message({ id: launch.details.id, message: "Too late." }),
      /no active subagent/i,
    );
    await assert.rejects(
      callTool(creation.messageParentTool, { kind: "progress", message: "Late progress." }),
      /no longer available/i,
    );
    await assert.rejects(
      callTool(creation.messageParentTool, { kind: "question", message: "Late question?" }),
      /no longer available/i,
    );
    listener({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Late partial result." }] },
    });
    listener({ type: "agent_settled" });
    assert.equal(extension.sent.length, 0);
    assert.deepEqual(
      extension
        .logOf(launch.details.id)
        .map(stripTs)
        .filter((line) => /^\[(?:completed|failed|killed)\]/.test(line)),
      ["[killed]"],
    );
  } finally {
    allowAbort.resolve();
    await shutdownStarted.promise;
    assert.equal(disposed, false);
    allowShutdown.resolve();
    await disposalFinished.promise;
  }
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
  assert.match(killed.content[0].text, /^Cooperatively killed cancelled \([0-9a-f-]{36}\)\.$/);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  assert.equal(extension.sent.length, 1);
  assert.equal(extension.sent[0].message.customType, "subagent-question");
  assert.deepEqual(extension.sent[0].options, { deliverAs: "steer", triggerTurn: true });
  await assert.rejects(extension.kill({ id: launch.details.id }), /no active subagent/i);
  await assert.rejects(extension.message({ id: launch.details.id, message: "Too late." }), /no active subagent/i);
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
  await waitFor(() => lifecycle.includes("dispose"));

  assertCallsInAnyOrder(lifecycle, ["abort", "shutdown", "dispose"]);
  assert.equal(extension.sent.length, 0);
  assert.match(killed.content[0].text, /^Cooperatively killed racer \([0-9a-f-]{36}\)\.$/);
});

// A killed starting child stays owned until its eventual cleanup finishes.
test("parent shutdown joins cleanup for a killed starting child", async (t) => {
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
  assert.match(killed.content[0].text, /^Cooperatively killed starting \([0-9a-f-]{36}\)\.$/);
  assert.deepEqual(lifecycle, []);
  assert.equal(extension.sent.length, 0);

  let shutdownFinished = false;
  const parentShutdown = extension.emit("session_shutdown", { reason: "quit" }).then(() => {
    shutdownFinished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  try {
    assert.equal(shutdownFinished, false);
  } finally {
    startup.resolve(child);
    await parentShutdown;
  }

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
    const args = { display_name: name, prompt: `Run ${name}.`, model_profile: name };
    const launch = await extension.execute(args);
    assert.deepEqual(renderLaunch(extension, launch, args), [
      `Started ${name}#${launch.details.id.slice(0, 8)} in background`,
    ]);
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
    assert.deepEqual(renderLaunch(extension, launch, { model_profile: profile }), [
      `Started fallback#${launch.details.id.slice(0, 8)} in background`,
      `Model profile ${profile} is not configured; using inherit.`,
    ]);
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

// Successful completion queues one focused result and finishes child disposal.
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
  await waitFor(() => lifecycle.length === 2);

  assertCallsInAnyOrder(lifecycle, ["shutdown", "dispose"]);
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-completed");
  assert.equal(message.details.id, launch.details.id);
  assert.equal(message.details.display_name, "finisher");
  assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
  assert.match(message.content, /finisher/);
  assert.match(message.content, new RegExp(launch.details.id));
  assert.match(message.content, /First result block\.\nSecond result block\./);
  assert.match(message.content, ISO_TIMESTAMP);
  // Inlined result excludes hidden reasoning, tool activity, provider metadata, and the restated task.
  assert.doesNotMatch(message.content, /hidden reasoning|toolCall|secret|private-provider|Return the exact finding/);
  assert.deepEqual(extension.statuses.at(-1), { key: "subagents", text: undefined });
  await assert.rejects(
    extension.message({ id: launch.details.id, message: "Too late." }),
    /no active subagent/i,
  );
});

// A natural completion steers a busy parent without waiting for settlement or cleanup.
test("natural completion steers a busy parent without an agent_settled event", async (t) => {
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Focused result." }] }],
  });
  const extension = await loadExtension(t, async () => child, { parentIdle: false });

  const launch = await extension.execute({ display_name: "busy-finisher", prompt: "Finish while busy." });
  await waitFor(() => extension.statuses.at(-1)?.text === undefined);

  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-completed");
  assert.equal(message.details.id, launch.details.id);
  assert.match(message.content, /Focused result\./);
  assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
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
  await waitFor(() => lifecycle.length === 2);

  assertCallsInAnyOrder(lifecycle, ["shutdown", "dispose"]);
  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-failed");
  assert.equal(message.details.id, launch.details.id);
  assert.equal(message.details.display_name, "failing");
  assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
  assert.match(message.content, /provider failed/);
  assert.match(message.content, /Available partial result\./);
  assert.match(message.content, ISO_TIMESTAMP);

  // Failure inlines the error and partial text while excluding transcript and provider metadata.
  assert.doesNotMatch(message.content, /hidden reasoning|toolCall|secret|private-provider|private transcript/);
});

// A natural failure steers a busy parent with its error and visible partial result.
test("natural failure steers a busy parent without an agent_settled event", async (t) => {
  const child = fakeChild({
    messages: [
      {
        role: "assistant",
        stopReason: "error",
        errorMessage: "provider failed while busy",
        content: [{ type: "text", text: "Visible partial result." }],
      },
    ],
  });
  const extension = await loadExtension(t, async () => child, { parentIdle: false });

  const launch = await extension.execute({ display_name: "busy-failure", prompt: "Fail while busy." });
  await waitFor(() => extension.statuses.at(-1)?.text === undefined);

  assert.equal(extension.sent.length, 1);
  const [{ message, options }] = extension.sent;
  assert.equal(message.customType, "subagent-failed");
  assert.equal(message.details.id, launch.details.id);
  assert.match(message.content, /provider failed while busy/);
  assert.match(message.content, /Visible partial result\./);
  assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });
});

// A prompt failure preserves notification-before-cleanup ordering outside explicit kill.
test("prompt failure notifies before cooperative abort", async (t) => {
  const allowAbort = deferred();
  const disposalFinished = deferred();
  const timeline = [];
  const child = fakeChild({
    async prompt() {
      throw new Error("prompt failed");
    },
    async abort() {
      timeline.push("abort");
      await allowAbort.promise;
    },
    dispose() {
      disposalFinished.resolve();
    },
  });
  const extension = await loadExtension(t, async () => child, {
    onSend() {
      timeline.push("notify");
    },
  });

  await extension.execute({ display_name: "prompt-failure", prompt: "Fail naturally." });
  await waitFor(() => timeline.length === 2);

  try {
    assert.deepEqual(timeline, ["notify", "abort"]);
  } finally {
    allowAbort.resolve();
    await disposalFinished.promise;
  }
});

// Terminal finalization notifies immediately, releases its slot, and continues cleanup once.
test("completion notifies and releases its slot before disposal finishes", async (t) => {
  const shutdownStarted = deferred();
  const allowShutdown = deferred();
  const disposalFinished = deferred();
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
    dispose() {
      disposalFinished.resolve();
    },
  });
  const replacementStartup = deferred();
  let creations = 0;
  const extension = await loadExtension(t, async () => (creations++ === 0 ? child : replacementStartup.promise));
  await writeFile(join(extension.agentDir, "subagents.json"), JSON.stringify({ maxConcurrent: 1 }));
  const launch = await extension.execute({ display_name: "finalizer", prompt: "Finish." });
  await shutdownStarted.promise;
  assert.equal(extension.sent.length, 1);
  assert.equal(extension.sent[0].message.customType, "subagent-completed");
  assert.deepEqual(extension.sent[0].options, { deliverAs: "steer", triggerTurn: true });

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
  await disposalFinished.promise;
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

  assert.match(extension.sent[0].message.content, /Event won\./);
});

// A child-session construction error remains a visible natural failure.
test("child construction failure notifies the parent", async (t) => {
  const extension = await loadExtension(t, async () => {
    throw new Error("construction failed");
  });

  const launch = await extension.execute({ display_name: "unbuilt", prompt: "Try to start." });
  await waitFor(() => extension.sent.length === 1);

  assert.equal(extension.sent[0].message.customType, "subagent-failed");
  assert.match(extension.sent[0].message.content, /construction failed/);
  assert.match(extension.sent[0].message.content, new RegExp(launch.details.id));
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
  assert.deepEqual(extension.sent[0].options, { deliverAs: "steer", triggerTurn: true });
  assert.match(extension.sent[0].message.content, /_No final textual result\._/);
});

// Parent lifecycle cleanup preserves delivered notices, closes future delivery, and cleans every child.
test("session shutdown suppresses only late child notifications", async (t) => {
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
    messages: [{ role: "assistant", content: [{ type: "text", text: "Published before cleanup." }] }],
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
  assert.deepEqual(
    extension.sent.map(({ message }) => message.customType),
    ["subagent-progress", "subagent-question", "subagent-completed"],
  );

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
  assert.deepEqual(
    extension.sent.map(({ message }) => message.customType),
    ["subagent-progress", "subagent-question", "subagent-completed"],
  );
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
  assert.deepEqual(
    extension.sent.map(({ message }) => message.customType),
    ["subagent-question"],
  );
  await assert.rejects(
    callTool(creations[0].messageParentTool, { kind: "progress", message: "Late old-branch progress." }),
    /no longer available/i,
  );

  await extension.emit("session_tree", { newLeafId: "new", oldLeafId: "old" });
  assert.equal(extension.sent.length, 2);
  const { message, options } = extension.sent[1];
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
});

// The log is written outside the TUI and captures assistant text and tool activity, never thinking.
test("the log records tool activity and assistant text in a non-TUI mode", async (t) => {
  let listener;
  const run = deferred();
  const child = fakeChild({
    subscribe(next) {
      listener = next;
      return () => {};
    },
    async prompt() {
      listener({ type: "tool_execution_start", toolName: "read" });
      listener({ type: "tool_execution_end", toolName: "read", isError: false });
      listener({ type: "tool_execution_end", toolName: "write", isError: true });
      listener({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden reasoning" },
            { type: "text", text: "Found the caller." },
          ],
        },
      });
      await run.promise;
    },
  });
  const extension = await loadExtension(t, async () => child, { mode: "print" });
  const launch = await extension.execute({ display_name: "logger", prompt: "Trace it." });
  await waitFor(() => extension.logOf(launch.details.id).length >= 4);

  const lines = extension.logOf(launch.details.id);
  assert.deepEqual(lines.map(stripTs), [
    "[tool] read",
    "[tool ok] read",
    "[tool err] write",
    "Found the caller.",
  ]);
  assert.ok(lines.every((line) => /^\d{2}:\d{2}:\d{2} /.test(line)));
  assert.ok(lines.every((line) => !/hidden reasoning/.test(line)));
  run.resolve();
});

// Every parent-child exchange is recorded: progress, the question, the wait, and the answer.
test("the log records the full parent exchange", async (t) => {
  const promptStarted = deferred();
  const run = deferred();
  let creation;
  const child = fakeChild({
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
  });
  const extension = await loadExtension(
    t,
    async (options) => {
      creation = options;
      return child;
    },
    { parentIdle: false },
  );
  const launch = await extension.execute({ display_name: "asker", prompt: "Ask when unsure." });
  await promptStarted.promise;

  await callTool(creation.messageParentTool, { kind: "progress", message: "Halfway." });
  const question = callTool(creation.messageParentTool, { kind: "question", message: "Which API?" });
  await extension.message({ id: launch.details.id, message: "The public one." });
  await question;

  assert.deepEqual(extension.logOf(launch.details.id).map(stripTs), [
    "[progress] Halfway.",
    "[question] Which API?",
    "[waiting for parent]",
    "[answer] The public one.",
  ]);
  run.resolve();
});

// Natural completion records a completed outcome marker.
test("the log records a completed outcome", async (t) => {
  const child = fakeChild({
    messages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }],
  });
  const extension = await loadExtension(t, async () => child);

  const launch = await extension.execute({ display_name: "finisher", prompt: "Finish." });
  await waitFor(() => extension.sent.length === 1);

  assert.ok(extension.logOf(launch.details.id).map(stripTs).includes("[completed]"));
});

// An explicit kill records a killed outcome marker through the kill finalization path.
test("the log records a killed outcome", async (t) => {
  const run = deferred();
  const promptStarted = deferred();
  const child = fakeChild({
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
    async abort() {
      run.resolve();
    },
  });
  const extension = await loadExtension(t, async () => child);

  const launch = await extension.execute({ display_name: "victim", prompt: "Run until stopped." });
  await promptStarted.promise;
  await extension.kill({ id: launch.details.id });

  assert.ok(extension.logOf(launch.details.id).map(stripTs).includes("[killed]"));
});

// The per-parent-process log directory is removed on the shutdown and tree-navigation cleanup paths.
test("the log directory is cleaned on shutdown and on tree navigation", async (t) => {
  const shutdown = await loadExtension(t, async () => fakeChild());
  await shutdown.emit("session_shutdown", { reason: "quit" });
  assert.equal(shutdown.getLogCleanups(), 1);

  const tree = await loadExtension(t, async () => fakeChild());
  await tree.emit("session_before_tree", {
    preparation: { targetId: "target", oldLeafId: "old" },
    signal: new AbortController().signal,
  });
  assert.equal(tree.getLogCleanups(), 1);
});


// A fake display backend spies on show(view) and simulates availability and spawn failure.
function fakeDisplay({ available = true, fail = false } = {}) {
  const shown = [];
  return {
    shown,
    display: {
      id: "fake",
      isAvailable: () => available,
      async show(view) {
        shown.push(view);
        if (fail) throw new Error("show failed");
      },
    },
  };
}

// Launch one child and wait until it is running so /subagents lists it as active.
async function launchRunning(t, overrides, name = "research") {
  const promptStarted = deferred();
  const run = deferred();
  const child = fakeChild({
    async prompt() {
      promptStarted.resolve();
      await run.promise;
    },
  });
  const extension = await loadExtension(t, async () => child, overrides);
  const launch = await extension.execute({ display_name: name, prompt: "Inspect the API." });
  await promptStarted.promise;
  t.after(() => run.resolve());
  return { extension, launch };
}

// Outside interactive mode the command explains the requirement and opens nothing.
test("/subagents requires interactive mode", async (t) => {
  const { display, shown } = fakeDisplay();
  const { extension } = await launchRunning(t, { mode: "print", displays: [display] });

  await extension.runSubagents();

  assert.equal(extension.selectCalls.length, 0);
  assert.equal(shown.length, 0);
  assert.ok(
    extension.warnings.some(
      ({ message, type }) => /requires interactive mode/i.test(message) && type === "warning",
    ),
  );
});

// With no active subagents the command explains the empty state instead of showing a picker.
test("/subagents notifies when there are no active subagents", async (t) => {
  const { display, shown } = fakeDisplay();
  const extension = await loadExtension(t, async () => fakeChild(), { displays: [display] });

  await extension.runSubagents();

  assert.equal(extension.selectCalls.length, 0);
  assert.equal(shown.length, 0);
  assert.ok(extension.warnings.some(({ message }) => /no active subagents/i.test(message)));
});

// The picker lists each active subagent by display name, short UUID prefix, and phase.
test("/subagents shows a picker of the active subagents", async (t) => {
  const { display } = fakeDisplay();
  const { extension, launch } = await launchRunning(t, { displays: [display] });

  await extension.runSubagents();

  assert.equal(extension.selectCalls.length, 1);
  assert.deepEqual(extension.selectCalls[0].options, [
    `research#${launch.details.id.slice(0, 8)} (running)`,
  ]);
});

// Selecting a subagent with an available backend opens its live output via show(view).
test("/subagents opens the selected subagent in the available backend", async (t) => {
  const { display, shown } = fakeDisplay();
  const { extension, launch } = await launchRunning(t, {
    displays: [display],
    selectChoice: (options) => options[0],
  });

  await extension.runSubagents();

  // The view carries only the read-only identity, title, and log path — no control handles.
  assert.deepEqual(shown, [
    {
      subagentId: launch.details.id,
      title: `research#${launch.details.id.slice(0, 8)}`,
      logPath: `/fake/${launch.details.id}.log`,
    },
  ]);
  assert.equal(extension.sent.length, 0);
});

// Esc (an undefined selection) backs out without opening a viewer or notifying.
test("/subagents cancels cleanly when the picker is dismissed", async (t) => {
  const { display, shown } = fakeDisplay();
  const { extension } = await launchRunning(t, { displays: [display] });

  await extension.runSubagents();

  assert.equal(extension.selectCalls.length, 1);
  assert.equal(shown.length, 0);
  assert.equal(extension.warnings.length, 0);
});

// With no available backend the picker still shows, then surfaces the manual tail plus a nudge.
test("/subagents surfaces the manual tail command when no backend is available", async (t) => {
  const { extension, launch } = await launchRunning(t, {
    displays: [fakeDisplay({ available: false }).display],
    selectChoice: (options) => options[0],
  });

  await extension.runSubagents();

  assert.equal(extension.selectCalls.length, 1);
  assert.equal(extension.sent.length, 0);
  const notice = extension.warnings.at(-1);
  assert.match(notice.message, new RegExp(`tail -n \\+1 -F "/fake/${launch.details.id}.log"`));
  assert.match(notice.message, /multiplexer/i);
});

// If the available backend fails to open, the command falls back to the same manual tail.
test("/subagents falls back to the manual tail when show() fails", async (t) => {
  const { display } = fakeDisplay({ fail: true });
  const { extension, launch } = await launchRunning(t, {
    displays: [display],
    selectChoice: (options) => options[0],
  });

  await extension.runSubagents();

  assert.equal(extension.sent.length, 0);
  const notice = extension.warnings.at(-1);
  assert.match(notice.message, new RegExp(`tail -n \\+1 -F "/fake/${launch.details.id}.log"`));
  assert.doesNotMatch(notice.message, /multiplexer/i);
});
