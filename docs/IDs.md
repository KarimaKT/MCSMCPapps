# Captured project IDs

Single source of truth for IDs the WebChat / SWA / DA need. **Do not put secrets in this file** — only IDs are public-safe. Secrets go in `.env` (gitignored) or SWA Configuration.

## Copilot Studio agent (CDX tenant)

| Field | Value | Source |
|---|---|---|
| Maker portal URL | `https://copilotstudio.preview.microsoft.com/environments/61453fde-f312-e19f-b879-a2dfa518e914/bots/9d6e6825-7945-f111-bec6-7ced8dcd844a/publish` | User |
| Display name | `Eurozone Analyst` (in env `Contoso Electronics`) | observed |
| **Environment ID** | `61453fde-f312-e19f-b879-a2dfa518e914` | Parsed from URL |
| **Bot ID (GUID)** | `9d6e6825-7945-f111-bec6-7ced8dcd844a` | Parsed from URL |
| **Schema name** | `ksteam_ak001` | embed code in Channels → Web app |
| **CDX tenant ID** | `301759bc-5be1-40f1-8a44-822e286f5a9d` | User |
| Dynamics org URL | `orgea8005ed.crm.dynamics.com` | User |
| **Tenant lifespan** | Expires **August 2026** | User |
| **Connection string (CS Direct Line API)** | `https://61453fdef312e19fb879a2dfa518e9.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/ksteam_ak001/conversations?api-version=2022-03-01-preview` | Channels → Web app → M365 Agents SDK |
| **Auth mode** | Manual Entra (federated credentials, no client secret) | Phase 7b |

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
| Display name | `MCSMCPapps WebChat` | created |
| **Owning tenant** | **CDX tenant `301759bc-5be1-40f1-8a44-822e286f5a9d`** | by design |
| **Client ID** | `701e58d1-3d3b-42e8-b2a4-864ba5fe2c61` | created |
| Object ID | `5d2346cc-f71d-4c6d-843f-344b7b11c5a5` | created |
| Application ID URI | `api://701e58d1-3d3b-42e8-b2a4-864ba5fe2c61` (default) | Phase 7a.2 |
| Custom scope | `api://701e58d1-3d3b-42e8-b2a4-864ba5fe2c61/access_as_user` | Phase 7a.2 |

## How to fill the unknowns

### Direct Line token endpoint
- Open the agent at <https://copilotstudio.preview.microsoft.com>.
- **Settings** → **Channels** → look for **Direct Line** (or "Mobile / Custom"). Click **Direct Line** → **Get conversation token URL**. Copy the full URL.

### Schema name
- In the agent → **Settings** → **Advanced** → **Schema name**. It looks like `cr12345_yourAgentName`. This is what the Copilot Studio Direct Line client expects as `botId` (not the GUID).