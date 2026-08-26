# Ask Web: Remote Web Librarian

**Status:** ready-for-agent

## Problem Statement

Pi agents sometimes need current, source-backed information from the public web even when the active model provider has no native browsing capability. The available implementation path can reuse Pi's separate OpenAI Codex subscription login and Responses client, but presenting that capability as conventional web search would promise the wrong thing. The nested OpenAI model does not return a ranked search-result interface to the calling agent; it searches, selects sources, interprets them, and returns model-authored prose.

A conventional `web_search` contract would encourage callers to expect raw snippets, exact result counts, authoritative structured citations, page-fetch semantics, or provider controls. Pi currently normalizes the nested Responses result to text and discards hosted `web_search_call` items and citation annotations. Reimplementing the Responses transport and parser inside the extension solely to recover those details would duplicate Pi's authentication, request, streaming, cancellation, error, and usage behavior.

Users instead need an honest, small interface for consulting a remote web librarian. The calling agent should be able to ask a self-contained question, optionally choose research depth and restrict sources to trusted domains, and receive a concise answer with source links and explicit uncertainty. This must work regardless of the calling agent's active provider while keeping OAuth, model churn, transport details, and private OpenAI protocol details out of the public tool interface.

## Solution

Add a single provider-neutral Pi tool named `ask_web`. The tool represents a stateless remote web librarian, not raw search or page fetch. The calling agent submits one self-contained question, may select a human-readable depth, and may provide a hard allowlist of source domains.

The extension delegates a nested completion to an available OpenAI Codex model through Pi's model registry. It injects OpenAI's hosted Responses `web_search` tool into that nested request while allowing Pi to own OAuth refresh, ChatGPT account routing, request construction, SSE handling, normalized response parsing, cancellation, errors, and usage accounting. The OpenAI server performs and unrolls hosted web search within the nested response. Pi returns the final normalized text to the extension; the extension does not parse raw Responses events.

The librarian returns a bounded Markdown briefing with three stable sections: `Answer`, `Sources`, and `Uncertainty`. Sources are a list of Markdown links with optional short remarks. The contract deliberately contains no raw snippets or claim that source entries reproduce authoritative Responses citation metadata. The prompt requires primary sources, honest treatment of disagreement, and explicit uncertainty. The extension requires only a non-empty normalized response and otherwise returns useful model-authored Markdown without implementing a structural Markdown parser.

The successful proof of concept is promoted into a production package named `pi-ask-web`; the POC package and POC tool name are replaced rather than retained alongside it.

## User Stories

