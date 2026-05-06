# ADR 0005 — tool input arg optionality is part of the locked-contract surface

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-05-04 |
| Deciders | Karima |
| Related spec | — (post-mortem of [v0.7.2e → v0.7.3a](../PROGRESS.md)) |

## Context

On 2026-05-04 around 15:55 UTC, a production failure was observed in
M365 Copilot against the published declarative agent at manifest v1.1.4:

- The host LLM emitted the tool's input arguments **as plaintext into
  the chat thread** (`<openCopilotStudioChat userQuery="…" dateTime="…"
  userLocale="…">`) instead of invoking the tool. `dateTime` and
  `userLocale` are not in our schema — the model had hallucinated them.
- App Service logs (`/home/LogFiles/Application/mcsmcpapps.log`) showed
  many `[auth] token verified` entries (host calling `initialize` and
  `tools/list`) but **zero** `[tool] openCopilotStudioChat invoked`
  entries. The model was not actually calling the tool; only describing
  the call in chat.
- The user-facing symptom was an unbranded "tool conflict" narration in
  M365 Copilot.

The change that triggered it was commit
[`0db7068` v0.7.2e: make conversationId required (allow empty string) — kills 'tool conflict' narration](https://github.com/KarimaKT/MCSMCPapps/commit/0db7068).
That commit flipped the Zod schema's `conversationId` field from
`z.string().optional()` to `z.string()` (required), reasoning that the
manifest was already in production with the old schema and it would be a
no-op for callers who passed empty strings.

It was not a no-op. The published manifest v1.1.4 (and v1.1.5) was
admin-approved with `conversationId` **not declared at all** in
`runtimes[].spec.x-mcp_tool_description.tools[0].inputSchema` — only
`userQuery` was listed, and not even marked `required`. The host LLM
uses that admin-approved snapshot of the tool catalog to plan calls.
After the v0.7.2e change, the live `tools/list` response said
`conversationId` was required. The host's cached catalog had **never
seen the field at all**. That mismatch confused the host model into
emitting describe-the-tool text instead of an actual JSON-RPC
`tools/call`.

> **Update 2026-05-06.** This drift was discovered by the new
> `--manifest` cross-check flag in `mcp-server/scripts/smoke-mcp.mjs`,
> which compares the source `ai-plugin.json` against the server's
> `tools/list`. Two pre-existing drifts surfaced: `userQuery` not
> marked required in the manifest, and `conversationId` not declared
> at all. Both were latent — host LLM happened to do the right thing
> because the tool description told it what to pass. The manifest
> source was fixed in the same commit that added
> `submitAdaptiveCardAction` to the manifest (verified against
> MS reference samples). Next publish must bump `manifest.json` from
> 1.1.5 to 1.2.0 with admin re-approval. See PROGRESS.md "Next
> publish" section.

Compounding factor: the tool description and per-arg descriptions had
ballooned to multi-paragraph DA-style prose. Long verbose tool
descriptions are known (May-3 incident, separate occurrence) to push the
host LLM into describe-instead-of-call mode even without a schema
mismatch.

References:
- Repo rule on locked contracts: [`.github/copilot-instructions.md`](../../.github/copilot-instructions.md) "Locked contract surface (May 4 incident)"
- Recovery commit: `03acb9f v0.7.3a: REVERT v0.7.2e schema change + shorten tool description (recovery)`
- Inline source-side guardrail (already in code): [mcp-server/src/tools/openCopilotStudioChat.ts](../../mcp-server/src/tools/openCopilotStudioChat.ts) — the big `LOCKED CONTRACT` comment block above `server.registerTool(...)`

## Decision

**The optionality of every tool input argument is part of the locked
manifest contract. Changing `.optional()` → required, or required →
`.optional()`, requires a manifest version bump + tenant admin
re-approval, exactly the same as renaming an arg or changing its type.**

The "Locked contract surface" list in `.github/copilot-instructions.md`
already had this rule (item 2: "Tool input schema: arg names, arg types,
arg optionality"). This ADR formalizes the rule with the post-mortem
evidence and points future readers at the source-side comment block.

Additional rule (companion to the optionality lesson): **keep the tool
`description` field one short imperative sentence.** Behavioral rules
("ALWAYS pass conversationId on follow-ups", "treat the user's text
verbatim", etc.) belong in the DA `instructions` field, not in the tool
description. Tested both directions in production:

- Verbose tool description → host LLM gets pushed into describe-instead-
  of-call mode, especially on prompts that don't precisely match its
  internal cue patterns.
- Terse imperative tool description + behavior in DA `instructions` →
  reliable invocation.

## Consequences

Easier:
- Anyone reading the source can see the locked block (already in
  `openCopilotStudioChat.ts`) and hit `git blame` to find this ADR
  before changing arg shapes.
- The recovery recipe is captured: revert the schema, shorten the
  description, ship as a server-only change (no DA republish).

Harder:
- We cannot iterate on schema "as a safe optimization" between manifest
  publishes. Every flip from optional to required (or vice versa)
  forces an admin-approval roundtrip — which is itself friction
  documented in [FEATURE-REQUESTS.md §1.1](../FEATURE-REQUESTS.md).
- Any contributor not familiar with the May-4 incident might still
  reach for the "obvious" optionality flip. Mitigation: the
  `LOCKED CONTRACT` comment block in source + this ADR + B3
  (`contracts.lock` CI guard, see [docs/PROGRESS.md "deferred work"](../PROGRESS.md)).

## Alternatives considered

- **Add a runtime adapter that accepts both required-and-empty AND
  optional-and-missing.** Rejected. The bug isn't input parsing — the
  bug is the host LLM seeing a schema-shape mismatch with its cached
  catalog and refusing to call. Server-side coercion can't fix that.
- **Bump manifest version on every server change so optionality changes
  are always covered.** Rejected. Admin re-approval is high-friction in
  customer tenants (see [FEATURE-REQUESTS.md §1.2](../FEATURE-REQUESTS.md)).
  Better to keep server-only changes possible by treating the locked
  surface as a hard rule, not a default-deny.
- **Migrate to a schema-less tool that takes one `Record<string, unknown>`
  bag of args.** Rejected. The host LLM needs typed schemas to plan
  calls correctly; schema-less tools degrade routing reliability.

## Pre-deploy checklist (added to repo guardrails)

Before any commit that touches `mcp-server/src/tools/*.ts`, ask:

1. Did I change a name, type, or **optionality** of any input arg?
   → manifest bump + re-approval required.
2. Did I add or remove a tool? → manifest bump required.
3. Did I rewrite the tool description? → consider whether the host LLM
   needs to relearn how to call it. Often forces a manifest bump even
   if technically the schema didn't change.
4. After deploy, hit smoke check `S01` from
   [SMOKE-CHECKLIST.md](../SMOKE-CHECKLIST.md) within 30 seconds. If it
   fails, REVERT immediately.

The `contracts.lock` CI guard (B3 in PROGRESS deferred work) automates
items 1–3.
