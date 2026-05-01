# Captured project IDs

Single source of truth for IDs the WebChat / SWA / DA need. **Do not put secrets in this file** — only IDs are public-safe. Secrets go in `.env` (gitignored) or SWA Configuration.

## Copilot Studio agent

| Field | Value | Source |
|---|---|---|
| Maker portal URL | `https://copilotstudio.preview.microsoft.com/environments/61453fde-f312-e19f-b879-a2dfa518e914/bots/9d6e6825-7945-f111-bec6-7ced8dcd844a/publish` | User |
| **Environment ID** | `61453fde-f312-e19f-b879-a2dfa518e914` | Parsed from URL |
| **Bot ID** | `9d6e6825-7945-f111-bec6-7ced8dcd844a` | Parsed from URL |
| Schema name | _TBD — capture from agent Settings → Advanced_ | Phase 2 |
| Tenant ID | _TBD — capture via `https://login.microsoftonline.com/<your-domain>/.well-known/openid-configuration` or Entra portal_ | Phase 2 |
| Direct Line token endpoint | _TBD — Settings → Channels → Direct Line_ | Phase 2 |

## Azure

| Field | Value | Source |
|---|---|---|
| Subscription ID | _TBD_ | Phase 4 |
| Subscription Tenant ID | _TBD_ | Phase 4 |
| Resource group | `rg-mcsmcpapps` | planned |
| SWA name | `swa-mcsmcpapps` | planned |
| SWA region | `westus2` | planned |
| SWA default hostname | _TBD_ | Phase 4 |

## Entra app registration (for SSO)

| Field | Value | Source |
|---|---|---|
| Display name | `MCSMCPapps WebChat` | planned |
| Client ID | _TBD_ | Phase 7 |
| Application ID URI | `api://<client-id>` (default) | Phase 7 |
| Custom scope | `access_as_user` | planned |

## How to fill the unknowns

### Tenant ID
- Quickest: in any browser where you're signed into M365, open <https://login.microsoftonline.com/_/.well-known/openid-configuration> — replace `_` with your domain (e.g. `microsoft.com`). The `issuer` field contains the tenant GUID.
- Or: Entra portal → **Overview** → "Tenant ID" tile.

### Direct Line token endpoint
- Open the agent at <https://copilotstudio.preview.microsoft.com>.
- **Settings** → **Channels** → look for **Direct Line** (or "Mobile / Custom"). Click **Direct Line** → **Get conversation token URL**. Copy the full URL.

### Schema name
- In the agent → **Settings** → **Advanced** → **Schema name**. It looks like `cr12345_yourAgentName`. This is what the Copilot Studio Direct Line client expects as `botId` (not the GUID).
