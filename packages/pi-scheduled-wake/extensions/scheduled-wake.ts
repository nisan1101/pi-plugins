import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_DELAY_MS = 2_147_483_647;
const MAX_DELAY_SECONDS = MAX_DELAY_MS / 1000;

export default function scheduledWake(pi: ExtensionAPI) {
  const pendingWakes = new Set<ReturnType<typeof setTimeout>>();

  pi.registerTool({
    name: "schedule_wake",
    label: "Schedule Wake",
    description: "Schedule a future agent wake to check asynchronous work.",
    promptSnippet: "Schedule a future turn to check asynchronous or long-running work",
    promptGuidelines: [
      "Use schedule_wake between checks of long-running local jobs or remote state such as Kubernetes pod readiness or CI completion.",
      "Before schedule_wake for a local job, use zmx when available (`zmx run <session> -d <command...>`); otherwise use another process manager. Include its session or job name in the reason; avoid unmanaged raw `&` or `nohup`.",
      "The schedule_wake reason must name the target, status check, and actions for pending or completed states. A wake is only a check: reschedule if pending. Call schedule_wake by itself after all other tool calls finish; Pi ends the run only when every tool result in that batch is terminating.",
    ],
    parameters: Type.Object({
      afterSeconds: Type.Number({ exclusiveMinimum: 0, maximum: MAX_DELAY_SECONDS }),
      reason: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId, { afterSeconds, reason }) {
      const requestedDelayMs = afterSeconds * 1000;
      if (!Number.isFinite(afterSeconds) || requestedDelayMs < 1 || requestedDelayMs > MAX_DELAY_MS) {
        throw new Error(`afterSeconds must be greater than 0 and at most ${MAX_DELAY_SECONDS}.`);
      }

      const delayMs = Math.ceil(requestedDelayMs);
      if (!reason.trim()) throw new Error("reason must not be empty.");
      const timer = setTimeout(() => {
        pendingWakes.delete(timer);
        pi.sendMessage(
          {
            customType: "scheduled-wake",
            content: `Scheduled wake fired.\n\n${reason}`,
            display: true,
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }, delayMs);
      pendingWakes.add(timer);

      return {
        content: [{ type: "text", text: `Scheduled a wake in ${afterSeconds} seconds.` }],
        details: { afterSeconds, reason },
        terminate: true,
      };
    },
  });

  pi.on("session_shutdown", () => {
    for (const timer of pendingWakes) clearTimeout(timer);
    pendingWakes.clear();
  });
}
