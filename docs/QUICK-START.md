# Quick start — fork, rebrand, ship in ≤ 60 minutes

> Audience: a Copilot Studio maker who already has a working CS agent and wants to surface it inside Microsoft 365 Copilot with the rich UI this repo delivers.

If you don't have a CS agent yet: build one in [Copilot Studio](https://copilotstudio.microsoft.com) first. Make sure it answers questions and (optionally) emits an Adaptive Card from at least one topic — that's how you'll know the rich rendering works end-to-end.

## Prerequisites (~5 min)

- A Microsoft 365 tenant with Copilot Studio + M365 Copilot licenses (CDX dev tenant works)
- Tenant admin access to approve the published agent
- An Azure subscription you can deploy to (App Service B1 + Static Web App Free are enough)
- Node 20 installed locally
- Azure CLI + Azure Developer CLI (`azd`) installed
- GitHub CLI (`gh`) for the deploy workflow

## Step 1 — Fork & clone (~1 min)

```pwsh
gh repo fork microsoft/MCSMCPapps --clone
cd MCSMCPapps
```

## Step 2 — Collect your six maker variables (~5 min)

Open [`docs/MAKER-CONFIG.md`](MAKER-CONFIG.md) for the full list. The minimum:

| Variable | Where to find it | Example |
|---|---|---|
| `CS_ENV_ID` | Power Platform Admin Center → Environments → your environment → Details | `61453fde-f312-...` |
| `CS_SCHEMA` | Copilot Studio → your agent → Settings → Advanced | `ksteam_ak001` |
| `M365_TENANT_ID` | Entra admin center → Overview | `301759bc-5be1-...` |
| `BRAND_AGENT_NAME` | What users see in the agent picker | `Acme Analyst` |
| `BRAND_ACCENT_COLOR` | Hex; matches your company brand | `#003399` |
| `BRAND_LOGO_TEXT` | Single character for the avatar | `A` |

