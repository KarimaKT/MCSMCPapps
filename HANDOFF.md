# Handoff guide

> One-page entry point for the contributor taking over this project. Read this first; everything else is reference.

**State at handoff (2026-05-11):** working code, working live deployment in CDX, manifest source at v1.2.0 (pending publish), docs mostly accurate with a handful known-stale entries flagged below.

---

## What you're getting

1. **This GitHub repo** — clone it, you're done.
2. **Copilot Studio agent solution `.zip`** — the Eurozone Analyst agent that this repo was built around (topics + knowledge sources + agent flow). Import it in your tenant via Power Apps maker portal → Solutions → Import. **Use this as a working reference, or swap it out for any other Copilot Studio agent — see [Agent flexibility](#agent-flexibility) below.**
3. **Custom connector solution `.zip`** — "ECB Rates and FX" connector (despite the name, it hits both the ECB SDMX API and Eurostat). Imported the same way. Only relevant if you keep the Eurozone agent; drop it if you swap.

Both zips are shared separately. Solutions don't carry credentials; you re-authenticate the connector after import.

## Agent flexibility

**The Eurozone Analyst agent is an example, not a requirement.** This whole repo is reusable for any Copilot Studio agent that:

- Lives in a Power Platform environment you can reach (not Default — see the warning at the bottom of QUICK-START Step 2).
- Has a schema name and you know the environment GUID.
- Talks to users in natural language (topics, knowledge sources, AI flows — the standard CS surface).

To swap in a different agent:

1. **Skip the Eurozone solution zip import.** Use your own agent directly.
2. Run [`scripts/swap-brand.ps1`](scripts/swap-brand.ps1) with your agent's env id, schema, and tenant id — it updates `mcp-server/src/config.ts` defaults, `webchat-ui/.env` brand vars, and the DA manifest in one shot.
3. Edit [`declarative-agent/appPackage/declarativeAgent.json`](declarative-agent/appPackage/declarativeAgent.json) `name`, `description`, `instructions`, `conversation_starters` to match your agent's purpose.
4. Edit [`declarative-agent/appPackage/manifest.json`](declarative-agent/appPackage/manifest.json) `id` (new GUID), `developer.*`, and `version` (start at `1.0.0` per ADR 0005 — must not start with `0`).
5. The MCP server code is agent-agnostic. The only places where "Eurozone" appears are display strings and the running example in docs/diagrams — keep them or replace them, both work.

What **doesn't** change when you swap agents:

- The MCP server logic (`mcp-server/src/`) — calls whatever CS agent the env vars point at.
- The widget bundle (`webchat-ui/src/widget-v2/`) — renders whatever `structuredContent` the server emits.
- The auth pattern (server-side OBO with the user's M365 identity).
- The locked-contract surface (tool names and schemas in `ai-plugin.json`).

What **does** change:

- The Adaptive Cards your agent emits will look different — they pass through verbatim.
- The branding env vars (`VITE_BRAND_*`) and the `AGENT_NAME` App Service setting.
- DA `instructions` and `conversation_starters` in [`declarativeAgent.json`](declarative-agent/appPackage/declarativeAgent.json).
- Manifest GUID and developer info.

---

## What you need

| Requirement | Note |
|---|---|
| Microsoft 365 tenant with Copilot license | Your own. CDX dev tenants work and are free to spin up — see ["No Azure tenant yet?"](#no-azure-tenant-yet) below. |
| Tenant admin access | To approve the published declarative agent. |
| Azure subscription | For App Service B1 (~$13/mo) + SWA Free + App Insights. |
| Power Platform environment | One non-Default environment in your tenant for the CS agent. |
| Node latest LTS | Tested on Node 20/22; later LTS should work. |
| Tooling | Azure CLI (`az`), GitHub CLI (`gh`), Microsoft 365 Agents Toolkit VS Code extension. |

### No Azure tenant yet?

If you don't have an Azure subscription, two cheapest paths:

- **CDX (Microsoft-internal)** — Microsoft FTEs can request a Customer Demo Experience tenant at [cdx.transform.microsoft.com](https://cdx.transform.microsoft.com). 90-day expiry, free, comes with M365 + Copilot Studio + Azure trial credits. The original was built on a CDX `M365 Copilot - Enabled` tenant.
- **Free trial** — [azure.microsoft.com/free](https://azure.microsoft.com/free) gives ~$200 credit + 12 months of B1 App Service free. Pair with a Microsoft 365 Developer Program tenant ([developer.microsoft.com/microsoft-365/dev-program](https://developer.microsoft.com/microsoft-365/dev-program)) for the M365 side.

Either way you need **two tenant boundaries** that can be the same tenant or different ones:
- **Azure tenant** — hosts the App Service + Static Web App
- **M365 tenant** — hosts Copilot Studio + the published declarative agent + Power Platform environment

The original deployment uses **cross-tenant** (Azure in a personal MSA, M365 in CDX) and it works fine. Single-tenant is simpler — start there if you have the choice.

---

## Day 1 — read these, in order (≈45 min)

1. [`README.md`](README.md) — what the project is
2. [`docs/QUICK-START.md`](docs/QUICK-START.md) — the 8-step setup recipe
3. [`docs/AUTH-ARCHITECTURE.md`](docs/AUTH-ARCHITECTURE.md) — the only complicated part
4. [`docs/decisions/`](docs/decisions/) — five short ADRs explaining major design pivots
5. [`docs/PROGRESS.md`](docs/PROGRESS.md) — phase-by-phase log + "Deferred work" + "Next publish to CDX"
6. [`docs/SMOKE-CHECKLIST.md`](docs/SMOKE-CHECKLIST.md) — twelve smoke tests you'll run after deploy

Do NOT start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) or [`docs/WIDGET-CUSTOMIZATION.md`](docs/WIDGET-CUSTOMIZATION.md) — they were last rewritten 2026-05-11 to match the current architecture; flag any drift you spot back to me.

---

## Day 2 — get it running in your tenant

Walk through [`docs/QUICK-START.md`](docs/QUICK-START.md) end to end. Summary:

1. Clone repo, `npm i` in `mcp-server/` and `webchat-ui/`.
2. Provision Azure resources from [`infra/main.bicep`](infra/main.bicep) — there's no `azd up` here; deploy with plain Bicep (see [`infra/README.md`](infra/README.md) for the one-liner).
3. **If using the Eurozone agent:** import the two CS solution zips in Power Apps maker portal. **If using your own agent:** skip this step; just note your agent's environment id and schema name.
4. If you imported the ECB Rates and FX connector: re-authenticate it (Test tab → sign in). If you swapped agents, ignore.
5. Create your Entra app registration via Teams Developer Portal SSO ([docs/AUTH-ARCHITECTURE.md "Setup checklist"](docs/AUTH-ARCHITECTURE.md)).
6. Run [`scripts/swap-brand.ps1`](scripts/swap-brand.ps1) with your env id, schema, tenant id, and agent display name — it updates `config.ts`, `webchat-ui/.env`, the DA manifest, and `appPackage/manifest.json` in one shot.
7. Edit [`declarative-agent/appPackage/manifest.json`](declarative-agent/appPackage/manifest.json): your own `id` (new GUID), your own developer info, version `1.0.0`.
8. Edit [`declarative-agent/appPackage/declarativeAgent.json`](declarative-agent/appPackage/declarativeAgent.json): `name`, `description`, `instructions`, `conversation_starters` to match your agent.
9. Set GitHub Actions secrets so CI deploys (publish profile + SWA token).
10. Push to main → CI builds + smoke-tests + deploys the MCP server.
11. Publish the declarative agent via Agents Toolkit → Provision → Publish.
12. Approve in Microsoft 365 admin center → All agents → Requests.
13. Smoke test S01 from [docs/SMOKE-CHECKLIST.md](docs/SMOKE-CHECKLIST.md) within 30 sec of approval. If it fails, revert.

---

## What is current

- **Manifest source** is `v1.2.0` in [`declarative-agent/appPackage/manifest.json`](declarative-agent/appPackage/manifest.json). This carries the schema fixes from commit `53db27b` and the new `submitAdaptiveCardAction` tool declaration. **Not yet published** to CDX — the admin queue was empty as of last check.
- **Server code** ships from commit `aeeb878`. CI gates pre-deploy with a locked-contract smoke test ([`mcp-server/scripts/smoke-mcp.mjs`](mcp-server/scripts/smoke-mcp.mjs)) so drift between `tools/list` and the manifest dies in CI, not production.
- **Architecture** is the **data-widget pattern** ([ADR 0001](docs/decisions/0001-chat-in-chat-was-wrong.md)): server calls Copilot Studio Direct Engine, widget renders the structured payload. The earlier "chat-in-chat" widget (BotFramework Web Chat in the iframe) was abandoned; if any doc says otherwise it's stale.
- **Auth** is server-side Entra SSO + OBO ([ADR 0003](docs/decisions/0003-entra-sso-via-tdp-registration.md)). The browser MSAL fallback is gone — it doesn't work inside the skybridge sandbox.

---

## Known incomplete work

Tracked formally at [`docs/PROGRESS.md` → "Deferred work"](docs/PROGRESS.md). Highlights:

| Item | Status | Why deferred |
|---|---|---|
| v0.7.3 escalation banner UI | server-side detection shipped (additive), widget banner pending | Needs CDX with a topic that emits `Handoff` — left for the next dev |
| v1 widget tree cleanup | half done | The remaining `webchat-ui/src/widget/` deletion is blocked on the WIDGET-CUSTOMIZATION rewrite, which is now done — safe to delete now if you want |
| Post-deploy live smoke against App Service | not started | Needs a service-principal token mint in CI; CI today smokes only the local build |

---

## Code modularity audit (2026-05-11)

| File | Lines | Verdict |
|---|---|---|
| [`mcp-server/src/cs.ts`](mcp-server/src/cs.ts) | 675 | Long, one cohesive concern (CS Direct Engine drain loop + activity normalizer). Don't split — readability is good, the seams aren't natural. |
| [`webchat-ui/src/widget-v2/main.tsx`](webchat-ui/src/widget-v2/main.tsx) | 831 | Long single React file. Could split into `<ReplyText>`, `<Citations>`, `<AdaptiveCardHost>`, `<EscalationBanner>` etc., but at risk of breaking the shipped product without an end-to-end test harness. Defer. |
| [`mcp-server/src/tools/*.ts`](mcp-server/src/tools/) | 250-325 each | Fine. The `LOCKED CONTRACT` comment blocks make them self-documenting. |
| [`mcp-server/src/auth.ts`](mcp-server/src/auth.ts) | 300 | Fine. Single responsibility: JWT validate + OBO exchange. |
| [`mcp-server/src/index.ts`](mcp-server/src/index.ts), [`mcp-server/src/server.ts`](mcp-server/src/server.ts), [`mcp-server/src/config.ts`](mcp-server/src/config.ts) | <200 each | Excellent. Adding a tool = one file in `tools/` + one line in `server.ts`. |

**Verdict: code is human-understandable, modular enough to extend.** Don't refactor for its own sake. If a future need forces a split (e.g. adding a third tool that shares CS logic), refactor *then*.

---

## When things break

1. **Live MCP endpoint:** `https://app-mcsmcpapps-mcp.azurewebsites.net/mcp` (or whatever your tenant resolved to).
2. **File logger output** on App Service: `/home/LogFiles/Application/mcsmcpapps.log` — see [docs/SMOKE-CHECKLIST.md "Server-side log spot-checks"](docs/SMOKE-CHECKLIST.md) for the Kudu fetch incantation.
3. **Pre-deploy contract drift** is caught by [`mcp-server/scripts/smoke-mcp.mjs`](mcp-server/scripts/smoke-mcp.mjs). Run locally: build the server, start it on port 3001 with placeholder env vars, then `node scripts/smoke-mcp.mjs http://localhost:3001/mcp --manifest ../declarative-agent/appPackage/ai-plugin.json`. 27 assertions; if any fails, fix before committing.

---

## When you change a tool descriptor

Read [`.github/copilot-instructions.md`](.github/copilot-instructions.md) "Locked contract surface" first. Tool name / arg names / arg types / arg optionality / tool description / tool count / `openai/outputTemplate` URI / MIME are all part of the published manifest snapshot. Changing them without bumping `declarative-agent/appPackage/manifest.json` version + re-approving will silently corrupt host LLM routing. The May-4 incident in [ADR 0005](docs/decisions/0005-arg-optionality-is-locked.md) is the cautionary tale.

The smoke gate catches drift between server and source manifest. It does NOT catch drift between source manifest and **published** manifest in the tenant — that's manual: bump version, publish, approve, re-smoke.

---

## When you need to reach me

The conversation history with Copilot/Claude that built this is in the user's chat history; ask Karima for context if anything in the ADRs or specs is unclear. The single most important thing to internalize before changing anything is **read the spec / ADR before you write code** — every regression in this project's history came from skipping that.
