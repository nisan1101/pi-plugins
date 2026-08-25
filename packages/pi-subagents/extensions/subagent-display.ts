import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/** What a viewer needs to open a subagent's live output. Read-only: no control handles. */
export interface SubagentView {
  subagentId: string;
  title: string;
  logPath: string;
}

/**
 * A pluggable way to show a subagent's live output outside Pi's own TUI. New multiplexers
 * are added as more backends without touching the command, formatter, or log bridge.
 */
export interface SubagentDisplay {
  readonly id: string;
  isAvailable(): boolean;
  show(view: SubagentView): Promise<void>;
}

/** The manual follow-tail a user runs to watch a subagent log without a supported multiplexer. */
export function tailCommand(logPath: string): string {
  return `tail -n +1 -F "${logPath}"`;
}

// Set inside every zellij session; the reliable "am I in zellij" marker.
const ZELLIJ_SESSION_ENV = "ZELLIJ";

/** Pure: the zellij argv that opens a named floating pane following the log from its start. */
export function zellijArgv(view: SubagentView): string[] {
  return ["run", "--floating", "--name", view.title, "--", "tail", "-n", "+1", "-F", view.logPath];
}

function binaryOnPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? "").split(delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

// Resolves once the pane is created (zellij run exits 0), rejects if it cannot be opened.
function spawnZellijPane(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("zellij", argv, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`zellij exited with code ${code ?? "unknown"}`)),
    );
  });
}

interface ZellijDeps {
  env?: NodeJS.ProcessEnv;
  hasBinary?: () => boolean;
  spawnPane?: (argv: string[]) => Promise<void>;
}

export function createZellijDisplay(deps: ZellijDeps = {}): SubagentDisplay {
  const env = deps.env ?? process.env;
  const hasBinary = deps.hasBinary ?? (() => binaryOnPath("zellij", env));
  const spawnPane = deps.spawnPane ?? spawnZellijPane;
  return {
    id: "zellij",
    isAvailable: () => !!env[ZELLIJ_SESSION_ENV] && hasBinary(),
    show: (view) => spawnPane(zellijArgv(view)),
  };
}

/** Ordered built-in backends; the extension selects the first whose isAvailable() is true. */
export const defaultDisplays: readonly SubagentDisplay[] = [createZellijDisplay()];
