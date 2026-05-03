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
| 5h | OpenAI Apps SDK contract fix | ✅ Done | Empty card in M365 Copilot turned out to be wrong contract. Verified against Microsoft's [mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples) reference: MIME is `text/html+skybridge` (not `text/html;profile=mcp-app`); tool _meta needs `openai/outputTemplate` AND `openai/widgetAccessible: true`; same `_meta` re-emitted on tool RESPONSE. Resource needs `_meta.ui.csp.frameDomains` because we iframe the SWA. Widget rewritten to listen for JSON-RPC `ui/notifications/tool-result` + `window.openai` snapshot + `openai:set_globals` events. See [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md). Manifest v1.0.5. |
| 5i | Doc set + modular code | ✅ Done | Full doc set authored: [SPEC.md](SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [TEST-PLAN.md](TEST-PLAN.md), [COMPARISON.md](COMPARISON.md), [BLOG.md](BLOG.md), [FEATURE-REQUESTS.md](FEATURE-REQUESTS.md). README rewritten as fork-and-rebrand front door. MCP server refactored into modular layout: `tools/`, `resources/`, `server.ts` factory; index.ts is HTTP host only; full JSDoc on every config field; widget.ts marked with v0.6 migration plan. Server version bumped 0.2.0 → 0.3.0. |
| 5j | Single-file widget bundle | ✅ Done | Replaced iframe-of-SWA with single-file React bundle. New `webchat-ui/src/widget/` (Widget.tsx + main.tsx + cs-connection.ts + host-bridge.ts + style-options.json). Uses `botframework-webchat` Composer + BasicWebChat (OOB) and `CopilotStudioWebChat.createConnection()` (OOB) — no hand-rolled transport. `vite-plugin-singlefile` produces `dist-widget/index.widget.html` (~5.5 MB / ~1.4 MB gzip). MCP server's `widget.ts` reads the bundle from disk at startup; CI workflow builds widget + copies to `mcp-server/dist/assets/widget.html` before deploy. Repo variables set for `VITE_*` brand + CS env params. CSP `frameDomains` removed (no sub-iframe). Customization paths documented in [WIDGET-CUSTOMIZATION.md](WIDGET-CUSTOMIZATION.md): env vars (60 sec) → styleOptions JSON (CS Kit Webchat Playground export) → React component (full flexibility). Manifest v1.0.6. |
| 5j.1 | Sandbox-friendly bundle (stripCrossorigin + production mode) | ✅ Done | Test in M365 Copilot showed: tool routed correctly on specific prompts; widget body downloaded (5.8 MB confirmed in `resources/read`); but React app never executed — blank card. Found Microsoft's `stripCrossorigin` post-transform Vite plugin in [trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts): the skybridge sandbox iframe has a null origin, so the default `<script type="module" crossorigin>` triggers a CORS check on the inline script and silently fails. Added the same plugin + forced `mode: 'production'` + `define NODE_ENV` (eliminates HMR eval blocked by sandbox CSP). Documented in [MCP-APPS-CONTRACT.md §6](MCP-APPS-CONTRACT.md), [BLOG.md "four contract details"](BLOG.md), [WIDGET-CUSTOMIZATION.md "Critical: don't break the skybridge bundle"](WIDGET-CUSTOMIZATION.md). New feature requests filed: 2.5 (document silent failures + ship the strip plugin officially) and 2.6 (make tool routing reliable for tool-only DAs). |
| 5k | D365 Omnichannel handoff | ⏳ Planned | Configure CS agent Settings → Agent transfers → Omnichannel tile. Verify M4 escalation scenario from [TEST-PLAN.md §4.4](TEST-PLAN.md#44-m4-escalation). No code on our side. |
| 7 | Polish skill + docs | 🔄 ongoing | All v0.5 docs in place. Live-agent handoff scaffold under `webchat-ui/src/handoff/` will be removed in v0.6 (we use OOB CS Omnichannel handoff instead). Skill updated. |

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
