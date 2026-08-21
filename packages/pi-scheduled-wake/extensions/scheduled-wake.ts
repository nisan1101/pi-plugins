import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_DELAY_MS = 2_147_483_647;
const MAX_DELAY_SECONDS = MAX_DELAY_MS / 1000;
const WAKE_STATE_TYPE = "scheduled-wake-state";
const WAKE_CANCELLED_TYPE = "scheduled-wake-cancelled";
const WAKE_FIRED_TYPE = "scheduled-wake";

interface PendingWake {
  wakeId: string;
  reason: string;
  dueAt: number;
}

interface RuntimeWake {
  wake: PendingWake;
  timer: ReturnType<typeof setTimeout>;
}

function readPendingWakes(value: unknown): PendingWake[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pending = (value as { pending?: unknown }).pending;
  if (!Array.isArray(pending)) return undefined;

  return pending.every(
    (wake) =>
      wake &&
      typeof wake === "object" &&
      typeof wake.wakeId === "string" &&
      typeof wake.reason === "string" &&
      typeof wake.dueAt === "number" &&
      Number.isFinite(wake.dueAt) &&
      !Number.isNaN(new Date(wake.dueAt).valueOf()),
  )
    ? (pending as PendingWake[])
    : undefined;
}

function pendingWakesFromMarker(entry: SessionEntry): PendingWake[] | undefined {
  if (entry.type === "custom" && entry.customType === WAKE_STATE_TYPE) {
    return readPendingWakes(entry.data);
  }
  if (entry.type === "custom_message" && entry.customType === WAKE_CANCELLED_TYPE) {
    return readPendingWakes(entry.details);
  }
  return undefined;
}

function findPendingWakes(sessionManager: ExtensionContext["sessionManager"]): PendingWake[] {
  let entry = sessionManager.getLeafEntry();
  while (entry) {
    const pending = pendingWakesFromMarker(entry);
    if (pending) return pending;
    entry = entry.parentId ? sessionManager.getEntry(entry.parentId) : undefined;
  }
  return [];
}

export default function scheduledWake(pi: ExtensionAPI) {
  const pendingWakes = new Map<string, RuntimeWake>();

  const persistPendingWakes = () => {
    pi.appendEntry(WAKE_STATE_TYPE, {
      pending: [...pendingWakes.values()].map(({ wake }) => wake),
    });
  };
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
    async execute(toolCallId, { afterSeconds, reason }) {
      const requestedDelayMs = afterSeconds * 1000;
      if (!Number.isFinite(afterSeconds) || requestedDelayMs < 1 || requestedDelayMs > MAX_DELAY_MS) {
        throw new Error(`afterSeconds must be greater than 0 and at most ${MAX_DELAY_SECONDS}.`);
      }

      const delayMs = Math.ceil(requestedDelayMs);
      if (!reason.trim()) throw new Error("reason must not be empty.");
      const wake = { wakeId: toolCallId, reason, dueAt: Date.now() + delayMs };
      const timer = setTimeout(() => {
        pi.sendMessage(
          {
            customType: WAKE_FIRED_TYPE,
            content: `Scheduled wake fired.\n\n${reason}`,
            display: true,
            details: { wakeId: toolCallId },
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }, delayMs);
      pendingWakes.set(toolCallId, { wake, timer });
      persistPendingWakes();

      return {
        content: [{ type: "text", text: `Scheduled a wake in ${afterSeconds} seconds.` }],
        details: { afterSeconds, reason },
        terminate: true,
      };
    },
  });

  pi.on("session_start", (_event, { sessionManager }) => {
    const interrupted = findPendingWakes(sessionManager);
    if (interrupted.length === 0) return;

    const summary = interrupted
      .map(({ reason, dueAt }) => `- ${reason} (scheduled for ${new Date(dueAt).toISOString()})`)
      .join("\n");
    pi.sendMessage(
      {
        customType: WAKE_CANCELLED_TYPE,
        content:
          "Scheduled wakes from a previous Pi process were interrupted before their messages reached the agent. " +
          "Their timers will not be restored; the underlying local jobs or remote targets were not inspected, stopped, or changed.\n\n" +
          summary,
        display: true,
        details: {
          cancelledWakeIds: interrupted.map(({ wakeId }) => wakeId),
          pending: [],
        },
      },
      { triggerTurn: false },
    );
  });

  pi.on("message_end", ({ message }) => {
    if (message.role !== "custom" || message.customType !== WAKE_FIRED_TYPE) return;
    const wakeId = (message.details as { wakeId?: unknown } | undefined)?.wakeId;
    if (typeof wakeId === "string" && pendingWakes.delete(wakeId)) persistPendingWakes();
  });

  pi.on("session_shutdown", () => {
    for (const { timer } of pendingWakes.values()) clearTimeout(timer);
    pendingWakes.clear();
  });
}
