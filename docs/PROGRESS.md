# Progress log

Living record of what's been done and what's next. Updated at the end of every phase.

| Phase | Title | Status | Notes |
|---|---|---|---|
| 0 | Prereqs probe | ✅ Done | Git, gh, Node, MCS + Agents Toolkit extensions OK. Az CLI / pac / SWA + Bicep extensions still missing — install when we hit Phase 4. |
| 1 | GitHub repo + scaffold | ✅ Done | `KarimaKT/MCSMCPapps` (**public**) created and cloned. Monorepo skeleton + initial docs committed. |
| 2 | Copilot Studio agent IDs | ✅ Done | Bot ID, Environment ID, **CDX tenant ID** captured (see [IDs.md](IDs.md)). Tenant expires Aug 2026. Schema name + Direct Line endpoint still TBD — captured later when we wire auth. |
| 3 | WebChat UI build | ✅ Done | Vite + TS + Bot Framework Web Chat (CDN) + MSAL + Teams JS scaffolded. `npm run build` and `npm run typecheck` both pass. SSO chain Teams JS → MSAL silent → anonymous fallback. |
| 4 | Azure subscription + SWA host | ✅ Done | SWA `swa-mcsmcpapps` deployed in `rg-mcsmcpapps` (westus2). Hostname: `icy-field-07d5bef1e.7.azurestaticapps.net`. GitHub Actions deploy token set as repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. |
| 5 | MCP server + DA manifest | ✅ Code/infra done | All Phase 5 code shipped: MCP server live at `app-mcsmcpapps-mcp.azurewebsites.net` (centralus, B1 Linux), SWA CSP allowlists widget-renderer host, Declarative Agent manifest + Agents Toolkit project scaffolded with placeholder icons. Next maker step: open `declarative-agent/` in VS Code with the M365 Agents Toolkit and run **Provision** → **Publish** to sideload to the CDX tenant. |
| 5g | Stateless MCP attempt + revert | ✅ Done | Tried sessionless MCP server to dodge "Something went wrong"; broke SDK init handshake. Reverted to session-keyed transports with proper 404 + "Session not found" recovery so clients re-init transparently after container restarts. Kept tool-level `userQuery` arg + parallel first-message handoff. |
| 5h | OpenAI Apps SDK contract fix | ✅ Done | Empty card in M365 Copilot turned out to be wrong contract: M365 Copilot today implements **OpenAI Apps SDK** widget shape, not MCP Apps spec. Fixed three things: MIME `text/html;profile=mcp-app`, `_meta["openai/outputTemplate"]` on tool, `_meta.ui.csp.frameDomains` on resource. Widget rewritten to listen for JSON-RPC `ui/notifications/tool-result` from `window.parent` + `window.openai` snapshot + `openai:set_globals` events. See [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md). Manifest v1.0.4. |
| 6 | End-to-end test | 🔄 Awaiting Publish | Manifest v1.0.4 ready to publish. Test "what's the inflation in France?" in m365.cloud.microsoft/chat — should now render the iframed SWA widget. |
| 7 | Polish skill + docs | 🔄 ongoing | `CAPABILITIES.md` written. Live-agent handoff SDK scaffolded under `webchat-ui/src/handoff/` (orchestrator + generic webhook provider; customer plugs in their broker). MCP-APPS-CONTRACT.md added (the recipe to render a widget that actually shows up). Skill updated. |

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
