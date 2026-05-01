# WebChat UI

Vite + Bot Framework Web Chat surface that connects to your Copilot Studio agent. Hosted on Azure Static Web Apps; loaded by the MCP App tool inside Microsoft 365 Copilot.

🚧 **Phase 3 — not yet scaffolded.** See [../docs/BUILD-GUIDE.md §3](../docs/BUILD-GUIDE.md#3-build-the-webchat-ui).

Will contain:

- `package.json` — Vite + TypeScript + `botframework-webchat` + `@azure/msal-browser` + `@microsoft/teams-js`
- `index.html`
- `src/main.ts` — bootstrap
- `src/auth.ts` — 3-tier SSO (Teams JS → MSAL silent → CS auth topic fallback)
- `src/directLine.ts` — Direct Line token exchange
- `.env.example`
