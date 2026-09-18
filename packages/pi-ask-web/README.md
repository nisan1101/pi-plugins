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

- **question** must include relevant context, scope, and date or version requirements.
  The researcher cannot see the parent conversation.
- **depth** maps to OpenAI search context size: `quick → low`, `standard → medium`,
  `thorough → high`. Depth changes retrieval context, not answer length or reasoning
  effort; it does not guarantee a particular response time.
- **domains** is a hard allowlist enforced by the hosted search tool. Hostnames only
  (e.g. `docs.python.org`); subdomains are included. Malformed entries are rejected,
  duplicates and casing are normalized, and at most 20 distinct domains are allowed.

### Response

The researcher is asked for the shortest answer that resolves the question,
usually a few sentences for simple lookups, with an approximate 500-word ceiling
and at most eight sources. It is asked to use these Markdown sections:

```md
## Answer
...

## Sources
- [Source title](https://example.com) — optional remark

## Uncertainty
None noted.
```

When no sources can be established, the requested response uses `- No sources found.`
and explains the gap under `Uncertainty`. These length and formatting rules are
prompt instructions, not runtime guarantees; non-empty responses are returned even
if they differ. Source links are produced by the nested model and are not
authoritative raw citation metadata.

## Requirements

`ask_web` uses your Pi OpenAI Codex login. If you are not logged in, the tool
returns an instruction to run Pi's OpenAI Codex login. It requires the
`gpt-6-astra` model with low reasoning effort and fails clearly (without falling
back to another tier) when it is unavailable. Reasoning effort stays low for all
search depths.

## Development

```bash
npm install
npm run typecheck
npm test
```

Tests are behavioral and mock the model registry, so they need no live credentials.
An optional manual smoke check against a logged-in account can confirm live
hosted-tool compatibility.
