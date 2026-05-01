# Progress log

Living record of what's been done and what's next. Updated at the end of every phase.

| Phase | Title | Status | Notes |
|---|---|---|---|
| 0 | Prereqs probe | ✅ Done | Git, gh, Node, MCS + Agents Toolkit extensions OK. Az CLI / pac / SWA + Bicep extensions still missing — install when we hit Phase 4. |
| 1 | GitHub repo + scaffold | ✅ Done | `KarimaKT/MCSMCPapps` (private) created and cloned. Monorepo skeleton + initial docs committed. |
| 2 | Copilot Studio agent IDs | 🔜 Next | Need: Bot ID, Tenant ID, Environment ID, Direct Line endpoint. Decide whether to enable Manual Entra auth now. |
| 3 | WebChat UI build | ⏳ Pending | Vite + Bot Framework Web Chat + MSAL. SSO chain Teams JS → MSAL silent → CS auth topic. |
| 4 | Azure Static Web Apps host | ⏳ Pending | Requires Az CLI install + Azure subscription. SWA Free SKU. |
| 5 | MCP App tool + DA manifest | ⏳ Pending | M365 Agents Toolkit packaging, sideload via VS Code. |
| 6 | End-to-end test | ⏳ Pending | All ☑️ rows in BUILD-GUIDE §8 must pass. |
| 7 | Polish skill + docs | ⏳ Pending | Iterate the Copilot Studio skill based on real findings. |

## Decisions made

- **Repo visibility:** Private. Flip later with `gh repo edit KarimaKT/MCSMCPapps --visibility public`.
- **Account:** `KarimaKT` (default authed GitHub user).
- **SSO strategy:** 3-tier fallback — Teams JS → MSAL silent → CS Auth topic.
- **Hosting:** Azure Static Web Apps (Free SKU) for the WebChat UI.
- **Skipped:** All Microsoft Foundry / AI Toolkit MCP tooling — not relevant to this pattern.

## Open questions for the user

1. Existing CS agent — is one already built, or do we create one in Phase 2?
2. Existing CEA — does it live in a different repo? (We won't touch it; just confirming scope.)
3. Azure subscription — which subscription / tenant should we deploy SWA into?
4. App registration — do you have permission to create one in your Entra tenant? (If not, we need a tenant admin in Phase 7.)
