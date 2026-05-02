# Declarative Agent

The Microsoft 365 Copilot **Declarative Agent** that opens the embedded chat. Single-purpose: it has one action that calls the `openCopilotStudioChat` tool on the MCP server, and the MCP server returns a UI widget that takes over the response surface.

✅ **Phase 5d — scaffolded.** Provision via the Microsoft 365 Agents Toolkit.

## Files

| Path | Purpose |
|---|---|
| `m365agents.yml` | Agents Toolkit project file. Drives `Provision` / `Publish` from VS Code. |
| `appPackage/manifest.json` | M365 app manifest (schema 1.22). References the DA. |
| `appPackage/declarativeAgent.json` | DA manifest (schema v1.6). One action pointing at `ai-plugin.json`. |
| `appPackage/ai-plugin.json` | API plugin manifest (v2.3). Type `McpServer` with auth `None`. URL points at the live MCP server. |
| `appPackage/color.png` | Required color icon (192×192). Placeholder Euro symbol on EU blue. |
| `appPackage/outline.png` | Required outline icon (32×32). Placeholder. |
| `env/.env.dev` | Toolkit-managed env values (Teams app ID etc.). Filled by Provision. |

## Provision + sideload (CDX tenant)

Prerequisite: install the **Microsoft 365 Agents Toolkit** VS Code extension.

1. Open this `declarative-agent/` folder in VS Code.
2. Click the toolkit icon in the activity bar.
3. **Accounts** → sign into the CDX tenant. Confirm "Custom App Upload Enabled" + "Copilot Access Enabled" both show ✅.
4. **Lifecycle → Provision** → pick environment `dev`.
5. **Lifecycle → Publish** → uploads the app package to the CDX tenant.
6. In <https://m365.cloud.microsoft/chat>, open the agent picker and select **Eurozone Analyst**.
7. Type *"Open my Eurozone analyst"* — Copilot fires the DA action, the MCP server returns the widget, the SWA WebChat loads inside the widget host.

## What you can change without re-provisioning

| Change | Where |
|---|---|
| Display name, description, conversation starters | `appPackage/declarativeAgent.json` (run Provision again to publish) |
| Tool description shown to the user | `appPackage/ai-plugin.json` |
| MCP server URL (e.g. moving the server) | `appPackage/ai-plugin.json` `runtimes[0].spec.url` |
| Icons | `appPackage/color.png`, `appPackage/outline.png` |
| Branding of the chat surface itself | `webchat-ui/.env` + GitHub Actions secrets — see [docs/MAKER-CONFIG.md](../docs/MAKER-CONFIG.md). The widget is unaffected; the WebChat inside it owns its own brand. |

## Auth model recap

The DA itself runs as the signed-in M365 user. The MCP server is **anonymous** at the moment — anyone in the tenant who can reach the DA can invoke the tool. The chat **inside** the widget enforces Entra SSO independently against the Power Platform API; see [docs/AUTH-ARCHITECTURE.md](../docs/AUTH-ARCHITECTURE.md).