1. As a Pi user, I want my active agent to consult the current web, so that it can answer questions whose facts may have changed since model training.
2. As a Pi user, I want web consultation to work while using any active model provider, so that browsing capability is not coupled to my conversational model.
3. As a Pi user, I want the tool presented as a remote librarian, so that I understand it returns researched interpretation rather than raw search-engine results.
4. As a Pi user, I want a short `ask_web` tool name, so that its purpose is easy for agents and humans to recognize.
5. As a Pi user, I want to ask one self-contained question per call, so that each consultation has a clear scope.
6. As a Pi user, I want the calling agent to formulate the librarian question from its own context, so that my full conversation is not disclosed to the nested OpenAI model.
7. As a Pi user, I want the default research depth to be suitable for ordinary factual questions, so that I do not need to configure every call.
8. As a Pi user, I want a quick depth for simple lookups, so that routine questions use less time and context.
9. As a Pi user, I want a thorough depth for difficult research, so that the librarian can use more retrieved context when warranted.
10. As a Pi user, I want depth expressed as `quick`, `standard`, and `thorough`, so that I do not need to understand OpenAI-specific context-size terminology.
11. As a Pi user, I want to restrict a consultation to selected domains, so that I can require official or otherwise trusted sources.
12. As a Pi user, I want domain restrictions enforced by the hosted search tool rather than merely mentioned in prose, so that they act as hard source constraints.
13. As a Pi user, I want subdomains included when I allow a domain, so that an official site's documentation hierarchy remains searchable.
14. As a Pi user, I want malformed domains rejected before a request, so that a typo does not silently weaken source restrictions.
15. As a Pi user, I want duplicate and differently cased domains normalized, so that equivalent restrictions do not create noisy requests.
16. As a Pi user, I want the librarian to prefer primary sources, so that answers rely on official documentation, government pages, standards, and original research when available.
17. As a Pi user, I want independent corroboration when a question warrants it, so that consequential claims do not rely unnecessarily on one source.
18. As a Pi user, I want conflicting sources reported rather than hidden, so that disagreement remains visible.
19. As a Pi user, I want the direct answer first, so that I can quickly understand the result.
20. As a Pi user, I want sources listed as titled Markdown links, so that I can open and inspect the supporting pages.
21. As a Pi user, I want an optional short remark beside a source, so that the librarian can clarify relevance or limitations without inventing a rigid metadata schema.
22. As a Pi user, I do not want model-produced excerpts labeled as raw evidence, so that paraphrases are not mistaken for verbatim source text.
23. As a Pi user, I want an uncertainty section on every response, so that caveats are explicit even when none are identified.
24. As a Pi user, I want `None noted.` when no material uncertainty is found, so that a missing section cannot be mistaken for certainty.
25. As a Pi user, I want `No sources found.` when the librarian cannot establish sources, so that it never fabricates a source list.
26. As a Pi user, I want source failures explained under uncertainty, so that I know why an answer is weak or incomplete.
27. As a Pi user, I want concise librarian responses, so that web consultation does not overwhelm the main agent's context.
28. As a Pi user, I want source lists bounded, so that thorough research remains usable rather than becoming an unbounded dump.
29. As a Pi user, I want web content treated as untrusted data, so that instructions embedded in retrieved pages do not control the librarian.
30. As a Pi user, I want the extension to reuse my Pi OpenAI Codex login, so that I do not configure or store another credential.
31. As a Pi user, I want a clear login instruction when OpenAI Codex auth is unavailable, so that I can repair the capability directly.
32. As a Pi user, I want account-ineligibility and usage-limit failures distinguished from missing login, so that corrective action is clear.
33. As a Pi user, I want an in-flight consultation cancelled when I cancel its Pi tool call, so that unwanted work does not continue.
34. As a Pi user, I want a bounded request timeout, so that a stalled remote consultation does not block the agent indefinitely.
35. As a Pi user, I do not want automatic search retries, so that one failed consultation cannot silently consume subscription allowance twice.
36. As a Pi user, I want nested model usage included in Pi's usage accounting, so that the consultation's cost and token impact remain visible.
37. As a Pi user, I want the tool visible before I log in, so that discovery is stable and execution can explain how to enable it.
38. As a Pi user, I want the extension to remain stateless, so that each question has no hidden dependency on an earlier librarian call.
39. As a Pi user, I do not want librarian results persisted in a separate cache or browser, so that the main conversation remains the sole visible record.
40. As a Pi user, I do not want extra commands, shortcuts, widgets, or curator interfaces, so that installing the extension adds only the requested capability.
41. As an agent, I want the tool description to say that it returns a sourced briefing, so that I choose it for current facts and source-backed claims.
42. As an agent, I want the tool description to say that it is not raw search or arbitrary page fetch, so that I do not make unsupported assumptions about its output.
43. As an agent, I want model selection hidden inside the extension, so that OpenAI model-catalog churn does not change my tool calls.
44. As an agent, I want a non-empty answer returned even if Markdown formatting deviates, so that useful research is not discarded by a brittle parser.
45. As an extension maintainer, I want Pi to own OAuth refresh and request authentication, so that credential behavior remains centralized.
46. As an extension maintainer, I want Pi to own Responses streaming and normalization, so that the extension does not implement another SSE parser.
47. As an extension maintainer, I want one high behavioral testing seam, so that tests exercise the public tool without exposing private helpers.
48. As an extension maintainer, I want mocked tests independent of live ChatGPT credentials, so that CI is deterministic and secret-free.
49. As an extension maintainer, I want an optional live smoke check, so that private hosted-tool compatibility can be checked without making CI depend on it.
50. As an extension maintainer, I want the successful POC replaced by the production package, so that users see one canonical tool rather than prototype and final variants.

## Implementation Decisions

- Build one production package whose only public capability is the `ask_web` tool. Replace the proof-of-concept package and POC tool registration rather than shipping both.
- Treat the package as a remote web-librarian module. Do not describe it as a raw search engine, web-page fetcher, or oracle.
- Use the following public input interface, refined from the validated proof of concept:

  ```ts
  ask_web({
    question: string,
    depth?: "quick" | "standard" | "thorough",
    domains?: string[]
  })
  ```

