# Progress log

Living record of what's been done and what's next. Updated at the end of every phase.

| Phase | Title | Status | Notes |
|---|---|---|---|
| 0 | Prereqs probe | ✅ Done | Git, gh, Node, MCS + Agents Toolkit extensions OK. Az CLI / pac / SWA + Bicep extensions still missing — install when we hit Phase 4. |
| 1 | GitHub repo + scaffold | ✅ Done | `KarimaKT/MCSMCPapps` (**public**) created and cloned. Monorepo skeleton + initial docs committed. |
| 2 | Copilot Studio agent IDs | ✅ Done | Bot ID, Environment ID, **CDX tenant ID** captured (see [IDs.md](IDs.md)). Tenant expires Aug 2026. Schema name + Direct Line endpoint still TBD — captured later when we wire auth. |
| 3 | WebChat UI build | ✅ Done | Vite + TS + Bot Framework Web Chat (CDN) + MSAL + Teams JS scaffolded. `npm run build` and `npm run typecheck` both pass. SSO chain Teams JS → MSAL silent → anonymous fallback. |
| 4 | Azure subscription + SWA host | ✅ Done | SWA `swa-mcsmcpapps` deployed in `rg-mcsmcpapps` (westus2). Hostname: `icy-field-07d5bef1e.7.azurestaticapps.net`. GitHub Actions deploy token set as repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. |
| 5 | MCP App tool + DA manifest | ⏳ Pending | M365 Agents Toolkit packaging, sideload via VS Code. |
| 6 | End-to-end test | ⏳ Pending | All ☑️ rows in BUILD-GUIDE §8 must pass. |
| 7 | Polish skill + docs | 🔄 ongoing | `CAPABILITIES.md` written. Live-agent handoff SDK scaffolded under `webchat-ui/src/handoff/` (orchestrator + generic webhook provider; customer plugs in their broker). Skill updated. |

## Decisions made

- **Repo visibility:** **Public** as of Phase 2.
- **Account:** `KarimaKT` (default authed GitHub user).
- **CS agent:** Existing agent in **CDX tenant** `301759bc-5be1-40f1-8a44-822e286f5a9d` (Dynamics org `orgea8005ed.crm.dynamics.com`, expires Aug 2026). IDs in [IDs.md](IDs.md).
- **No separate CEA.** The user's "CEA" reference was the CS agent itself.
- **Cross-tenant by design:** Azure hosting in personal MSA tenant `4420bedf-...`; M365 / CS in CDX tenant `301759bc-...`. Entra app reg goes in CDX tenant.
- **SSO strategy:** 3-tier fallback — Teams JS → MSAL silent → CS Auth topic.
- **Hosting:** Azure Static Web Apps (Free SKU) for the WebChat UI.
- **Skipped:** All Microsoft Foundry / AI Toolkit MCP tooling — not relevant to this pattern.

## Open questions for the user

1. **Schema name** of the CS agent (Settings → Advanced) — needed to wire the Direct Line client correctly.
2. **Direct Line token endpoint** of the CS agent (Settings → Channels) — needed before the WebChat can connect.
3. **CDX tenant admin permissions** — you confirmed you have full Global Admin in the CDX tenant, so app reg creation in Phase 7 should be friction-free.
