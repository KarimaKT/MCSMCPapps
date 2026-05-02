# Authentication architecture

> The single hardest thing about this pattern is keeping straight which auth boundary applies to which actor. This doc is the authoritative answer. Every other doc points here.

## Six actors, four trust boundaries

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ① Microsoft 365 Copilot host                                               │
│     - Browser session of a user signed into M365 (CDX tenant)               │
│     - Decides which Declarative Agent to invoke based on user prompt        │
│                                                                             │
│  ──────────────────────── boundary 1 ────────────────────────                │
│                                                                             │
│  ② Declarative Agent (DA)                                                   │
│     - JSON manifest sideloaded into M365 Copilot                            │
│     - Has actions[] referencing the MCP server                              │
│     - Auth: handled by Copilot host; user is already authenticated to M365  │
│                                                                             │
│  ──────────────────────── boundary 2 ────────────────────────                │
│                                                                             │
│  ③ MCP server (Azure Function)                                              │
│     - Exposes `openCopilotStudioChat` tool                                  │
│     - Returns _meta.ui.resourceUri pointing at the WebChat                  │
│     - Auth: anonymous (dev) OR OAuth 2.1 / Entra SSO (prod)                 │
│                                                                             │
│  ──────────────────────── boundary 3 ────────────────────────                │
│                                                                             │
│  ④ Widget host (Microsoft-managed)                                          │
│     - https://{hashed-mcp-domain}.widget-renderer.usercontent.microsoft.com │
│     - Loads our SWA in an isolated origin; no shared cookies with Copilot   │
│     - Auth: nothing here; just an HTML loader                               │
│                                                                             │
│  ──────────────────────── boundary 4 ────────────────────────                │
│                                                                             │
│  ⑤ WebChat (this repo)                                                      │
│     - Loaded inside the widget host iframe                                  │
│     - Acquires Power Platform API token via MSAL silent SSO                 │
│     - Same browser session as ①, so silent SSO succeeds                     │
│                                                                             │
│  ──────────────────────── boundary 5 ────────────────────────                │
│                                                                             │
│  ⑥ Copilot Studio agent (Wave-2 Direct Engine)                              │
│     - Validates Bearer token: must be signed by the CS tenant Entra,        │
│       audience https://api.powerplatform.com,                               │
│       scope CopilotStudio.Copilots.Invoke                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The non-obvious bit (this is what trips everyone)

**The MCP server's auth controls who can invoke its tools. It does NOT control who can use the chat.**

| Boundary | What's authenticated | Why |
|---|---|---|
| ② DA → ③ MCP | The DA's identity (Copilot host on behalf of the user) | Anonymous MCP = anyone in the tenant who can reach the DA can call the tool |
| ⑤ WebChat → ⑥ CS | The user's Entra identity in the CS tenant | This is where the chat session is actually authenticated |

The ③ ↔ ⑥ link **does not exist at all**. The MCP server hands Copilot a URL; Copilot loads that URL in the widget host; the WebChat inside that URL talks to the CS agent **directly**, using the user's already-active M365 browser session via MSAL silent SSO.

## Why anonymous MCP is fine for dev

Concern: "If anonymous, isn't the chat unauthenticated?"

Answer: **No.** Anonymous MCP just means the *tool call* itself isn't authenticated. The chat that the tool *renders* still requires Entra SSO at boundary 5. The user can't talk to the CS agent without a valid Power Platform API token.

Concrete failure modes you should expect:
- ❌ Anonymous user (no M365 session) opens the SWA URL → MSAL silent fails → chat shows "Authentication failed" banner.
- ❌ Authenticated user but missing `CopilotStudio.Copilots.Invoke` consent → CS rejects with `403`.
- ✅ Authenticated CDX user with consented app → silent SSO → chat connects.

## What anonymous MCP loses you

| Capability | Anonymous MCP | Auth'd MCP (OAuth 2.1 / Entra SSO) |
|---|---|---|
| Audit "who clicked the launcher" | ❌ | ✅ |
| Per-user MCP tool gating | ❌ | ✅ |
| Multi-tenant MCP server | ❌ | ✅ |
| Pass user identity from MCP to a downstream system | ❌ | ✅ (via OBO) |

For a single-tenant CDX demo, none of these matter. Add Entra SSO later when productizing.

## The CS-tenant Entra app registration — exactly what's required

