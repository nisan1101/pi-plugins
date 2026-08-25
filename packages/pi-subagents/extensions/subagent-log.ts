import { appendFileSync, closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One subagent's private append-only log. */
export interface SubagentLog {
  readonly path: string;
  append(line: string): void;
}

/** Owns the per-parent-process log directory and mints one log per subagent. */
export interface SubagentLogBridge {
  open(subagentId: string): SubagentLog;
  cleanup(): void;
}

/** The subagent activity worth logging, normalized from its in-process event stream. */
export type SubagentLogEvent =
  | { kind: "assistant"; content: unknown }
  | { kind: "tool-start"; tool: string }
  | { kind: "tool-end"; tool: string; ok: boolean }
  | { kind: "waiting" }
  | { kind: "progress"; message: string }
  | { kind: "question"; message: string }
  | { kind: "answer"; message: string }
  | { kind: "outcome"; status: "completed" | "failed" | "killed"; error?: string };

function assistantLines(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const text = content
    .filter(
      (block): block is { type: "text"; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * Pure formatter: map one subagent log event to zero or more plain-text log lines,
 * each prefixed with a short local wall-clock timestamp. Thinking is never emitted.
 */
export function formatSubagentLog(event: SubagentLogEvent, at: Date): string[] {
  const ts = at.toTimeString().slice(0, 8);
  const line = (body: string) => `${ts} ${body}`;
  switch (event.kind) {
    case "assistant":
      return assistantLines(event.content).map(line);
    case "tool-start":
      return [line(`[tool] ${event.tool}`)];
    case "tool-end":
      return [line(`[tool ${event.ok ? "ok" : "err"}] ${event.tool}`)];
    case "waiting":
      return [line("[waiting for parent]")];
    case "progress":
      return [line(`[progress] ${event.message}`)];
    case "question":
      return [line(`[question] ${event.message}`)];
    case "answer":
      return [line(`[answer] ${event.message}`)];
    case "outcome":
      return [line(event.error ? `[${event.status}] ${event.error}` : `[${event.status}]`)];
  }
}

/**
 * Default sink: one append-only file per subagent under a per-parent-process temp
 * directory. Files are created at launch and opened in append mode so attaching to a
 * running subagent never truncates its history. `cleanup` removes the whole directory.
 */
export function createFileLogBridge(): SubagentLogBridge {
  const dir = join(tmpdir(), `pi-subagents-${process.pid}`);
  let created = false;
  return {
    open(subagentId) {
      // The log is auxiliary: a filesystem failure must degrade to a no-op, never break the subagent.
      try {
        if (!created) {
          mkdirSync(dir, { recursive: true });
          created = true;
        }
        const path = join(dir, `${subagentId}.log`);
        closeSync(openSync(path, "a"));
        return {
          path,
          append(line) {
            try {
              appendFileSync(path, `${line}\n`);
            } catch {}
          },
        };
      } catch {
        return { path: "", append() {} };
      }
    },
    cleanup() {
      if (!created) return;
      rmSync(dir, { recursive: true, force: true });
      created = false;
    },
  };
}
