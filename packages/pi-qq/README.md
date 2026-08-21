# pi-qq

A [pi](https://pi.dev) extension that adds a **`/qq <question>`** command: ask a
one-off question that has the **full context of the main agent**, get a streamed
answer in a small panel — and have **neither the question nor the answer saved to
the agent's context**.

Use it for quick side questions ("what did we decide about X?", "summarize the
error above", "which file was that in?") without polluting the conversation the
agent actually reasons over.

## Behaviour

- **Full context** — the question is answered against the exact message list pi
  sends to the LLM (branch + compaction applied), plus the main system prompt.
- **Not persisted** — the model is called directly; nothing is written to the
  session, so the main agent never sees the `/qq` exchange.
- **No tools, no follow-up** — the answering model gets no tools and takes a
  single turn. It can only produce one text answer.
- **Same model & credentials** as the main agent.

## Usage

```
/qq what did we decide about the caching approach?
```

- The answer streams live into a bordered panel.
- **Esc** cancels while streaming.
- **Enter** or **Esc** closes the panel once the answer is complete.

Interactive (TUI) mode only.

## Install

Install the monorepo directly from GitHub:

```bash
pi install https://github.com/nisan1101/pi-plugins
```
