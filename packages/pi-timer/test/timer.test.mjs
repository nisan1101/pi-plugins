import assert from "node:assert/strict";
import test from "node:test";

import timer from "../extensions/timer.ts";

function createSessionManager() {
  const entries = new Map();
  let leafId;

  return {
    append(entry) {
      const id = `entry-${entries.size + 1}`;
      const fullEntry = { ...entry, id, parentId: leafId ?? null };
      entries.set(id, fullEntry);
      leafId = id;
      return fullEntry;
    },
    getLeafEntry() {
      return leafId ? entries.get(leafId) : undefined;
    },
    getEntry(id) {
      return entries.get(id);
    },
    getEntries() {
      return [...entries.values()];
    },
    setLeaf(id) {
      leafId = id;
    },
  };
}

function loadExtension(sessionManager = createSessionManager()) {
  let tool;
  const handlers = {};
  const sent = [];

  timer({
    registerTool(definition) {
      tool = definition;
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    appendEntry(customType, data) {
      sessionManager.append({ type: "custom", customType, data });
    },
    sendMessage(message, options) {
      sent.push({ message, options });
      if (options?.triggerTurn === false) {
        sessionManager.append({ type: "custom_message", ...message });
      }
    },
  });

  assert.ok(tool);
  assert.ok(handlers.session_shutdown);

  const deliver = async (messageIndex = sent.length - 1) => {
    const { message } = sent[messageIndex];
    assert.ok(handlers.message_end);
    await handlers.message_end(
      { type: "message_end", message: { role: "custom", timestamp: 0, ...message } },
      { sessionManager },
    );
    sessionManager.append({ type: "custom_message", ...message });
  };

  return {
    tool,
    shutdown: handlers.session_shutdown,
    sessionStart: handlers.session_start,
    sent,
    sessionManager,
    deliver,
  };
}

test("scheduling persists the timer for recovery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, shutdown, sessionManager } = loadExtension();
  const reason = "  Check zmx job build; reschedule if it is still running.  ";
  const before = Date.now();

  await tool.execute("call-1", { seconds: 1, reason });

  const [checkpoint] = sessionManager.getEntries();
  assert.equal(checkpoint.type, "custom");
  assert.equal(checkpoint.customType, "timer-state");
  assert.equal(checkpoint.data.pending.length, 1);
  assert.equal(checkpoint.data.pending[0].timerId, "call-1");
  assert.equal(checkpoint.data.pending[0].reason, reason);
  assert.ok(checkpoint.data.pending[0].dueAt >= before + 1_000);
  assert.ok(checkpoint.data.pending[0].dueAt <= Date.now() + 1_000);

  await shutdown();
});

test("a fired timer remains recoverable until its message is delivered", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent, sessionManager, deliver } = loadExtension();

  await tool.execute("call-1", { seconds: 1, reason: "Check the build." });
  t.mock.timers.tick(1_000);

  assert.equal(sent.length, 1);
  assert.deepEqual(sessionManager.getEntries().at(-1).data.pending.map(({ timerId }) => timerId), ["call-1"]);

  await deliver();

  const checkpoints = sessionManager
    .getEntries()
    .filter((entry) => entry.type === "custom" && entry.customType === "timer-state");
  assert.deepEqual(checkpoints.at(-1).data.pending, []);

  const resumed = loadExtension(sessionManager);
  await resumed.sessionStart({ type: "session_start", reason: "resume" }, { sessionManager });
  assert.equal(resumed.sent.length, 0);
});

test("resuming reports every interrupted timer without starting a turn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sessionManager = createSessionManager();
  const active = loadExtension(sessionManager);
  await active.tool.execute("call-1", { seconds: 1, reason: "Check build one." });
  await active.tool.execute("call-2", { seconds: 2, reason: "Check build two." });
  await active.shutdown();

  const resumed = loadExtension(sessionManager);
  assert.ok(resumed.sessionStart);
  await resumed.sessionStart({ type: "session_start", reason: "resume" }, { sessionManager });

  assert.equal(resumed.sent.length, 1);
  const [{ message, options }] = resumed.sent;
  assert.equal(message.customType, "timer-cancelled");
  assert.equal(message.display, true);
  assert.match(message.content, /timers.*interrupted/i);
  assert.match(message.content, /timers will not be restored.*underlying local jobs or remote targets were not/i);
  assert.match(message.content, /Check build one\..*scheduled for/s);
  assert.match(message.content, /Check build two\..*scheduled for/s);
  assert.deepEqual(message.details, { cancelledTimerIds: ["call-1", "call-2"], pending: [] });
  assert.deepEqual(options, { triggerTurn: false });

  await resumed.sessionStart({ type: "session_start", reason: "resume" }, { sessionManager });
  assert.equal(resumed.sent.length, 1);
});

