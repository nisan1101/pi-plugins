import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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

  const reportCancelledTimers = (cancelled: PendingTimer[], cause: string) => {
    if (cancelled.length === 0) return;

    const summary = cancelled
      .map(({ reason, dueAt }) => `- ${reason} (scheduled for ${new Date(dueAt).toISOString()})`)
      .join("\n");
    pi.sendMessage(
      {
        customType: TIMER_CANCELLED_TYPE,
        content:
          `${cause} ` +
          "These timers will not be restored. Their targets were not inspected or changed; local jobs may still be running.\n\n" +
          summary,
        display: true,
        details: {
          cancelledTimerIds: cancelled.map(({ timerId }) => timerId),
          pending: [],
        },
      },
      { triggerTurn: false },
    );
  };
  pi.registerTool({
    name: "set_timer",
    label: "Set Timer",
    description:
      "Set a relative timer to revisit long-running external work, such as a managed local job, CI, or Kubernetes pod readiness. Ends the current run and wakes a later turn to check progress.",
    promptSnippet:
      "Yield during long-running external work and wake later to check progress",
    promptGuidelines: [
      "Run local commands in the foreground by default. Choose managed background execution and set_timer when you reasonably expect the work to take more than roughly 1–2 minutes. Apply the same duration guideline when deciding whether to use set_timer while waiting on remote state.",
      "For local work that warrants set_timer, launch a named job with zmx when available (`zmx run <session> -d <command...>`), otherwise another process manager.",
      "Keep the set_timer reason to one short line: identify the target and how to check it. Include the job/session ID or remote identifier. Aim for under 30 words, allowing longer commands or paths. Reuse the same reason when polling the same target.",
      "Keep background, previous results, and next-step plans in the conversation, not in the set_timer reason.",
      "On set_timer wake, inspect current status. Reschedule only while pending; otherwise inspect the result and continue the task. Wait at least two minutes between checks, longer for slow work.",
      "Call set_timer alone in its tool-call batch, after other tool calls finish, so it can end the current run.",
    ],
    parameters: Type.Object({
      seconds: Type.Number({ exclusiveMinimum: 0, maximum: MAX_DELAY_SECONDS }),
      reason: Type.String({
        minLength: 1,
        description:
          "One-line check instruction: target identifier and status check. Reuse unchanged when polling the same target.",
      }),
    }),
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("Set Timer"));
      if (args.seconds !== undefined) {
        text += theme.fg("muted", ` · ${args.seconds}s`);
      }
      if (args.reason) {
        text += `\n${theme.fg("muted", args.reason)}`;
      }
      return new Text(text, 0, 0);
    },
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
        content: [{ type: "text", text: "Timer scheduled." }],
        details: { seconds, reason },
        terminate: true,
      };
    },
  });

  pi.on("session_start", (_event, { sessionManager }) => {
    reportCancelledTimers(
      findPendingTimers(sessionManager),
      "These timers were interrupted before their notifications reached the agent.",
    );
  });

  pi.on("session_before_tree", () => {
    if (pendingTimers.size === 0) return;

    for (const { timeout } of pendingTimers.values()) clearTimeout(timeout);
    pendingTimers.clear();
    persistPendingTimers();
  });

  pi.on("session_tree", (_event, { sessionManager }) => {
    reportCancelledTimers(
      findPendingTimers(sessionManager),
      "Tree navigation cancelled these timers recorded on this branch.",
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
