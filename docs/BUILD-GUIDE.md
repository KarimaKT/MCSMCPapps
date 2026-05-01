# Build Guide — MCSMCPapps (no AI required)

> Step-by-step instructions to reproduce this project from scratch on a clean Windows machine. Every step is manual; no Copilot or AI tooling is required to follow it. Tested against the package versions pinned in this repo.
>
> **Estimated time:** 4–6 hours, including Azure provisioning and tenant configuration. **Reading time only:** ~30 min.

## Document conventions

- 🪟 = action in a Windows GUI / Microsoft 365 portal.
- 💻 = command to run in PowerShell 7+.
- 📝 = file you edit by hand.
- ☑️ = verification step. **Do not skip these.**

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Repository setup](#2-repository-setup)
3. [Build the WebChat UI](#3-build-the-webchat-ui)
4. [Host on Azure Static Web Apps](#4-host-on-azure-static-web-apps)
5. [Configure your Copilot Studio agent](#5-configure-your-copilot-studio-agent)
6. [Build the Declarative Agent + MCP App](#6-build-the-declarative-agent--mcp-app)
7. [Authentication & SSO](#7-authentication--sso)
8. [End-to-end test](#8-end-to-end-test)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

### Tools to install

| Tool | Version | Install command (Windows, PowerShell admin) |
|---|---|---|
| Git | 2.50+ | `winget install Git.Git` |
| GitHub CLI | 2.70+ | `winget install GitHub.cli` |
| Node.js LTS | 20.x or 22.x | `winget install OpenJS.NodeJS.LTS` |
| Azure CLI | 2.60+ | `winget install Microsoft.AzureCLI` |
| Power Platform CLI | latest | `winget install Microsoft.PowerPlatformCLI` |
| VS Code | latest | `winget install Microsoft.VisualStudioCode` |

### VS Code extensions

Install from the marketplace (search exact ID):

- `ms-copilotstudio.vscode-copilotstudio` — Copilot Studio
- `teamsdevapp.ms-teams-vscode-extension` — Microsoft 365 Agents Toolkit
- `ms-azuretools.vscode-azurestaticwebapps` — Azure Static Web Apps
- `ms-azuretools.vscode-bicep` — Bicep
- `ms-azuretools.vscode-azureresourcegroups` — Azure Resources

### Accounts you need

- ✅ A **GitHub account** with permission to create private repos.
- ✅ An **Azure subscription** (Free tier is fine; Static Web Apps Free SKU is $0).
- ✅ A **Microsoft 365 tenant** where you can sideload Custom Apps. Verify at [Teams Admin Center → Manage Apps](https://admin.teams.microsoft.com/policies/manage-apps).
- ✅ A **Power Platform environment** with a Copilot Studio license. Verify at [https://copilotstudio.microsoft.com](https://copilotstudio.microsoft.com).

### Verify the install

💻

```powershell
git --version; gh --version; node --version; npm --version; az --version | Select-Object -First 1; pac --version
```

Each command should print a version. If any fail, fix before continuing.

---

## 2. Repository setup

### 2.1 Create the repo

💻

```powershell
gh auth login              # if not already authenticated
gh repo create MCSMCPapps --private --description "Embed a Copilot Studio agent in M365 Copilot via DA + MCP App"
git clone https://github.com/<YOUR-USER>/MCSMCPapps.git
cd MCSMCPapps
```

### 2.2 Create the folder skeleton

💻

```powershell
$dirs = 'webchat-ui','mcp-app','declarative-agent','infra','docs','skills/mcp-app-launcher','.github/workflows'
$dirs | ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }
```

### 2.3 Add a license + .gitignore

📝 Create `LICENSE` (MIT). 📝 Create `.gitignore` with at minimum:

```gitignore
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
.vscode/
!.vscode/extensions.json
infra/.azure/
```

### 2.4 First commit

💻

```powershell
git add .
git commit -m "chore: initial scaffold"
git push origin main
```

☑️ Visit `https://github.com/<YOUR-USER>/MCSMCPapps` and verify the empty scaffold is there.

---

## 3. Build the WebChat UI

### 3.1 Scaffold a Vite + Vanilla TypeScript project

💻

```powershell
cd webchat-ui
npm create vite@latest . -- --template vanilla-ts
npm install
```

When prompted whether to overwrite, answer **Yes** (the directory has only the empty `.gitkeep`).

### 3.2 Install runtime dependencies

💻

```powershell
npm install botframework-webchat @azure/msal-browser
```

> The official Copilot Studio Direct Line client is `@microsoft/agents-copilotstudio-client`. As of writing it is published only as part of the Microsoft 365 Agents SDK preview; if `npm install @microsoft/agents-copilotstudio-client` fails, fall back to constructing a Direct Line connection manually using a token endpoint exposed by your CS agent (see §3.5 fallback).

### 3.3 Project files

📝 Replace `index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Copilot Studio Embedded Chat</title>
    <style>
      html, body, #webchat { height:100%; width:100%; margin:0; padding:0;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    </style>
  </head>
  <body>
    <div id="webchat" role="main" aria-label="Embedded Copilot Studio chat"></div>
    <script src="https://cdn.botframework.com/botframework-webchat/latest/webchat.js"></script>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

📝 Create `.env.example`:

```ini
VITE_CS_BOT_ID=00000000-0000-0000-0000-000000000000
VITE_CS_TENANT_ID=00000000-0000-0000-0000-000000000000
VITE_CS_ENVIRONMENT_ID=00000000-0000-0000-0000-000000000000
VITE_AAD_CLIENT_ID=00000000-0000-0000-0000-000000000000
VITE_AAD_AUTHORITY=https://login.microsoftonline.com/common
VITE_AAD_SCOPE=api://<your-cs-app-id-uri>/access_as_user
```

📝 Replace `src/main.ts` with the SSO-aware bootstrapper. *(See [webchat-ui/src/main.ts](../webchat-ui/src/main.ts) — when this guide is read in-repo, the file already exists.)*

### 3.4 Configure your IDs

💻

```powershell
Copy-Item .env.example .env
notepad .env   # fill in real GUIDs from Phase 5
```

### 3.5 Run locally

💻

```powershell
npm run dev
```

☑️ Open `http://localhost:5173`. You should see the WebChat surface. If your CS agent is reachable, typing a message returns a reply.

> If you get CORS errors, your CS agent's Direct Line / token endpoint needs `http://localhost:5173` added to its allowed origins. See §9 Troubleshooting.

---

## 4. Host on Azure Static Web Apps

### 4.1 Sign in

💻

```powershell
az login
az account show --query "{name:name,id:id,tenantId:tenantId}"
```

If the wrong tenant/sub is active:

```powershell
az account set --subscription "<SUBSCRIPTION-ID>"
```

### 4.2 Create the resource group + SWA

💻

```powershell
$RG="rg-mcsmcpapps"
$LOC="westus2"            # SWA-supported region
$NAME="swa-mcsmcpapps"

az group create -n $RG -l $LOC
az staticwebapp create -n $NAME -g $RG -l $LOC --sku Free `
  --source https://github.com/<YOUR-USER>/MCSMCPapps `
  --branch main `
  --app-location "webchat-ui" `
  --output-location "dist" `
  --login-with-github
```

The `--login-with-github` flag opens a browser to authorize Azure to push a deployment workflow into your repo.

☑️ After the command completes, visit your repo on GitHub → **Actions** tab. There should be a generated `Azure Static Web Apps CI/CD` workflow. Wait for the first run to go green.

### 4.3 Get the public URL

💻

```powershell
az staticwebapp show -n $NAME -g $RG --query "defaultHostname" -o tsv
```

Copy that value (e.g. `proud-pebble-0123abc.4.azurestaticwebapps.net`). You'll paste it into the MCP App payload in §6.2.

☑️ Open `https://<defaultHostname>/` in a browser. You should see the WebChat UI loaded with your `.env` values.

### 4.4 Set production environment variables

The `.env` file is **not** deployed (it's in `.gitignore`). Production values come from SWA application settings:

🪟 Azure Portal → your SWA → **Configuration** → **Application settings** → add each `VITE_*` value. Then re-run the workflow.

> Note: `VITE_*` vars are baked at **build** time, not runtime. SWA injects them into the build container via the workflow. If you change them later, re-run the workflow.

---

## 5. Configure your Copilot Studio agent

### 5.1 Create or open the agent

🪟 Visit [https://copilotstudio.microsoft.com](https://copilotstudio.microsoft.com) → select an environment → **Create** a new agent (or open your existing one).

### 5.2 Capture identifiers

🪟 Open the agent → **Settings → Channels → "Copilot Studio Channel"** (or *Direct Line* if available).

You need these values:

| Value | Where to find it |
|---|---|
| **Bot ID / Schema name** | Settings → Advanced → Schema name |
| **Tenant ID** | Settings → Security → shown in token audience, or your M365 tenant ID |
| **Environment ID** | URL of the maker portal: `.../environments/<ENV-ID>/...` |
| **Direct Line token endpoint** | Settings → Channels → Direct Line → Conversation token URL |

📝 Paste these into `webchat-ui/.env` (and the SWA Configuration in §4.4).

### 5.3 Enable Manual Entra authentication (required for SSO)

🪟 Settings → **Security** → **Authentication** → choose **Manual** (Entra ID). You will be asked for:

- App registration **client ID**
- App registration **client secret** (or certificate)
- **Token exchange URL** (only needed for OBO)

If you don't have an app registration yet, create one in §7.1 and come back.

☑️ Click **Save** and then **Publish** the agent.

---

## 6. Build the Declarative Agent + MCP App

### 6.1 The MCP App tool

📝 Create `mcp-app/openCopilotStudioChat.json`:

```json
{
  "name": "openCopilotStudioChat",
  "description": "Open the embedded Copilot Studio chat surface.",
  "outputs": {
    "type": "mcp_app",
    "title": "Copilot Studio Agent",
    "url": "https://<YOUR-SWA-HOSTNAME>/",
    "height": "640px"
  }
}
```

Replace `<YOUR-SWA-HOSTNAME>` with the value from §4.3.

### 6.2 Wrap it in an MCP server (if you don't already have one)

The MCP App is exposed by an MCP server. The simplest implementation is a Node TypeScript server using `@modelcontextprotocol/sdk`. Place it under `mcp-app/server/` and register a single tool that returns the JSON above.

📝 See [mcp-app/server/index.ts](../mcp-app/server/index.ts) in this repo.

### 6.3 The Declarative Agent manifest

📝 Create `declarative-agent/manifest.json`:

```json
{
  "schema_version": "v1",
  "name": "Open Copilot Studio Chat",
  "description": "Launches the embedded Copilot Studio chat surface inside Microsoft 365 Copilot.",
  "instructions": "When the user asks to open the embedded chat, the Copilot Studio agent, or 'my agent', call the openCopilotStudioChat tool. Do not summarize or paraphrase its output. Return the MCP App payload to the host.",
  "conversation_starters": [
    { "title": "Open my Copilot Studio agent" },
    { "title": "Launch embedded chat" }
  ],
  "tools": [
    { "name": "openCopilotStudioChat", "type": "mcp_app" }
  ]
}
```

### 6.4 Package via the M365 Agents Toolkit

🪟 In VS Code, open the M365 Agents Toolkit side panel → **Create New App** → **Declarative Agent**. Point it at `declarative-agent/manifest.json` and let it generate the `appPackage/` folder with `manifest.json` + icons.

🪟 Toolkit → **Provision** → signs you into M365 and registers the app in the tenant. Then **Deploy** → **Publish to current tenant**.

☑️ In M365 Copilot ([https://m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat)) you should now see your Declarative Agent in the agent picker.

---

## 7. Authentication & SSO

### 7.1 Create the App Registration

🪟 [Azure Portal → Microsoft Entra ID → App registrations → New registration](https://entra.microsoft.com)

- **Name:** `MCSMCPapps WebChat`
- **Supported account types:** Single tenant (start here; expand later)
- **Redirect URI (SPA):** `https://<YOUR-SWA-HOSTNAME>/`
- Add a second redirect URI: `https://<YOUR-SWA-HOSTNAME>/auth-redirect.html`

After creation:

- **Expose an API → Add a scope:** `access_as_user`. Application ID URI default `api://<client-id>` is fine.
- **Authentication → Implicit / hybrid grant flows:** enable **ID tokens**.
- **Authentication → Allow public client flows:** No.
- **API permissions → Add Microsoft Graph → openid, profile, offline_access** (delegated). Grant admin consent.

📝 Copy the **Application (client) ID** and **Directory (tenant) ID** into `webchat-ui/.env`:

```ini
VITE_AAD_CLIENT_ID=<client-id>
VITE_AAD_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
VITE_AAD_SCOPE=api://<client-id>/access_as_user
```

### 7.2 Wire the WebChat to MSAL

📝 In `webchat-ui/src/auth.ts` (already in repo), the silent SSO flow is:

```ts
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

const pca = new PublicClientApplication({
  auth: {
    clientId: import.meta.env.VITE_AAD_CLIENT_ID,
    authority: import.meta.env.VITE_AAD_AUTHORITY,
    redirectUri: window.location.origin
  },
  cache: { cacheLocation: 'sessionStorage' }
});

export async function getCsAccessToken(): Promise<string> {
  await pca.initialize();
  const account = pca.getAllAccounts()[0];
  const request = { scopes: [import.meta.env.VITE_AAD_SCOPE], account };
  try {
    const r = await pca.acquireTokenSilent(request);
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      const r = await pca.acquireTokenPopup(request);
      return r.accessToken;
    }
    throw e;
  }
}
```

### 7.3 Optional: try Teams JS SSO first

If the MCP App host exposes the Teams JS bridge, you can get a true silent SSO token:

```ts
import * as teams from '@microsoft/teams-js';

export async function tryTeamsSso(): Promise<string | null> {
  try {
    await teams.app.initialize();
    const token = await teams.authentication.getAuthToken();
    return token;
  } catch {
    return null;  // host doesn't expose Teams JS — fall back to MSAL
  }
}
```

Use it in `main.ts`:

```ts
const token = (await tryTeamsSso()) ?? (await getCsAccessToken());
```

### 7.4 Pass the token to your CS agent

The Bot Framework Web Chat connection needs to send the token. The simplest way is to use a **Direct Line token endpoint** that your tenant admin enables on the CS agent. The browser POSTs the bearer token to that endpoint and receives a **scoped Direct Line token** for one conversation.

📝 See [webchat-ui/src/directLine.ts](../webchat-ui/src/directLine.ts) for the wiring.

---

## 8. End-to-end test

1. ☑️ Local WebChat connects to CS agent (§3.5).
2. ☑️ Hosted WebChat at `https://<SWA>/` connects (§4.3).
3. ☑️ MCP App tool returns the correct payload (call manually via your MCP client / Inspector).
4. ☑️ Declarative Agent launches the MCP App (M365 Copilot agent picker).
5. ☑️ Long-running conversation stays alive past 30s.
6. ☑️ CEA still works alongside the DA.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| WebChat shows blank, console error `botframework-webchat` undefined | CDN script blocked or Vite stripped it | Verify CSP and that `<script src="https://cdn.botframework.com/...">` loads. |
| `AADSTS50011` redirect URI mismatch | App registration redirect URI doesn't include the SWA hostname | Add it under Authentication → Redirect URIs. |
| `403 Forbidden` from Direct Line token endpoint | Bearer token audience wrong | Verify `VITE_AAD_SCOPE` matches the API the CS agent expects. |
| MCP App iframe never renders | Tool name in DA doesn't match server tool name | Names are case-sensitive. Match `openCopilotStudioChat` exactly. |
| DA never appears in M365 Copilot | App not approved by tenant admin | Teams Admin Center → Manage Apps → set the app to **Allowed**. |
| Conversation drops after ~5 min | Direct Line token expiring | Use the *refresh* endpoint or generate token with longer TTL. |

---

## Appendix A — Manifest schemas referenced

- Declarative Agent manifest: <https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-manifest>
- M365 Agents Toolkit: <https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/teams-toolkit-fundamentals>
- Bot Framework Web Chat: <https://github.com/microsoft/BotFramework-WebChat>
- Copilot Studio Direct Line: <https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-web-channel>
- Azure Static Web Apps: <https://learn.microsoft.com/en-us/azure/static-web-apps/>

> Some of the SDKs referenced (notably `@microsoft/agents-copilotstudio-client`) are in active preview at time of writing. If APIs drift, check the matching package version in `webchat-ui/package.json`.
