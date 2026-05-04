# Spec NNNN — <slug>

> One sentence summary of what this delivers and to whom.

| Field | Value |
|---|---|
| Status | draft / in review / approved / shipped / superseded |
| Owner | name |
| Reviewer | name |
| Created | YYYY-MM-DD |
| Target | version / milestone |
| Supersedes | — / spec NNNN |

## Goal

Why this exists. The user-visible outcome we're going for.

## Non-goals

What's explicitly out of scope. Forces clarity.

## User flow

Numbered steps from the user's POV. Include screenshots / sketches where useful.

## Contracts

- HTTP / API shapes
- File formats
- Manifest fields
- Anything cross-component must be pinned here, with an example payload

## Sources / verified references

Bullets with URLs to specs, docs, or sample code we read. If the design depends on external behavior, the source goes here. "I think" or "I assume" is not allowed in this section.

## Implementation plan

Numbered steps the engineer follows. Each step:
- What changes (paths)
- What it depends on (previous steps, env, infra)
- How to verify it works in isolation

## Test plan

How we know it works. Include:
- Manual tests (in M365 Copilot, on the standalone SWA, etc.)
- Automated tests if any
- Performance targets (latency budgets, bundle size)

## Rollout

- Branch name
- Manifest version bump (if any)
- App Service env var changes (if any)
- Any DA republish / consent prompt
- Customer-visible behavior change

## Risks and rollback

- Things that could go wrong
- Rollback path: revert which commit, re-deploy what
- Time to detect / time to recover

## Open questions

Bullet list. Resolve before status = approved.