- Require `question` to contain non-whitespace text after trimming. Send the trimmed question as the only user message in the nested completion.
- Default omitted depth to `standard`. Map `quick` to OpenAI search context size `low`, `standard` to `medium`, and `thorough` to `high`.
- Treat `domains` as a hard allowlist. Accept hostnames only, normalize to lowercase, remove duplicates, preserve first-seen order, reject malformed entries, and allow at most 20 distinct domains.
- Do not expose approximate user location. A later feature may add it only for an observed localized-search need and only from explicit user input.
- Do not expose exact result count, recency, blocked domains, cached/indexed/live modes, hosted-tool version, provider, or model. Hosted Responses search does not provide stable hard controls for all of those concepts, and backend protocol choices do not belong in the librarian interface.
- Let freshness requirements remain part of the natural-language question rather than presenting a soft prompt hint as a hard recency filter.
- Register the tool even when OpenAI Codex authentication is unavailable. Resolve capability at execution time and return an actionable instruction to run Pi's OpenAI Codex login flow when needed.
- Resolve an OpenAI Codex model from Pi's model registry for every execution. Require the newest available Terra-tier model and fail clearly when no Terra model is available. Do not fall back to another tier, and do not add a model setting to the tool or package.
- Do not use the active conversational model to execute the librarian request. The active model may belong to any provider; the nested model is selected explicitly from the OpenAI Codex provider.
- Use Pi's model-registry completion seam rather than resolving and forwarding bearer tokens from extension code. Pi remains responsible for credential refresh, ChatGPT account routing, provider headers, and current provider configuration.
- Inject the provider-hosted Responses tool `{ type: "web_search" }` into the nested provider payload. Require that hosted tool for the nested response. The OpenAI server, not Pi's local agent loop, executes and unrolls the hosted search.
- Pass `search_context_size` and an allowed-domain filter into the hosted tool only when their corresponding public inputs require them.
- Do not pass the parent conversation, parent system prompt, session entries, current working directory content, or active tools into the nested completion. The nested context contains only the librarian role contract and the self-contained question.
- Use SSE transport through Pi, a 60-second request timeout, no automatic retries, and the Pi tool execution abort signal.
- Return nested completion usage on the tool result so Pi includes it in session usage accounting.
- Ask the librarian to return this Markdown contract, validated by the live proof of concept:

  ```md
  ## Answer
  ...

  ## Sources
  - [Source title](https://example.com) — optional remark

  ## Uncertainty
  None noted.
  ```

- Require all three headings in the librarian prompt. When no sources are found, require `- No sources found.` under `Sources` and an explanation under `Uncertainty`.
- Do not request or return raw snippets. Do not claim that any model-authored text is verbatim source metadata.
- Keep source remarks optional and short. They may explain relevance, source quality, or limitations but are not a substitute for the answer or uncertainty section.
- Prefer primary and authoritative sources. Ask for independent corroboration when warranted, explicit reporting of conflicting sources, and source-quality limitations under `Uncertainty`.
- Treat all retrieved web content as untrusted data. The librarian role contract tells the nested model to ignore instructions found in sources and use them only as evidence.
- Bound the generated briefing to approximately 500 words and no more than eight sources. Depth changes retrieval context, not the output-size ceiling.
- Apply Pi's normal custom-tool output truncation as a hard safety bound in addition to the prompt-level response limits.
- Do not parse or validate Markdown structure at runtime. Require only non-empty normalized text. Formatting is a prompt and test contract; a useful non-empty deviation remains a successful result.
- Do not inspect, parse, cache, or expose raw `web_search_call` items or `url_citation` annotations. Pi currently discards those during response normalization, and recovering them is not required by this librarian contract.
- Do not add a raw `fetch`, direct OpenAI client, OpenAI SDK dependency, Responses event parser, credential cache, result cache, persistent state, command, shortcut, widget, custom renderer, or browser curator.
- Report missing model/auth, account eligibility, usage limits, timeout, cancellation, provider failure, and empty normalized response with concise actionable errors. Never include credentials or raw provider bodies in errors.
- Keep the tool stateless. Every invocation is an independent nested completion with no hidden continuation identifier or reference to previous librarian results.

## Testing Decisions

