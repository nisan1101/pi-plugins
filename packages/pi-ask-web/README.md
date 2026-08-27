# pi-ask-web

A single Pi tool, `ask_web`, that consults a **remote web librarian** for current,
source-backed information — regardless of which model provider your active agent uses.

The tool delegates a nested completion to an OpenAI Codex model through Pi's model
registry, injecting OpenAI's hosted Responses `web_search` tool. Pi owns OAuth,
request transport, streaming, cancellation, and usage accounting; the extension only
shapes the request and returns the normalized answer. It is **not** a raw search
engine or page fetcher: it returns a researched briefing, not ranked results or raw
snippets.

## Tool: `ask_web`

```ts
ask_web({
  question: string,              // one self-contained question
  depth?: "quick" | "standard" | "thorough",  // defaults to "standard"
  domains?: string[]             // optional hard allowlist of source hostnames (max 20)
})
```

- **depth** maps to OpenAI search context size: `quick → low`, `standard → medium`,
  `thorough → high`. Depth changes retrieval context, not the output-size ceiling.
- **domains** is a hard allowlist enforced by the hosted search tool. Hostnames only
  (e.g. `docs.python.org`); subdomains are included. Malformed entries are rejected,
  duplicates and casing are normalized, and at most 20 distinct domains are allowed.

### Response

Markdown with three stable sections:

```md
## Answer
...

## Sources
- [Source title](https://example.com) — optional remark

## Uncertainty
None noted.
```

When no sources can be established, `Sources` contains `- No sources found.` and
`Uncertainty` explains why. Source links are produced by the nested model and are
not authoritative raw citation metadata.

## Requirements

`ask_web` uses your Pi OpenAI Codex login. If you are not logged in, the tool
returns an instruction to run Pi's OpenAI Codex login. It requires the
`gpt-5.6-luna` model and fails clearly (without falling back to another tier) when
it is unavailable.

## Development

```bash
npm install
npm run typecheck
npm test
```

Tests are behavioral and mock the model registry, so they need no live credentials.
An optional manual smoke check against a logged-in account can confirm live
hosted-tool compatibility.