> **Don't host the agent in the Default environment for production.** Default has no DLP boundary, no governance scoping, and per-user-owned agents in Default don't appear in tenant-admin maker views. They still *run* (the OBO flow uses the end user's identity, so callers can invoke the agent regardless), but admins lose oversight, and connectors authored by one user aren't visible to others. Use a named environment (Dev / Test / Prod) — see [Microsoft's environment strategy guidance](https://learn.microsoft.com/en-us/power-platform/admin/environment-strategy).

## Step 3 — Run the brand-swap script (~2 min)

```pwsh
./scripts/swap-brand.ps1 `
  -CsEnvId "61453fde-f312-..." `
  -CsSchema "ksteam_ak001" `
  -TenantId "301759bc-5be1-..." `
  -AgentName "Acme Analyst" `
  -AccentColor "#003399" `
  -LogoText "A"
```

What this does:
- Updates `mcp-server/src/config.ts` defaults (`csEnvId`, `csSchema`, `agentName`)
- Writes `webchat-ui/.env` brand vars
- Updates `declarative-agent/appPackage/manifest.json` developer/icons strings
- Updates `declarative-agent/appPackage/declarativeAgent.json` agent name
- Bumps the manifest version

You can also do these by hand if you prefer. See [`scripts/swap-brand.ps1`](../scripts/swap-brand.ps1) source.

## Step 4 — Provision Azure resources (~10 min)

```pwsh
azd auth login
azd up
```

`azd` provisions:
- **Azure App Service B1 (Linux Node 20)** — runs the MCP server. Always On enabled.
- **Azure Static Web App Free** — hosts the standalone WebChat (secondary surface, optional).
- **Application Insights** — log + diagnostic streaming.

You'll be asked to choose a resource group name and Azure region. Pick something close to your CS environment region.

## Step 5 — Configure Entra SSO via Teams Developer Portal (~10 min)

This is the only manual portal click in the flow. Without SSO, the user gets prompted to sign in inside the widget; with SSO, it's invisible.

1. Go to [Teams Developer Portal](https://dev.teams.microsoft.com) → Tools → Microsoft Entra SSO.
2. Click **+ New SSO**. Choose **Bot, message extension, or M365 Copilot agent**.
3. Set **Client ID** = the App Registration `azd up` created (find it: `az ad app list --display-name 'mcsmcpapps-*'`).
4. Set **Application ID URI** = `api://auth-<sso-reg-id>/<client-id>` (TDP fills the structure; you paste the client id at the end).
5. Save the SSO registration. Copy the **Reference ID** (a base64 token like `eyJ...`).
6. Update `declarative-agent/appPackage/ai-plugin.json`:
   ```json
   "auth": {
     "type": "OAuthPluginVault",
     "reference_id": "<paste the TDP reference id here>"
   }
   ```
7. Update App Service env vars (one-time):
   ```pwsh
   $rg = "rg-mcsmcpapps"
   $app = "app-mcsmcpapps-mcp"
   az webapp config appsettings set -g $rg -n $app --settings `
     ENTRA_TENANT_ID="<your tenant id>" `
     ENTRA_AUDIENCE="api://auth-<sso-reg-id>/<client-id>" `
     ENTRA_CLIENT_ID="<your client id>" `
     ENTRA_CLIENT_SECRET="<your client secret>"
   ```

(The full discussion of why this looks the way it does is in [`docs/decisions/0003-entra-sso-via-tdp-registration.md`](decisions/0003-entra-sso-via-tdp-registration.md).)

## Step 6 — Publish the DA to your tenant (~5 min)

```pwsh
cd declarative-agent
npx -y -p '@microsoft/teamsapp-cli@3.1.1' teamsapp publish --env dev
```

Output:
```
Publish success!
[Acme Analyst] is published successfully to Admin Portal (https://aka.ms/teamsfx-mtac).
```

## Step 7 — Tenant admin approval (~3 min, one-time per major version)

The pending agent appears at:

> `https://admin.cloud.microsoft/?#/agents/all/requested`
>
> (Microsoft 365 admin center → All agents → Requests tab)

Click your agent → **Allow**. (Subsequent updates will need re-approval too unless your tenant has trusted-publisher policies set; see [FR 1.2](FEATURE-REQUESTS.md#12-production-tenants-require-manual-admin-click-on-every-update).)

## Step 8 — Use it (~2 min)

1. Open [m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat) (Edge / Chrome, signed in as a licensed user).
2. Click the agent picker → find **Acme Analyst** (or whatever you named it).
3. Ask a question. The widget should render in the chat.
4. Click **Open analyst** → fullscreen mode with Copy / Print.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Empty card with agent header | Wrong MIME type | Make sure resource serves `text/html+skybridge` (server does this; only fails if you customized) |
| "Something went wrong" mid-session | Server returned 404 for a session id it never knew | Already handled — server is stateless |
| Widget renders but no React app loaded | `<script crossorigin>` attribute leaked through | Already handled — `stripCrossorigin` Vite plugin in `vite.widget-v2.config.ts` |
| Console shows `unsafe-eval` CSP error | Vite dev mode leaked into widget bundle | Already handled — `mode: 'production'` + `define NODE_ENV` |
| Tool routes inconsistently (sometimes the model answers itself) | M365 Copilot's host model behavior | See [FR 2.6](FEATURE-REQUESTS.md#26) — best workaround is in [`declarativeAgent.json`](../declarative-agent/appPackage/declarativeAgent.json) instructions; ~70-80% reliable |
| Host narrates after the widget renders | Platform gap — no "silent dispatcher" toggle | See [FR 2.7](FEATURE-REQUESTS.md#27); we set `content[0].text = ''` to mitigate |
| First turn very slow (~10 s) | App Service cold start + opening new CS conversation | App Service "Always On" is enabled by `azd up`; first turn after a publish is still slower than warm follow-ups |

## What ships and what doesn't

✅ This repo ships:
- All [CS-PARITY.md](CS-PARITY.md) ✅ rows: text, markdown, citations, suggested actions, AC static, AC submit, AC forms, fullscreen toolbar
- Entra SSO + OBO + PP token caching
- Per-thread CS conversation continuity (header-keyed cache)
- Print to PDF, Copy to clipboard

❌ This repo does NOT ship (limitations are platform gaps, see [FEATURE-REQUESTS.md](FEATURE-REQUESTS.md)):
- File upload from the widget (no host file picker primitive)
- Voice input/output (no host voice bridge)
- Streaming partial replies (no streaming `tools/call` channel)
- True silent dispatcher (no DA-level "respond after tool" toggle)
- Per-thread native id at the protocol layer (we approximate via `x-microsoft-ai-conversationid` header)

## Next steps

- Read [docs/CS-PARITY.md](CS-PARITY.md) to set customer expectations
- Read [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the deep technical model
- File platform asks via [docs/FEATURE-REQUESTS.md](FEATURE-REQUESTS.md) when you hit a gap
