# Progress log

Living record of what's been done and what's next. Updated at the end of every phase.

| Phase | Title | Status | Notes |
|---|---|---|---|
| 0 | Prereqs probe | ✅ Done | Git, gh, Node, MCS + Agents Toolkit extensions OK. Az CLI / pac / SWA + Bicep extensions still missing — install when we hit Phase 4. |
| 1 | GitHub repo + scaffold | ✅ Done | `KarimaKT/MCSMCPapps` (**public**) created and cloned. Monorepo skeleton + initial docs committed. |
| 2 | Copilot Studio agent IDs | 🔄 In progress | Bot ID + Environment ID captured (see [IDs.md](IDs.md)). Still need: Tenant ID, Schema name, Direct Line endpoint. |
| 3 | WebChat UI build | ✅ Done | Vite + TS + Bot Framework Web Chat (CDN) + MSAL + Teams JS scaffolded. `npm run build` and `npm run typecheck` both pass. SSO chain Teams JS → MSAL silent → anonymous fallback. |
| 4 | Azure subscription + SWA host | 🔄 In progress | VS Enterprise credits activated. Need to identify the new sub ID (browser → portal subscriptions blade). |
| 5 | MCP App tool + DA manifest | ⏳ Pending | M365 Agents Toolkit packaging, sideload via VS Code. |
| 6 | End-to-end test | ⏳ Pending | All ☑️ rows in BUILD-GUIDE §8 must pass. |
| 7 | Polish skill + docs | ⏳ Pending | Iterate the Copilot Studio skill based on real findings. |

## Decisions made

- **Repo visibility:** **Public** as of Phase 2.
- **Account:** `KarimaKT` (default authed GitHub user).
- **CS agent:** Existing agent at `https://copilotstudio.preview.microsoft.com/environments/61453fde-.../bots/9d6e6825-.../publish` (the `preview` host indicates the early/Wave-2 maker portal). IDs captured in [IDs.md](IDs.md).
- **No separate CEA.** The user's "CEA" reference was the CS agent itself.
- **SSO strategy:** 3-tier fallback — Teams JS → MSAL silent → CS Auth topic.
- **Hosting:** Azure Static Web Apps (Free SKU) for the WebChat UI.
- **Skipped:** All Microsoft Foundry / AI Toolkit MCP tooling — not relevant to this pattern.

## Open questions for the user

1. **Tenant ID** — fastest way to get it is `https://login.microsoftonline.com/microsoft.com/.well-known/openid-configuration` (replace `microsoft.com` with your tenant's domain). Look at the `issuer` field.
2. **Azure subscription** — in progress; see Phase 4 walkthrough.
3. **App registration permissions** — can you create app registrations in your Entra tenant, or do you need a tenant admin? (matters for Phase 7 SSO)
