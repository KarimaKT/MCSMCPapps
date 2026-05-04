# MCSMCPapps – AI agent guardrails

This file applies to all chat / agent work in this repo.

## Default rule: spec before code

Non-trivial change = needs a spec under `docs/specs/<id>-<slug>.md` first. "Non-trivial" =
- Changes a public contract (manifest, tool schema, widget _meta)
- Changes the architecture (transport, auth, widget pattern)
- New dependency, new env var, new infra resource
- Anything that needs to be deployed

Trivial = bug fix in a known-good area, doc tweak, refactor inside one file. Skip the spec.

## Architecture decisions: ADRs

Every architecture decision (good or bad, one-shot or pivot) gets a short ADR under `docs/decisions/<id>-<slug>.md`. Write them WHEN the decision is made, not after, so we don't redo the same mistake. Keep them under one page.

## Citation discipline (matters most)

When designing against an external platform (M365 Copilot, MCP, Entra, etc.) — cite the source you read. Inline the URL in the spec. If you didn't actually read it, say "needs to verify" instead of guessing the JSON shape. See `/memories/code-review-discipline.md`.

## Read official samples BEFORE writing SDK / platform code

For any Microsoft Agents SDK call (`@microsoft/agents-copilotstudio-client`, `@microsoft/agents-activity`, MCP-Apps, declarative agents): open the matching sample in `github.com/microsoft/Agents/samples` or `github.com/microsoft/mcp-interactiveUI-samples` end-to-end FIRST. Find the canonical exit signal, contract shape, error semantics. Don't invent a drain loop / timeout / signal that the sample already shows.

Concrete past mistake: hand-rolled CS streaming drain with idle timeouts. The MS sample shows `if (activity.type === ActivityTypes.EndOfConversation) break` — five seconds of reading saved hours of debug. Sample-first applies to SDK calls, _meta keys, manifest fields, anywhere the platform has an opinion.

If no sample matches your case, mark "needs to verify" in the spec.

## Branching

- `main` — only ever has working, reviewed code
- `<topic>` branches — feature / pivot / fix; merged via PR
- Don't push half-baked diagnostics straight to `main`. Push to a topic branch, deploy from there if needed, merge when verified

## Customer / maker / contributor: three audiences

Read carefully who you're writing for:
- `delivery/` is the **customer / maker** facing kit. Plain language, fewest possible steps, "what to do" not "why."
- `docs/` is for the **contributor** working on the kit itself. Architecture, decisions, debugging.
- The two repos will eventually split: this one stays as reference; a separate `mcsmcpapps-delivery` repo holds the parameterized kit.

## What an "agent step" looks like in this repo

Each subagent under `.github/agents/` has a single responsibility. The PM agent interviews and drafts specs. The researcher fetches and cites docs. The architect reviews proposed designs. The reviewer checks PRs against the spec. The deploy agent runs the deploy + verify + rollback runbook.

If you're acting as one of those roles, stay in role. Don't have the researcher write code; don't have the engineer skip the spec.

## Tools

- Use `manage_todo_list` for any multi-step task. Mark todos in-progress / completed as you go.
- Use the file logger output (`/home/LogFiles/Application/mcsmcpapps.log` on App Service) for ground truth, not ad-hoc theory.
- Don't push commits with WIP names like "fix" or "test" — write what changed and why.

## Anti-patterns from the May 3 incident

- Wrote `[architecture] is Path A` then started executing without writing it down or getting approval.
- Made platform claims (`structuredContent` flows through, `_meta` does not) before testing them.
- Committed 8 piecewise diagnostic patches to `main` instead of one branch.
- Did not write ADRs for the stateless-transport pivot or the Entra-SSO-via-TDP path.

If any of these happen again, stop and write the missing artifact before more code.
