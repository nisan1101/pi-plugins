import assert from "node:assert/strict";
import test from "node:test";

import scheduledWake from "../extensions/scheduled-wake.ts";

function loadExtension() {
  let tool;
  let shutdown;
  const sent = [];

  scheduledWake({
    registerTool(definition) {
      tool = definition;
    },
    on(event, handler) {
      if (event === "session_shutdown") shutdown = handler;
    },
    sendMessage(message, options) {
      sent.push({ message, options });
    },
  });

  assert.ok(tool);
  assert.ok(shutdown);
  return { tool, shutdown, sent };
}

// A scheduled wake ends the run, waits for its delay, then triggers a follow-up turn.
test("scheduled wake releases the agent and later triggers it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();
  const reason = "  Check zmx job build; reschedule if it is still running.  ";

  const result = await tool.execute("call-1", { afterSeconds: 1, reason });

  assert.equal(result.terminate, true);
  assert.equal(sent.length, 0);

  t.mock.timers.tick(999);
  assert.equal(sent.length, 0);

  t.mock.timers.tick(1);
  assert.deepEqual(sent, [
    {
      message: {
        customType: "scheduled-wake",
        content: `Scheduled wake fired.\n\n${reason}`,
        display: true,
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
test("scheduled wake rejects unusable requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();

  for (const afterSeconds of [0, -1, Number.MIN_VALUE, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000]) {
    await assert.rejects(
      tool.execute("invalid-delay", { afterSeconds, reason: "Check the job." }),
      /afterSeconds/,
    );
  }
  await assert.rejects(
    tool.execute("invalid-reason", { afterSeconds: 1, reason: "   " }),
    /reason/,
  );

  t.mock.timers.tick(10_000);
  assert.equal(sent.length, 0);
});

// The full runtime-supported timeout range remains available.
test("scheduled wake accepts the maximum supported delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, shutdown } = loadExtension();

  const result = await tool.execute("max-delay", {
    afterSeconds: 2_147_483.647,
    reason: "Check the target.",
  });

  assert.equal(result.terminate, true);
  await shutdown();
});

// Session shutdown cancels every pending wake and remains safe when repeated.
test("session shutdown leaves no scheduled wake behind", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, shutdown, sent } = loadExtension();

  await tool.execute("call-1", { afterSeconds: 1, reason: "Check job one." });
  await tool.execute("call-2", { afterSeconds: 2, reason: "Check job two." });
  await shutdown();
  await shutdown();
  t.mock.timers.tick(2_000);

  assert.equal(sent.length, 0);
});

// Separate scheduling calls keep independent deadlines and reasons.
test("multiple scheduled wakes fire independently", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { tool, sent } = loadExtension();

  await tool.execute("call-1", { afterSeconds: 2, reason: "Check job two." });
  await tool.execute("call-2", { afterSeconds: 1, reason: "Check job one." });

  t.mock.timers.tick(1_000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message.content, /job one/);

  t.mock.timers.tick(1_000);
  assert.equal(sent.length, 2);
  assert.match(sent[1].message.content, /job two/);
});

// Tool guidance covers managed local jobs and remote waits without crowding the prompt.
test("schedule wake teaches the agent when and how to use it", () => {
  const { tool } = loadExtension();
  const guidance = tool.promptGuidelines.join("\n");

  assert.ok(tool.promptGuidelines.length <= 3);
  assert.match(guidance, /between checks.*local jobs.*remote state/i);
  assert.match(guidance, /zmx.*when available.*another process manager/i);
  assert.match(guidance, /session or job name.*reason/i);
  assert.match(guidance, /avoid.*raw.*&.*nohup/i);
  assert.match(guidance, /reason must name the target.*status check.*pending or completed/i);
  assert.match(guidance, /wake.*only a check.*reschedule/i);
  assert.match(guidance, /by itself.*other tool calls finish.*every tool result.*batch.*terminating/i);
});