test("recovery skips malformed state and stays on the active branch", async () => {
  const sessionManager = createSessionManager();
  const base = sessionManager.append({
    type: "custom",
    customType: "timer-state",
    data: { pending: [{ timerId: "call-a", reason: "Check A.", dueAt: 1_700_000_000_000 }] },
  });
  const malformed = sessionManager.append({
    type: "custom",
    customType: "timer-state",
    data: { pending: [{ timerId: "bad", reason: "Bad date.", dueAt: Number.MAX_VALUE }] },
  });
  sessionManager.setLeaf(base.id);
  sessionManager.append({
    type: "custom",
    customType: "timer-state",
    data: { pending: [{ timerId: "call-b", reason: "Check B.", dueAt: 1_700_000_000_000 }] },
  });
  sessionManager.setLeaf(malformed.id);

  const resumed = loadExtension(sessionManager);
  await resumed.sessionStart({ type: "session_start", reason: "resume" }, { sessionManager });

  assert.deepEqual(resumed.sent[0].message.details.cancelledTimerIds, ["call-a"]);
});

// A timer ends the run, waits for its delay, then triggers a follow-up turn.
test("timer releases the agent and later triggers it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();
  const reason = "  Check zmx job build; reschedule if it is still running.  ";

  const result = await tool.execute("call-1", { seconds: 1, reason });

  assert.equal(result.terminate, true);
  assert.equal(result.content[0].text, "Set a timer for 1 seconds.");
  assert.deepEqual(result.details, { seconds: 1, reason });
  assert.equal(sent.length, 0);

  t.mock.timers.tick(999);
  assert.equal(sent.length, 0);

  t.mock.timers.tick(1);
  assert.deepEqual(sent, [
    {
      message: {
        customType: "timer",
        content: `Timer fired.\n\n${reason}`,
        display: true,
        details: { timerId: "call-1" },
      },
      options: {
        triggerTurn: true,
        deliverAs: "followUp",
      },
    },
  ]);

  t.mock.timers.tick(10_000);
  assert.equal(sent.length, 1);
});

// Invalid requests fail without leaving a timer behind.
test("timer rejects unusable requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();

  for (const seconds of [0, -1, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000]) {
    await assert.rejects(
      tool.execute("invalid-delay", { seconds, reason: "Check the job." }),
      /seconds/,
    );
  }
  await assert.rejects(
    tool.execute("invalid-reason", { seconds: 1, reason: "   " }),
    /reason/,
  );

  t.mock.timers.tick(10_000);
  assert.equal(sent.length, 0);
});

// The full runtime-supported timeout range remains available.
test("timer accepts the maximum supported delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, shutdown } = loadExtension();

  const result = await tool.execute("max-delay", {
    seconds: 2_147_483.647,
    reason: "Check the target.",
  });

  assert.equal(result.terminate, true);
  await shutdown();
});

// Session shutdown cancels every pending timer and remains safe when repeated.
test("session shutdown leaves no timer behind", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, shutdown, sent } = loadExtension();

  await tool.execute("call-1", { seconds: 1, reason: "Check job one." });
  await tool.execute("call-2", { seconds: 2, reason: "Check job two." });
  await shutdown();
  await shutdown();
  t.mock.timers.tick(2_000);

  assert.equal(sent.length, 0);
});

// Separate scheduling calls keep independent deadlines and reasons.
test("multiple timers fire independently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();

  await tool.execute("call-1", { seconds: 2, reason: "Check job two." });
  await tool.execute("call-2", { seconds: 1, reason: "Check job one." });

  t.mock.timers.tick(1_000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.content, /job one/);

  t.mock.timers.tick(1_000);
  assert.equal(sent.length, 2);
  assert.match(sent[1].message.content, /job two/);
});

// Tool guidance covers managed local jobs and remote waits without crowding the prompt.
test("set timer teaches the agent when and how to use it", () => {
  const { tool } = loadExtension();
  const guidance = tool.promptGuidelines.join("\n");
  const promptText = [tool.description, tool.promptSnippet, guidance].join("\n");

  assert.equal(tool.name, "set_timer");
  assert.equal(tool.label, "Set Timer");
  assert.deepEqual(Object.keys(tool.parameters.properties), ["seconds", "reason"]);
  assert.equal(tool.parameters.properties.seconds.exclusiveMinimum, 0);
  assert.equal(tool.parameters.properties.seconds.maximum, 2_147_483.647);
  assert.equal(tool.parameters.properties.reason.minLength, 1);
  assert.match(tool.description, /ends the current run.*later turn wakes/is);
  assert.match(tool.promptSnippet, /ends the current run.*later turn wakes/is);
  assert.match(guidance, /ends the current run.*later turn wakes/is);
  assert.doesNotMatch(promptText, /\b(?:list|cancel)(?:s|led|ling)?\b/i);

  assert.ok(tool.promptGuidelines.length <= 3);
  assert.match(guidance, /between checks.*local jobs.*remote state/i);
  assert.match(guidance, /zmx.*when available.*another process manager/i);
  assert.match(guidance, /session or job name.*reason/i);
  assert.match(guidance, /avoid.*raw.*&.*nohup/i);
  assert.match(guidance, /reason must name the target.*status check.*pending or completed/i);
  assert.match(guidance, /timer.*only a check.*reschedule only while pending/i);
  assert.match(guidance, /by itself.*other tool calls finish.*every tool result.*batch.*terminating/i);
});
