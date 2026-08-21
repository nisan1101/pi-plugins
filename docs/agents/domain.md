# Domain Docs

This repository uses the single-context layout.

## Before exploring, read these

- `CONTEXT.md` at the repository root
- Relevant ADRs under `docs/adr/`

If these files do not exist, proceed silently. Domain documentation is created lazily when terminology or architectural decisions are resolved.

## File structure

- `CONTEXT.md` contains the project glossary and domain model
- `docs/adr/` contains architectural decision records

## Use the glossary's vocabulary

Use terms as defined in `CONTEXT.md` in issue titles, specifications, tests, refactoring proposals, and hypotheses. Avoid synonyms the glossary explicitly rejects.

If a needed concept is absent, reconsider whether the term belongs or note the gap for domain modeling.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
