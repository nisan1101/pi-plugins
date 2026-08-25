import assert from "node:assert/strict";
import test from "node:test";

import {
  createZellijDisplay,
  defaultDisplays,
  tailCommand,
  zellijArgv,
} from "../extensions/subagent-display.ts";

const view = { subagentId: "id-1", title: "research#1234abcd", logPath: "/tmp/pi/id-1.log" };

// The floating-pane argv follows the log from its first line and needs no spawned zellij.
test("zellij argv opens a named floating pane that follow-tails the log from the start", () => {
  assert.deepEqual(zellijArgv(view), [
    "run",
    "--floating",
    "--name",
    "research#1234abcd",
    "--",
    "tail",
    "-n",
    "+1",
    "-F",
    "/tmp/pi/id-1.log",
  ]);
});

// Availability requires both the zellij session env var and the binary on PATH.
test("zellij is available only inside a zellij session with the binary present", () => {
  const inside = { ZELLIJ: "0" };
  assert.equal(createZellijDisplay({ env: inside, hasBinary: () => true }).isAvailable(), true);
  assert.equal(createZellijDisplay({ env: inside, hasBinary: () => false }).isAvailable(), false);
  assert.equal(createZellijDisplay({ env: {}, hasBinary: () => true }).isAvailable(), false);
});

// show() delegates to the injected spawner with the pure argv and never shells out in tests.
test("show spawns the floating pane with the constructed argv", async () => {
  const calls = [];
  const display = createZellijDisplay({
    env: { ZELLIJ: "0" },
    hasBinary: () => true,
    spawnPane: (argv) => {
      calls.push(argv);
      return Promise.resolve();
    },
  });
  await display.show(view);
  assert.deepEqual(calls, [zellijArgv(view)]);
});

// A spawn failure surfaces to the caller so the command can fall back to a manual tail.
test("show rejects when the spawner fails", async () => {
  const display = createZellijDisplay({
    env: { ZELLIJ: "0" },
    hasBinary: () => true,
    spawnPane: () => Promise.reject(new Error("boom")),
  });
  await assert.rejects(display.show(view), /boom/);
});

// The manual watch command tails from the first line and follows the file by name.
test("tail command follows the log from its first line", () => {
  assert.equal(tailCommand("/tmp/pi/id-1.log"), 'tail -n +1 -F "/tmp/pi/id-1.log"');
});

// The default backend list leads with zellij so detection is automatic.
test("the default display list ships the zellij backend", () => {
  assert.deepEqual(defaultDisplays.map((display) => display.id), ["zellij"]);
});