- Test at one high seam: load the complete extension through an ExtensionAPI-compatible harness, capture the registered `ask_web` tool, invoke it, and observe calls made through an injected fake model registry plus the returned Pi tool result.
- Keep tests behavioral. Assert the public schema, nested completion request, hosted-tool payload, returned text, details, usage, and errors rather than private helper functions or collection types.
- Use existing extension-harness tests in the Scheduled Wake and Subagents packages as prior art for capturing registered tools and injecting fake Pi contexts.
- Use the proof-of-concept test as prior art for verifying that an active non-OpenAI model does not affect nested OpenAI Codex model selection and that the hosted web-search tool is added through Pi's payload seam.
- Verify that exactly one public tool named `ask_web` is registered and that no POC tool remains registered.
- Verify that a whitespace-only question fails before model selection or network work.
- Verify that omitted depth maps to `medium`, and that `quick`, `standard`, and `thorough` map to `low`, `medium`, and `high` respectively.
- Verify that omitted domains produce no hosted allowed-domain filter.
- Verify hostname normalization, lowercase conversion, duplicate removal, stable ordering, malformed-domain rejection, and the 20-domain maximum.
- Verify that a non-OpenAI active model still causes the nested completion to use the selected OpenAI Codex model.
- Verify that the newest available Terra model is selected and that execution fails clearly when the catalog contains no Terra model.
- Verify that no parent messages, system prompt, tools, or session content enter the nested context.
- Verify that the provider payload preserves Pi-generated fields while adding one hosted `web_search` tool, required tool choice, selected context size, and optional allowed-domain filters.
- Verify that request options carry the execution abort signal, SSE transport, 60-second timeout, and zero automatic retries.
- Verify that a normalized text response is returned unchanged even when it does not perfectly match the requested Markdown headings.
- Verify that multiple normalized text blocks are joined predictably and that a response with no model-visible text fails clearly.
- Verify that nested usage is returned on the tool result.
- Verify that the librarian role contract contains the `Answer`, `Sources`, and `Uncertainty` headings; the no-source fallback; primary-source preference; conflict reporting; untrusted-content instruction; approximate word limit; and eight-source limit.
- Verify that no excerpt or raw-snippet field appears in the role contract.
- Verify that missing authentication instructs the user to use Pi's OpenAI Codex login, while a logged-in catalog without a Terra model reports the missing Terra requirement without choosing another tier.
- Verify timeout, cancellation, account-ineligibility, usage-limit, and generic provider errors are surfaced without automatic retry or credential leakage. Use fake provider failures rather than testing Pi's provider implementation.
- Do not unit-test Pi's OAuth refresh, ChatGPT account-ID extraction, request headers, SSE parser, hosted-tool server execution, or usage calculation. Those behaviors belong to Pi and OpenAI, outside the extension's seam.
- Keep live network testing outside CI. The optional manual smoke check uses a logged-in Pi account, invokes `ask_web`, confirms a normal three-section response with source links, and confirms cancellation remains effective.
- Record that the proof of concept successfully completed a live hosted Responses web search through Pi on August 22, 2026, including a State Department Visa Bulletin query that returned the requested structured Markdown and official source URLs.

## Out of Scope

- Raw ranked web-search results.
- Exact result-count guarantees.
- Raw, verbatim, or independently verified snippets.
- Parsing or preserving Responses citation annotations or hosted web-search-call metadata.
- Arbitrary URL fetching, page opening, clicking, find-in-page, screenshots, or PDF extraction.
- Image search, finance, weather, sports, or time commands from Codex's broader private search protocol.
- API-key authentication, alternate providers, provider routing, automatic fallback, or custom endpoints.
- User-location controls or automatic location inference.
- Hard recency filters until the selected hosted Responses contract exposes one reliably.
- Blocked-domain filters that are not part of the stable hosted Responses interface.
- Exposing OpenAI model IDs, hosted-tool versions, reasoning controls, or transport controls to callers.
- Sending the parent conversation, project context, files, active tools, or system prompt to the librarian.
- Multi-turn librarian sessions, continuation IDs, or stateful internal search references.
- Automatic retries or provider failover.
- Persistent result storage, caches, source browsers, or retrieval tools.
- Slash commands, shortcuts, widgets, custom TUI rendering, or curator UI.
- Runtime Markdown parsing or strict format rejection.
- Implementing a direct OpenAI HTTP client, raw `fetch`, SSE parser, or OAuth refresh path.
- Modifying Pi's normalized message types to preserve hosted-tool metadata.
- Guaranteeing correctness, completeness, or verbatim fidelity of model-authored source remarks.

## Further Notes

- The tool is intentionally named `ask_web` rather than `web_search`. Its interface promises a sourced model-authored briefing, not a search engine response.
- “Remote web librarian” is the product metaphor. “Oracle” is rejected because it overstates certainty.
- The hosted Responses tool currently offers stable search-context size, allowed domains, and approximate user location. Only the first two are exposed because they have demonstrated value and acceptable privacy characteristics.
- Pi's normalized Responses parser currently preserves final text but not hosted `web_search_call` source arrays or output-text citation annotations. The Markdown source list is therefore produced by the nested model and must not be described as authoritative raw API metadata.
- The proof of concept demonstrated that Pi can own the entire OAuth and Responses transport path while the extension injects hosted web search and consumes only normalized text. It also demonstrated that the nested search returns Markdown links when the role prompt requires them.
- The ChatGPT subscription Responses route and hosted-tool behavior are private compatibility surfaces even though the extension uses Pi's public model-registry seam. Keep the adapter small and retain the optional live smoke check for drift.
- If future requirements demand trustworthy structured citations, the preferred next step is upstream Pi support for normalized hosted-tool results or citation content—not a second parser hidden inside this extension.
- `ready-for-agent` is the local issue tracker's implementation-ready status for this specification.
