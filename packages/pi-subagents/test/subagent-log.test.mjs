import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { createFileLogBridge, formatSubagentLog } from "../extensions/subagent-log.ts";

// Local-component Date renders deterministic HH:MM:SS regardless of the test runner's timezone.
const at = new Date(2024, 0, 1, 9, 8, 7);
const format = (event) => formatSubagentLog(event, at);

// Every emitted line carries the short local wall-clock prefix.
test("each log line is prefixed with an HH:MM:SS timestamp", () => {
  assert.deepEqual(format({ kind: "outcome", status: "completed" }), ["09:08:07 [completed]"]);
});

// Assistant text is logged on message completion, one physical line per text line.
test("assistant text is split into one prefixed line per line", () => {
  const content = [{ type: "text", text: "First block.\nSecond block." }];
  assert.deepEqual(format({ kind: "assistant", content }), [
    "09:08:07 First block.",
    "09:08:07 Second block.",
  ]);
});

// Thinking never reaches the log; a message with only thinking produces nothing.
test("thinking blocks are excluded from the log", () => {
  const mixed = [
    { type: "thinking", thinking: "hidden reasoning" },
    { type: "text", text: "Visible output." },
    { type: "toolCall", name: "read", arguments: { path: "x" } },
  ];
  assert.deepEqual(format({ kind: "assistant", content: mixed }), ["09:08:07 Visible output."]);
  assert.deepEqual(format({ kind: "assistant", content: [{ type: "thinking", thinking: "only" }] }), []);
});

// Tool activity is logged at start (name only) and end (name plus success/failure).
test("tool activity logs name on start and success or failure on end", () => {
  assert.deepEqual(format({ kind: "tool-start", tool: "read" }), ["09:08:07 [tool] read"]);
  assert.deepEqual(format({ kind: "tool-end", tool: "read", ok: true }), ["09:08:07 [tool ok] read"]);
  assert.deepEqual(format({ kind: "tool-end", tool: "write", ok: false }), ["09:08:07 [tool err] write"]);
});

// Parent-exchange lifecycle markers are logged with their message text.
test("lifecycle markers record waiting, progress, question, and answer", () => {
  assert.deepEqual(format({ kind: "waiting" }), ["09:08:07 [waiting for parent]"]);
  assert.deepEqual(format({ kind: "progress", message: "Halfway." }), ["09:08:07 [progress] Halfway."]);
  assert.deepEqual(format({ kind: "question", message: "Which API?" }), ["09:08:07 [question] Which API?"]);
  assert.deepEqual(format({ kind: "answer", message: "The public one." }), ["09:08:07 [answer] The public one."]);
});

// Terminal outcomes distinguish completed, failed (with error), and killed.
test("terminal outcomes record completed, failed with error, and killed", () => {
  assert.deepEqual(format({ kind: "outcome", status: "completed" }), ["09:08:07 [completed]"]);
  assert.deepEqual(format({ kind: "outcome", status: "failed", error: "boom" }), ["09:08:07 [failed] boom"]);
  assert.deepEqual(format({ kind: "outcome", status: "killed" }), ["09:08:07 [killed]"]);
});

// The default file sink appends across re-opens (attach never truncates) and cleanup removes the directory.
test("the file sink appends without truncating on re-open and cleanup removes the directory", () => {
  const bridge = createFileLogBridge();
  const id = randomUUID();
  const first = bridge.open(id);
  first.append("11:11:11 [tool] read");
  const reattached = bridge.open(id);
  reattached.append("11:11:12 [tool ok] read");

  assert.deepEqual(readFileSync(first.path, "utf8").split("\n").filter(Boolean), [
    "11:11:11 [tool] read",
    "11:11:12 [tool ok] read",
  ]);

  bridge.cleanup();
  assert.equal(existsSync(first.path), false);
});

