import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_DELAY_MS = 2_147_483_647;
const MAX_DELAY_SECONDS = MAX_DELAY_MS / 1000;
const TIMER_STATE_TYPE = "timer-state";
const TIMER_CANCELLED_TYPE = "timer-cancelled";
const TIMER_FIRED_TYPE = "timer";

interface PendingTimer {
  timerId: string;
  reason: string;
  dueAt: number;
}

interface RuntimeTimer {
  pending: PendingTimer;
  timeout: ReturnType<typeof setTimeout>;
}

function readPendingTimers(value: unknown): PendingTimer[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pending = (value as { pending?: unknown }).pending;
  if (!Array.isArray(pending)) return undefined;

  return pending.every(
    (timer) =>
      timer &&
      typeof timer === "object" &&
      typeof timer.timerId === "string" &&
      typeof timer.reason === "string" &&
      typeof timer.dueAt === "number" &&
      Number.isFinite(timer.dueAt) &&
      !Number.isNaN(new Date(timer.dueAt).valueOf()),
  )
    ? (pending as PendingTimer[])
    : undefined;
}

function pendingTimersFromMarker(entry: SessionEntry): PendingTimer[] | undefined {
  if (entry.type === "custom" && entry.customType === TIMER_STATE_TYPE) {
    return readPendingTimers(entry.data);
  }
  if (entry.type === "custom_message" && entry.customType === TIMER_CANCELLED_TYPE) {
    return readPendingTimers(entry.details);
  }
  return undefined;
}

function findPendingTimers(sessionManager: ExtensionContext["sessionManager"]): PendingTimer[] {
  let entry = sessionManager.getLeafEntry();
  while (entry) {
    const pending = pendingTimersFromMarker(entry);
    if (pending) return pending;
    entry = entry.parentId ? sessionManager.getEntry(entry.parentId) : undefined;
  }
  return [];
}

export default function timer(pi: ExtensionAPI) {
  const pendingTimers = new Map<string, RuntimeTimer>();

  const persistPendingTimers = () => {
    pi.appendEntry(TIMER_STATE_TYPE, {
      pending: [...pendingTimers.values()].map(({ pending }) => pending),
    });
  };
  pi.registerTool({
    name: "set_timer",
    label: "Set Timer",
    description:
      "Set a relative timer that ends the current run; when it fires, a later turn wakes you to re-check external work you must poll — a process-manager job, CI, or a remote condition like Kubernetes pod readiness.",
    promptSnippet:
      "Set a relative timer that ends the current run; when it fires, a later turn wakes you to re-check external state",
    promptGuidelines: [
      "Use set_timer between checks of long-running local jobs or remote state you must poll, such as Kubernetes pod readiness or CI completion. Calling set_timer ends the current run; when the timer fires, a later turn wakes you to re-check the target.",
      "Before set_timer for a local job, use zmx when available (`zmx run <session> -d <command...>`); otherwise use another process manager. Include its session or job name in the reason; avoid unmanaged raw `&` or `nohup`.",
      "The set_timer reason must name the target, status check, and actions for pending or completed states. A timer is only a check: reschedule only while pending. Call set_timer by itself after all other tool calls finish; Pi ends the run only when every tool result in that batch is terminating.",
    ],
    parameters: Type.Object({
      seconds: Type.Number({ exclusiveMinimum: 0, maximum: MAX_DELAY_SECONDS }),
      reason: Type.String({ minLength: 1 }),
    }),
    async execute(toolCallId, { seconds, reason }) {
      const requestedDelayMs = seconds * 1000;
      if (!Number.isFinite(seconds) || requestedDelayMs < 1 || requestedDelayMs > MAX_DELAY_MS) {
        throw new Error(`seconds must be greater than 0 and at most ${MAX_DELAY_SECONDS}.`);
      }

      const delayMs = Math.ceil(requestedDelayMs);
      if (!reason.trim()) throw new Error("reason must not be empty.");
      const pending = { timerId: toolCallId, reason, dueAt: Date.now() + delayMs };
      const timeout = setTimeout(() => {
        pi.sendMessage(
          {
            customType: TIMER_FIRED_TYPE,
            content: `Timer fired.\n\n${reason}`,
            display: true,
            details: { timerId: toolCallId },
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }, delayMs);
      pendingTimers.set(toolCallId, { pending, timeout });
      persistPendingTimers();

      return {
        content: [{ type: "text", text: `Set a timer for ${seconds} seconds.` }],
        details: { seconds, reason },
        terminate: true,
      };
    },
  });

  pi.on("session_start", (_event, { sessionManager }) => {
    const interrupted = findPendingTimers(sessionManager);
    if (interrupted.length === 0) return;

    const summary = interrupted
      .map(({ reason, dueAt }) => `- ${reason} (scheduled for ${new Date(dueAt).toISOString()})`)
      .join("\n");
    pi.sendMessage(
      {
        customType: TIMER_CANCELLED_TYPE,
        content:
          "Timers from a previous Pi process were interrupted before their messages reached the agent. " +
          "These timers will not be restored; the underlying local jobs or remote targets were not inspected, stopped, or changed.\n\n" +
          summary,
        display: true,
        details: {
          cancelledTimerIds: interrupted.map(({ timerId }) => timerId),
          pending: [],
        },
      },
      { triggerTurn: false },
    );
  });

  pi.on("message_end", ({ message }) => {
    if (message.role !== "custom" || message.customType !== TIMER_FIRED_TYPE) return;
    const timerId = (message.details as { timerId?: unknown } | undefined)?.timerId;
    if (typeof timerId === "string" && pendingTimers.delete(timerId)) persistPendingTimers();
  });

  pi.on("session_shutdown", () => {
    for (const { timeout } of pendingTimers.values()) clearTimeout(timeout);
    pendingTimers.clear();
  });
}
