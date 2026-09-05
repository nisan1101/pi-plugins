import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { renderSubagentMessage } from "../extensions/subagent-rendering.ts";

initTheme("dark");
const theme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
};
const id = "a12bc345-6789-4123-8123-123456789abc";
const at = "2026-09-04T12:34:56.000Z";

function message(customType, body) {
  return {
    customType,
    content: `Original message with ${id} and ${at}.\n\n${body}`,
    details: { id, display_name: "renderer-review", body, at },
  };
}

function render(value, { expanded = false, width = 100, outputPad = 1 } = {}) {
  const component = renderSubagentMessage(value, { expanded, outputPad }, theme);
  const lines = component.render(width);
  assert.ok(lines.every((line) => visibleWidth(line) <= width));
  return lines.map((line) => stripVTControlCharacters(line).trimEnd()).join("\n");
}

for (const [customType, title] of [
  ["subagent-progress", "· renderer-review#a12bc345 · progress"],
  ["subagent-question", "? renderer-review#a12bc345 · needs an answer"],
  ["subagent-completed", "✓ renderer-review#a12bc345 · completed"],
  ["subagent-failed", "✗ renderer-review#a12bc345 · failed"],
]) {
  test(`${customType} shows a readable status and short handle without changing the message`, () => {
    const value = message(customType, "**Important** finding.");
    const original = structuredClone(value);
    const output = render(value);
    assert.ok(output.includes(title));
    assert.ok(output.includes("Important finding."));
    assert.ok(!output.includes("**Important**"));
    assert.ok(!output.includes(id));
    assert.ok(!output.includes(at));
    assert.deepEqual(value, original);
  });
}

test("long completion reports show a bounded preview and expand to full Markdown and metadata", () => {
  const body = Array.from({ length: 20 }, (_, i) => `- Finding ${i + 1}`).join("\n");
  const value = message("subagent-completed", body);
  const collapsed = render(value);
  assert.ok(collapsed.includes("Finding 1"));
  assert.ok(!collapsed.includes("Finding 20"));
  assert.match(collapsed, /more lines .*to expand/);

  const expanded = render(value, { expanded: true });
  assert.ok(expanded.includes("Finding 20"));
  assert.ok(expanded.includes(id));
  assert.ok(expanded.includes(at));
  assert.ok(!expanded.includes("more lines"));
});

test("completion previews bound wrapped paragraphs and respect narrow widths and output padding", () => {
  const value = message("subagent-completed", "Long paragraph. ".repeat(80));
  for (const width of [24, 40, 80]) {
    const output = render(value, { width, outputPad: 2 });
    assert.ok(output.includes("more lines"));
    assert.ok(output.split("\n").filter((line) => line.includes("Long paragraph")).length <= 8);
  }
});

for (const customType of ["subagent-question", "subagent-failed", "subagent-progress"]) {
  test(`${customType} keeps its full body visible when collapsed`, () => {
    const body = Array.from({ length: 20 }, (_, i) => `- Detail ${i + 1}`).join("\n");
    const output = render(message(customType, body));
    assert.ok(output.includes("Detail 20"));
    assert.ok(!output.includes("more lines"));
  });
}

test("questions without a timestamp expand without inventing one", () => {
  const value = message("subagent-question", "Continue?");
  delete value.details.at;
  const output = render(value, { expanded: true });
  assert.ok(output.includes(id));
  assert.ok(!output.includes("Time:"));
});

test("historical messages without body metadata use Pi's full-content fallback", () => {
  for (const details of [undefined, { id, display_name: "old-child" }]) {
    const value = { customType: "subagent-failed", content: "Keep the original error.", details };
    assert.equal(renderSubagentMessage(value, { expanded: false, outputPad: 1 }, theme), undefined);
  }
});
