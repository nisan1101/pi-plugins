# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues at
https://github.com/nisan1101/pi-plugins/issues. Use the `gh` CLI for all
operations.

## Conventions

- Run `gh` inside this repository so it infers `nisan1101/pi-plugins`.
- Create: `gh issue create --title "..." --body-file <file>`
- Read: `gh issue view <number> --json body,labels,comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body-file <file>`
- Apply or remove labels with `gh issue edit`.
- Close with `gh issue close`.

Use temporary body files for multiline issue and comment bodies.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `nisan1101/pi-plugins`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The map is one GitHub issue with child issues as tickets.

- Use GitHub sub-issues when available.
- Represent blocking relationships with GitHub’s native issue dependencies.
- If native relationships are unavailable, record `Blocked by: #<number>` in
  the child issue body.
- Claim work by assigning the issue to the driving developer.
- Resolve work by posting the answer and closing the issue.
