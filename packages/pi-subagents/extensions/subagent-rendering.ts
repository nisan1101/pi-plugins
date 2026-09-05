import { getMarkdownTheme, keyHint, type MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

const COMPLETION_PREVIEW_LINES = 8;

export const subagentMessageStyles = {
  "subagent-progress": { glyph: "·", label: "progress", color: "muted" },
  "subagent-question": { glyph: "?", label: "needs an answer", color: "warning" },
  "subagent-completed": { glyph: "✓", label: "completed", color: "success" },
  "subagent-failed": { glyph: "✗", label: "failed", color: "error" },
} as const;

export interface SubagentMessageDetails {
  id: string;
  display_name: string;
  body: string;
  at?: string;
}

export const renderSubagentMessage: MessageRenderer<SubagentMessageDetails> = (
  message, { expanded, outputPad }, theme,
) => {
  const details = message.details;
  // Older messages have no separate body: let Pi show their original content in full.
  if (details?.body === undefined) return undefined;
  const style = subagentMessageStyles[message.customType as keyof typeof subagentMessageStyles];
  if (!style) return undefined;

  const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new Text(theme.fg(
    style.color,
    theme.bold(`${style.glyph} ${details.display_name}#${details.id.slice(0, 8)} · ${style.label}`),
  ), 0, 0));
  if (expanded) {
    box.addChild(new Text(theme.fg("dim", `UUID: ${details.id}${details.at ? `\nTime: ${details.at}` : ""}`), 0, 0));
  }
  box.addChild(new Spacer(1));

  const body = new Markdown(details.body, 0, 0, getMarkdownTheme());
  if (expanded || message.customType !== "subagent-completed") {
    box.addChild(body);
  } else {
    // Limit rendered lines, not source lines: long paragraphs also need bounded previews.
    box.addChild({
      render(width) {
        const lines = body.render(width);
        if (lines.length <= COMPLETION_PREVIEW_LINES) return lines;
        const hint = new Text(theme.fg(
          "dim", `… ${lines.length - COMPLETION_PREVIEW_LINES} more lines (${keyHint("app.tools.expand", "to expand")})`,
        ), 0, 0);
        return [...lines.slice(0, COMPLETION_PREVIEW_LINES), ...hint.render(width)];
      },
      invalidate: () => body.invalidate(),
    });
  }
  return box;
};
