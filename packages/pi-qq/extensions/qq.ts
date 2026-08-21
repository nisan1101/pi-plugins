/**
 * /qq <question> — ask a one-off question that has the FULL context of the
 * main agent, but whose prompt and answer are never written to the session.
 *
 * How the requirements are met:
 * - Full context: buildContextEntries() (branch + compaction applied) is turned
 *   into the exact LLM message list via sessionEntryToContextMessages(), the
 *   same helper pi uses internally. No summarizing.
 * - Not persisted: we call the model directly via stream() and never touch
 *   sessionManager.appendMessage / pi.sendMessage / pi.sendUserMessage, so
 *   nothing enters the main agent context.
 * - No tool call / no follow-up: stream() is invoked with NO tools, so the
 *   answering model can only produce a single text answer.
 * - Same model + credentials as the main agent (ctx.model + resolved auth).
 */

import { stream } from "@earendil-works/pi-ai/compat";
import {
	DynamicBorder,
	type ExtensionAPI,
	getMarkdownTheme,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

const QQ_INSTRUCTION =
	"\n\n<quick_question>You are answering a quick side question from the user. " +
	"You have the full conversation context above. Answer directly in this single " +
	"response. You cannot call tools or take further turns.</quick_question>";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("qq", {
		description: "Ask a one-off question with full context; not saved to context",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (!question) {
				ctx.ui.notify("Usage: /qq <question>", "warning");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/qq requires interactive mode", "error");
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) {
				ctx.ui.notify(auth.ok ? `No API key for ${model.provider}` : auth.error, "error");
				return;
			}

			// Faithful copy of the main agent's context, plus the side question.
			const history = ctx.sessionManager
				.buildContextEntries()
				.flatMap(sessionEntryToContextMessages);
			const messages = [
				...history,
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: question }],
					timestamp: Date.now(),
				},
			];
			const systemPrompt = ctx.getSystemPrompt() + QQ_INSTRUCTION;

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const controller = new AbortController();
				const mdTheme = getMarkdownTheme();

				const container = new Container();
				const topBorder = new DynamicBorder((s: string) => theme.fg("accent", s));
				const botBorder = new DynamicBorder((s: string) => theme.fg("accent", s));
				const title = new Text(theme.fg("accent", theme.bold(`/qq  ${question}`)), 1, 0);
				const body = new Markdown("", 1, 1, mdTheme);
				const hint = new Text(theme.fg("dim", "Streaming…  Esc to cancel"), 1, 0);

				container.addChild(topBorder);
				container.addChild(title);
				container.addChild(body);
				container.addChild(hint);
				container.addChild(botBorder);

				let finished = false;
				let acc = "";

				const rerender = () => {
					container.invalidate();
					tui.requestRender();
				};

				const finish = (footer: string) => {
					finished = true;
					hint.setText(theme.fg("dim", footer));
					rerender();
				};

				const run = async () => {
					try {
						const events = stream(
							model,
							{ systemPrompt, messages },
							{
								apiKey: auth.apiKey,
								headers: auth.headers,
								env: auth.env,
								signal: controller.signal,
							},
						);

						for await (const ev of events) {
							if (ev.type === "text_delta") {
								acc += ev.delta;
								body.setText(acc);
								rerender();
							} else if (ev.type === "error") {
								if (ev.reason === "aborted") {
									body.setText(acc || "_Cancelled._");
								} else {
									acc += `\n\n_Error: ${ev.error.errorMessage ?? "model error"}_`;
									body.setText(acc);
								}
							}
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						body.setText(`${acc}\n\n_Error: ${msg}_`);
					} finally {
						finish("Enter or Esc to close");
					}
				};
				void run();

				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (!finished) {
							if (matchesKey(data, "escape")) controller.abort();
							return;
						}
						if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
							done(undefined);
						}
					},
				};
			});
		},
	});
}
