# Maker config — branding & identity

> Single page that tells a maker (Copilot Studio agent author / customer eng / SI) how to make this WebChat their own.
>
> Audience: someone who wants to fork/clone this repo and ship it for their tenant. They should not need to read TypeScript.

## TL;DR — the 8 env vars that make the WebChat *yours*

| Variable | Required? | What it does | Example |
|---|---|---|---|
| `VITE_CS_ENVIRONMENT_ID` | ✅ | Power Platform env GUID where the agent lives | `61453fde-…` |
| `VITE_CS_SCHEMA_NAME` | ✅ | Agent schema name from CS Settings → Advanced | `cr1a2_myAgent` |
| `VITE_AAD_CLIENT_ID` | ✅ | Entra app reg client ID (in the CS tenant) | `701e58d1-…` |
| `VITE_AAD_AUTHORITY` | ✅ | `https://login.microsoftonline.com/<tenantId>` | `https://login.microsoftonline.com/301759bc-…` |
| `VITE_AAD_SCOPE` | ✅ | Power Platform API scope | `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke` |
| `VITE_BRAND_AGENT_NAME` | ✓ optional | Header title | `Eurozone Analyst` |
| `VITE_BRAND_COMPANY_NAME` | ✓ optional | Smaller line above title | `Contoso Electronics` |
| `VITE_BRAND_LOGO` | ✓ optional | Emoji, image URL, or `data:` URL | `€` |

**Required ones make the chat work. Branding ones make it look like yours.** All branding has sensible defaults if omitted.

## The maker workflow — when in dev does this happen?

