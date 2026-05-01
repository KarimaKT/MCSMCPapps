# Captured project IDs

Single source of truth for IDs the WebChat / SWA / DA need. **Do not put secrets in this file** — only IDs are public-safe. Secrets go in `.env` (gitignored) or SWA Configuration.

## Copilot Studio agent (CDX tenant)

| Field | Value | Source |
|---|---|---|
| Maker portal URL | `https://copilotstudio.preview.microsoft.com/environments/61453fde-f312-e19f-b879-a2dfa518e914/bots/9d6e6825-7945-f111-bec6-7ced8dcd844a/publish` | User |
| **Environment ID** | `61453fde-f312-e19f-b879-a2dfa518e914` | Parsed from URL |
| **Bot ID** | `9d6e6825-7945-f111-bec6-7ced8dcd844a` | Parsed from URL |
| **CDX tenant ID** | `301759bc-5be1-40f1-8a44-822e286f5a9d` | User |
| Dynamics org URL | `orgea8005ed.crm.dynamics.com` | User |
| **Tenant lifespan** | Expires **August 2026** | User |
| Schema name | _TBD — capture from agent Settings → Advanced_ | Phase 2 |
| Direct Line token endpoint | _TBD — Settings → Channels → Direct Line_ | Phase 2 |

## Azure (personal Visual Studio Enterprise subscription)

| Field | Value | Source |
|---|---|---|
| Subscription name | `Visual Studio Enterprise Subscription` | User |
| **Subscription ID** | `1cd52c59-f826-45aa-8aaf-ec2cc88c077e` | User |
| **Azure tenant ID** | `4420bedf-93c9-4d60-a9f8-8627e1544058` | User |
| Resource group | `rg-mcsmcpapps` | provisioned |
| SWA name | `swa-mcsmcpapps` | provisioned |
| SWA region | `westus2` | provisioned |
| **SWA default hostname** | `icy-field-07d5bef1e.7.azurestaticapps.net` | provisioned |
| **SWA URL** | `https://icy-field-07d5bef1e.7.azurestaticapps.net/` | provisioned |

> **Cross-tenant note:** Azure (hosting) and CDX (CS agent + M365 Copilot) are separate tenants. The browser fetches static files from Azure (any origin) and authenticates against the CDX tenant for Direct Line. The Entra app registration for SSO must live in the **CDX tenant** (`301759bc-...`), not the Azure tenant.

## Entra app registration (for SSO)

| Field | Value | Source |
|---|---|---|
| Display name | `MCSMCPapps WebChat` | planned |
| **Owning tenant** | **CDX tenant `301759bc-...`** (NOT the Azure tenant) | by design |
| Client ID | _TBD_ | Phase 7 |
| Application ID URI | `api://<client-id>` (default) | Phase 7 |
| Custom scope | `access_as_user` | planned |

## How to fill the unknowns

### Direct Line token endpoint
- Open the agent at <https://copilotstudio.preview.microsoft.com>.
- **Settings** → **Channels** → look for **Direct Line** (or "Mobile / Custom"). Click **Direct Line** → **Get conversation token URL**. Copy the full URL.

### Schema name
- In the agent → **Settings** → **Advanced** → **Schema name**. It looks like `cr12345_yourAgentName`. This is what the Copilot Studio Direct Line client expects as `botId` (not the GUID).