| Setting | Value | Why |
|---|---|---|
| Account types | Single tenant — CDX | One CS agent, one tenant; multi-tenant adds verified-publisher cost with no benefit. |
| Platform | SPA (single-page app) | The WebChat is a SPA; redirects via implicit ID token / authorization code w/ PKCE. |
| Redirect URIs | `https://<swa-hostname>/`, `http://localhost:5173/` | Production + local dev. Wildcards are not supported here. |
| Implicit ID tokens | ✅ Enabled | MSAL SPA flow needs them. |
| Implicit access tokens | ❌ Disabled | SPA flow uses authorization code w/ PKCE, not implicit access. |
| Public client flows | ❌ No | This is not a native client. |
| Custom scope | `api://<client-id>/access_as_user` | Required by some CS configs; harmless if unused. |
| API permissions — Microsoft Graph | `openid`, `profile`, `offline_access`, `User.Read` (delegated) + admin consent | Identity claims for the WebChat. |
| API permissions — **Power Platform API** | `CopilotStudio.Copilots.Invoke` (delegated) + admin consent | **The one that makes CS Direct Engine accept the token.** Without this, the chat returns 403 even with otherwise-valid SSO. |
| Authorized client applications | The same client ID, with the `access_as_user` scope | Lets MSAL silent acquire a token without an extra consent prompt. |
| Federated credential | `Microsoft Entra ID V2 with federated credentials` configured on the CS agent | Avoids client secrets entirely. CS uses workload-identity federation against your app reg. |

## CS agent — Manual Entra auth setup checklist

In the CS agent → Settings → Security → Authentication:
- ☑ **Authenticate manually**
- ☑ Service provider: **Microsoft Entra ID V2 with federated credentials**
- Client ID: the **CS-tenant** app reg client ID
- Tenant ID: the **CS** tenant ID
- Scopes: `<client-id>/.default`
- Token exchange URL: **leave blank** (only for OBO scenarios; not needed here)
- Login URL: leave blank
- ☑ **Require users to sign in**
- Save → Publish

The federated credential is then configured on the Entra app reg (Certificates & secrets → Federated credentials → Add → "Other issuer", paste the Issuer + Subject from the CS auth panel).

## Why federated credentials beat client secrets

- No secret to leak in chat / commit / log files.
- No 180-day rotation chore.
- Trust is verifiable cryptographically by Entra; if the CS service is compromised it can't mint tokens beyond its scope.

If your environment doesn't support federated credentials, fall back to a regular client secret stored in Azure Key Vault and referenced by the CS auth panel.

## Long-running sessions and token refresh

| Token | TTL | Refresh strategy |
|---|---|---|
| MSAL access token (Power Platform API) | 60–90 min | MSAL silent re-acquires from cache; we call `acquireToken()` again before each new conversation start. For long idle sessions with one open conversation, the SDK holds the token; when it 401s, our `onError` handler should reconnect. |
| CS conversation token (set by SDK) | ~30 min | The SDK refreshes internally during streaming. If the user idles past expiry, we surface a system message and reopen the conversation transparently. |
| Browser MSAL session cache | until tab closed (`sessionStorage`) | Long sessions across tabs share via `localStorage` if reconfigured. Default is sessionStorage for tighter security. |

## Live-agent escalation auth (forward-looking, not in scope yet)

When we add live-agent handoff via the broker pattern (see [CAPABILITIES.md](CAPABILITIES.md)):

- The user's MSAL access token is **also** sent to your token broker.
- The broker validates the issuer + audience itself before forwarding to the live platform.
- The live platform's webhook auth is HMAC- or mTLS-based, never a shared secret in the browser.

## Multi-tenant productization (see CAPABILITIES.md)

If/when this becomes a partner-shipped product:

| Today (single-tenant CDX) | Tomorrow (multi-tenant) |
|---|---|
| App reg in CS tenant | App reg in **partner** tenant, multi-tenant + verified publisher |
| MSAL authority `/<tenantId>` | `/organizations` |
| One CS agent | One per customer tenant (managed solution import) |
| Direct browser → CS | Browser → broker → per-tenant CS routing |

## TL;DR

- **MCP server auth** ≠ **chat auth**. Two unrelated boundaries.
- The chat is always authenticated even when the MCP server isn't, because boundary 5 is enforced by Copilot Studio independently.
- Anonymous MCP is the right call for development — adds zero value to the demo and removes a whole class of consent / preauthorization issues.
- Add Entra SSO to the MCP server only when you need audit / per-user tool gating / multi-tenant.
