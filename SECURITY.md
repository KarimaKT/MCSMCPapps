# Security guidelines

## What's safe to commit / share

| Type | Example | Safe to commit? | Safe to paste in chat / issues? |
|---|---|---|---|
| App registration **Client ID** | `701e58d1-...` | ✅ Yes | ✅ Yes |
| **Tenant ID** (Entra) | `301759bc-...` | ✅ Yes | ✅ Yes |
| Subscription ID | `1cd52c59-...` | ✅ Yes | ✅ Yes |
| SWA hostname | `icy-field-...azurestaticapps.net` | ✅ Yes | ✅ Yes |
| CS bot ID, environment ID | GUIDs | ✅ Yes | ✅ Yes |
| **Custom scope** (the `api://...` URI) | `api://701e58d1-.../access_as_user` | ✅ Yes | ✅ Yes |
| **Application ID URI** | `api://701e58d1-...` | ✅ Yes | ✅ Yes |
| Direct Line token endpoint URL | `https://....api.powerplatform.com/...` | ✅ Yes | ✅ Yes |
| **Client secret** | random base64-ish string from Entra | ❌ **NEVER** | ❌ **NEVER** |
| **Direct Line secret** | from CS Channels → Direct Line "secret keys" | ❌ **NEVER** | ❌ **NEVER** |
| **Direct Line token** (short-lived) | usually a JWT from token endpoint | ❌ Short-lived but still treat as secret | ❌ |
| **Bearer access tokens** | the user's MSAL output | ❌ | ❌ |
| **Federated credential issuer + subject** | values shown in the CS auth panel | ✅ Yes (these are NOT secrets — they describe a public OIDC trust) | ✅ Yes |
| **GitHub Actions secrets values** | once stored in GitHub, never readable again | ❌ | ❌ |

## If a secret leaks

The two scenarios you'll see most often:

### A client secret was pasted somewhere it shouldn't have been

1. Entra portal → app reg → **Certificates & secrets** → **delete** the leaked secret.
2. Create a new one.
3. Update wherever it was used (Copilot Studio, Key Vault, etc.).
4. Audit recent token issuance if the secret was exposed for >a few minutes.

### A Direct Line secret leaked

1. Copilot Studio → Settings → Channels → Direct Line → regenerate the secret.
2. Update token broker (or wherever it's stored server-side).

## Defaults this repo enforces

- `.env`, `.env.local` are gitignored (see [.gitignore](.gitignore)).
- The WebChat bundle never reads anything but `VITE_*` env vars (build-time, baked into JS) — no secrets get into the bundle by accident.
- `staticwebapp.config.json` sets a strict CSP that blocks unexpected origins.
- GitHub Actions secrets are scoped to the repo and never echoed in logs.

## Strongly recommended: federated credentials, not client secrets

When configuring Manual Entra auth on Copilot Studio, choose **"Microsoft Entra ID V2 with federated credentials"** if it appears as an option. This avoids client secrets entirely and means there's no secret to rotate or leak.

See [docs/BUILD-GUIDE.md §7](docs/BUILD-GUIDE.md) for the federated credential setup.

## Reporting a security issue in this repo

This is a personal experimental project. If you find an issue, open a GitHub issue or email the repo owner directly. There's no SLA — this is not production.