```text
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 0 — fork / clone the repo                                        │
│                                                                      │
│   git clone https://github.com/KarimaKT/MCSMCPapps.git my-agent      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 1 — register CS agent IDs (BUILD-GUIDE §2 / §5)                  │
│                                                                      │
│   • Open your CS agent → Settings                                    │
│   • Capture environment GUID + schema name                           │
│   • Set VITE_CS_ENVIRONMENT_ID, VITE_CS_SCHEMA_NAME                  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 1 — register Entra app + grant CS perm (BUILD-GUIDE §7)          │
│                                                                      │
│   • Create app reg in CS tenant, SPA platform                        │
│   • Add Power Platform API → CopilotStudio.Copilots.Invoke           │
│   • Set VITE_AAD_CLIENT_ID, VITE_AAD_AUTHORITY, VITE_AAD_SCOPE       │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 1 — local smoke test                                             │
│                                                                      │
│   cp webchat-ui/.env.example webchat-ui/.env                         │
│   # fill in the 5 required vars (skip branding for now)              │
│   cd webchat-ui && npm install && npm run dev                        │
│   # open http://localhost:5173/, sign in, verify chat works          │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 2 — apply your branding (this doc)                               │
│                                                                      │
│   • Decide agent name, logo, colors, font                            │
│   • Add VITE_BRAND_* lines to .env                                   │
│   • npm run dev — verify the look                                    │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 2 — provision Azure SWA (BUILD-GUIDE §4)                         │
│                                                                      │
│   az group create + Bicep deploy + capture deployment token          │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 2 — set GitHub Actions secrets (production env)                  │
│                                                                      │
│   gh secret set VITE_CS_ENVIRONMENT_ID --body "..."                  │
│   gh secret set VITE_CS_SCHEMA_NAME    --body "..."                  │
│   gh secret set VITE_AAD_CLIENT_ID     --body "..."                  │
│   gh secret set VITE_AAD_AUTHORITY     --body "..."                  │
│   gh secret set VITE_AAD_SCOPE         --body "..."                  │
│   gh secret set VITE_BRAND_AGENT_NAME  --body "..."                  │
│   gh secret set VITE_BRAND_COMPANY_NAME --body "..."                 │
│   gh secret set VITE_BRAND_LOGO        --body "..."                  │
│   gh secret set VITE_BRAND_ACCENT_COLOR --body "..."                 │
│   # (every VITE_* you want in production)                            │
│                                                                      │
│   # Push triggers GitHub Actions → builds with these baked in →      │
│   # deploys to SWA. Live at https://<your-swa>/                      │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ DAY 3 — package the Declarative Agent + MCP App (Phase 5)            │
│         and sideload to M365 Copilot                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Key principle:** branding is **build-time only**. It's set by the maker, baked into the bundle, and shipped. There is intentionally no path for a topic / runtime event to change branding — that would couple Copilot Studio content to the surface, undermine the maker's single source of truth, and create surprising customer experiences.

## How each branding var maps to what the user sees

| Var | Effect | Notes |
|---|---|---|
| `VITE_BRAND_AGENT_NAME` | Bold title in the chat header | Also becomes browser tab title if `VITE_BRAND_PAGE_TITLE` is unset |
| `VITE_BRAND_AGENT_SUBTITLE` | Small grey line under the title | Skip for less clutter |
| `VITE_BRAND_COMPANY_NAME` | Tiny uppercase label above the title | Sets a "made by" tone |
| `VITE_BRAND_LOGO` | Square chip on the left of the header | See below for accepted formats |
| `VITE_BRAND_ACCENT_COLOR` | User message bubble background, send button, link colour, suggested-action border | Any CSS color string |
| `VITE_BRAND_ACCENT_FOREGROUND` | Text on top of the accent (user bubble text, send button glyph) | Pick high contrast vs accent |
| `VITE_BRAND_FONT_FAMILY` | Whole UI font stack | See font-loading note below |
| `VITE_BRAND_PAGE_TITLE` | Override `document.title` | Otherwise falls back to agent name |

### Logo formats accepted

```text
VITE_BRAND_LOGO=€                                    # any short text or emoji
VITE_BRAND_LOGO=AG                                   # initials
VITE_BRAND_LOGO=https://example.com/logo.svg         # remote URL (must satisfy CSP — see below)
VITE_BRAND_LOGO=data:image/svg+xml;base64,PHN2…      # inline data URL
```

### Notes on fonts

- **System fonts (default).** Recommended. Zero load cost, looks native on every OS.
- **Custom fonts via Google Fonts / Microsoft / etc.** Add a `<link rel="stylesheet" href="…">` to `index.html` AND extend the CSP `style-src` and `font-src`. Then reference the font in `VITE_BRAND_FONT_FAMILY`.
- **Self-hosted woff2.** Drop the file in `webchat-ui/public/fonts/`, add `@font-face` in `index.html`, reference in the font stack.

### Notes on logos

- **External `https://` images** require the origin to be allowed in the CSP `img-src` directive in `webchat-ui/public/staticwebapp.config.json`. The default `img-src` already includes `https:` so most public CDNs work.
- **`data:` URLs** are allowed by default and have zero network cost — best for logos < ~50 KB.

## Local-vs-production: the rule

| Where | What | When |
|---|---|---|
| `webchat-ui/.env` | Local dev values | Your personal machine; gitignored. Used by `npm run dev`. |
| GitHub Actions secrets | Production values | Read at CI build time. Whatever ends up here is what users see. |
| `.env.example` | Documented template | Committed to repo. Always lists every supported var with a sensible example. |

If a maker forgets to mirror a value to GitHub Actions secrets, the production build falls back to the source defaults — never breaks, just looks generic.

## Done correctly, the maker's diff to fork-and-rebrand is one screen

```ini
# webchat-ui/.env
VITE_CS_ENVIRONMENT_ID=<their env GUID>
VITE_CS_SCHEMA_NAME=<their schema name>
VITE_AAD_CLIENT_ID=<their client ID>
VITE_AAD_AUTHORITY=https://login.microsoftonline.com/<their tenant>
VITE_AAD_SCOPE=https://api.powerplatform.com/CopilotStudio.Copilots.Invoke

VITE_BRAND_AGENT_NAME=Their Agent
VITE_BRAND_COMPANY_NAME=Their Company
VITE_BRAND_LOGO=🦊
VITE_BRAND_ACCENT_COLOR=#9333ea
VITE_BRAND_ACCENT_FOREGROUND=#ffffff
```

That's it. Run `npm run dev`, see their branding, push to GitHub Actions secrets, deploy.
