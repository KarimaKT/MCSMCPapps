# MCSMCPapps

> **Embed a Copilot Studio agent inside Microsoft 365 Copilot — with your own UI.**

A reference implementation, MIT-licensed, fork-ready. Custom-branded React widget rendered
inside M365 Copilot, talking to your CS agent, with out-of-the-box live-agent escalation
via D365 Omnichannel.

[![Status](https://img.shields.io/badge/status-v0.5_demo--ready-blue)](docs/PROGRESS.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Fork-time](https://img.shields.io/badge/fork--to--running-30%20min-orange)](#quickstart)

```
M365 Copilot ── DA + MCP ──▶ skybridge widget (React, single file)
                                      │
                       ─ CopilotStudioWebChat OOB ─▶
                                      │
                                      ▼
                        Copilot Studio agent (your brain)
                                      │
                            (escalation) OOB ─▶
                                      │
                                      ▼
                         D365 Omnichannel for CCaaS
```

## What this is, in 30 seconds

You have a **Copilot Studio agent**. You want it to live inside **Microsoft 365 Copilot**
with **your own UI** — branded, with charts, with custom layouts. The native CS-to-M365-Copilot
channel gives you the standard chat UI; this repo gives you a fully custom one.

The CS agent stays the brain. We render a custom React widget inside M365 Copilot via a
Declarative Agent + remote MCP server. The widget talks to your CS agent through the OOB
[`@microsoft/agents-copilotstudio-client`](https://www.npmjs.com/package/@microsoft/agents-copilotstudio-client) SDK — same path Microsoft's own samples use.

Live-agent escalation works on day one through CS Studio's OOB Settings → Agent transfers →
**Omnichannel** tile. No code on our side.

## When to use this (and when not to)

→ Read [docs/COMPARISON.md](docs/COMPARISON.md) for the full decision matrix and a
30-second flowchart. Short version:

| If you want… | Use… |
|---|---|
| Plain CS chat in M365 Copilot | CS native channel (not this repo) |
| **Custom-branded UI in M365 Copilot, with CS as brain, with escalation** | **This repo** |
| Standalone branded WebChat on your website | This repo's SWA channel (same React source) |

## Quickstart

> Target maker time: **30 minutes from `git clone` to working in M365 Copilot.**
>
> Prereqs: Node 20+, Azure subscription, existing CS agent, M365 tenant where you can
> sideload a Declarative Agent (CDX or your own dev tenant).

```pwsh
# 1. Clone & install
git clone https://github.com/KarimaKT/MCSMCPapps.git
cd MCSMCPapps
npm install

# 2. Set the parameters that matter (~5 minutes)
copy webchat-ui\.env.dev.sample webchat-ui\.env.dev
# Edit webchat-ui\.env.dev — see "Important parameters" below

# 3. Build
npm run build       # builds widget + SWA + MCP server

# 4. Provision Azure (App Service + SWA)
az login
azd up              # ~5 min, creates App Service + SWA in your sub

# 5. Publish the Declarative Agent to your tenant
cd declarative-agent
npx -y -p '@microsoft/teamsapp-cli@3.1.1' teamsapp account login m365
npx -y -p '@microsoft/teamsapp-cli@3.1.1' teamsapp publish --env dev

# 6. Have your tenant admin approve the app
# Teams Admin Center → Manage apps → Eurozone Analyst → Allow
# (CDX tenants auto-approve)

# 7. Test
# Open https://m365.cloud.microsoft/chat → Agents → your agent → ask a question
```

### Important parameters

Everything a maker changes is at one of these knobs. Nothing else needs touching.

| Parameter | File | What it does |
|---|---|---|
| `VITE_CS_ENVIRONMENT_ID` | `webchat-ui/.env.dev` | Power Platform environment GUID hosting your CS agent |
| `VITE_CS_SCHEMA_NAME` | `webchat-ui/.env.dev` | CS agent schema name (Settings → Advanced) |
| `VITE_CS_TENANT_ID` | `webchat-ui/.env.dev` | AAD tenant of the CS environment |
| `VITE_ENTRA_CLIENT_ID` | `webchat-ui/.env.dev` | Entra app reg client id used for MSAL silent SSO |
| `VITE_BRAND_AGENT_NAME` | `webchat-ui/.env.dev` | Display name in widget header |
| `VITE_BRAND_LOGO_TEXT` | `webchat-ui/.env.dev` | Single-glyph logo (or `VITE_BRAND_LOGO_URL` for an image) |
| `VITE_BRAND_ACCENT` | `webchat-ui/.env.dev` | Primary accent color (e.g. `#003399`) |
| `VITE_BRAND_ACCENT_FG` | `webchat-ui/.env.dev` | Foreground color used on accent backgrounds |
| `VITE_BRAND_FONT` | `webchat-ui/.env.dev` | Font stack |
| `VITE_BRAND_COMPANY_NAME` | `webchat-ui/.env.dev` | Customer / org name |
| `manifest.json: id` | `declarative-agent/appPackage/manifest.json` | **YOUR** new GUID for the Teams app |
| `manifest.json: developer.*` | same | Your org name + URLs |

→ Full details in [docs/SPEC.md §8](docs/SPEC.md#8-important-parameters-single-source-of-truth) (single source of truth).

### Customize what?

| You want to… | Touch this | Don't touch |
|---|---|---|
| Rebrand (colors, logo, name) | `webchat-ui/.env.dev` | anything else |
| Change CS agent | env vars + `manifest.json: id` | code |
| Add a chart, button, custom card to the widget | `webchat-ui/src/` | mcp-server, manifest |
| Add a tool the model can call | `mcp-server/src/tools/` (one new file) | existing tools |
| Change escalation routing / queues | CS Studio UI (no code) | nothing here |
| Change DA description / starters | `declarative-agent/appPackage/declarativeAgent.json` | code |

## Documentation map

Start here, depending on who you are:

- **You're evaluating this approach** → [docs/COMPARISON.md](docs/COMPARISON.md), [docs/SPEC.md](docs/SPEC.md)
- **You're implementing** → [docs/MCP-APPS-CONTRACT.md](docs/MCP-APPS-CONTRACT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **You're testing / shipping** → [docs/TEST-PLAN.md](docs/TEST-PLAN.md)
- **You're rebranding for your own deployment** → [docs/WIDGET-CUSTOMIZATION.md](docs/WIDGET-CUSTOMIZATION.md), [docs/MAKER-CONFIG.md](docs/MAKER-CONFIG.md), [docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md)
- **You're a Microsoft PM and want to know what's broken** → [docs/FEATURE-REQUESTS.md](docs/FEATURE-REQUESTS.md)
- **You want the technical narrative for a blog** → [docs/BLOG.md](docs/BLOG.md)
- **You want the story end-to-end** → [docs/WHAT-IS-THIS.md](docs/WHAT-IS-THIS.md)

## Repo layout

```
MCSMCPapps/
├── webchat-ui/             # React app — single source, two delivery channels
│   ├── src/
│   │   ├── App.tsx         # Composer + BasicWebChat (BotFramework Web Chat OOB)
│   │   ├── branding.ts     # readBrand(): all VITE_BRAND_* vars
│   │   ├── cs/             # CS connection (CopilotStudioWebChat.createConnection — OOB)
│   │   ├── host/           # skybridge bridge + host detection
│   │   └── handoff/        # live-agent escalation hooks (used by CS topic, not us)
│   └── .env.dev.sample     # the brand + CS connection env vars
│
├── mcp-server/             # Thin MCP server: serves the widget HTML, defines the tool
│   ├── src/
│   │   ├── index.ts        # HTTP host (Express + Streamable HTTP transport)
│   │   ├── server.ts       # buildServer(): McpServer factory
│   │   ├── config.ts       # loadConfig(): all env vars w/ JSDoc
│   │   ├── tools/          # one file per tool (today: openCopilotStudioChat)
│   │   ├── resources/      # one file per UI resource
│   │   └── widget.ts       # imports the built widget HTML at startup
│   └── package.json
│
├── declarative-agent/      # M365 Declarative Agent + MCP plugin manifest
│   ├── appPackage/
│   │   ├── manifest.json
│   │   ├── declarativeAgent.json
│   │   └── ai-plugin.json
│   ├── m365agents.yml      # Agents Toolkit lifecycle
│   └── teamsapp.yml        # legacy CLI shim
│
├── infra/                  # Bicep modules: SWA + App Service + identity
│
├── docs/                   # ← Read these
│   ├── README-style entries:
│   ├── SPEC.md             # PM spec: goals, non-goals, personas, success
│   ├── ARCHITECTURE.md     # data flows, conv-id discipline, SLOs, failure modes
│   ├── COMPARISON.md       # when to use this vs alternatives
│   ├── MCP-APPS-CONTRACT.md# the wire contract (skybridge MIME, _meta keys)
│   ├── TEST-PLAN.md        # test pyramid, manual scenarios, smoke
│   ├── FEATURE-REQUESTS.md # urgent platform asks
│   ├── BLOG.md             # technical narrative
│   └── …
│
└── .github/workflows/      # CI (manifest scope guard, deploy)
```

## What you get out-of-the-box

- **Streaming responses** from CS via Wave-2 (BotFramework Web Chat OOB)
- **Adaptive Cards** rendered inline
- **Suggested actions** ("Try…" buttons)
- **Markdown** safely sanitized
- **Inline charts** (CS returns data-URI PNGs from Power Automate quickchart actions)
- **Branded chrome** via 8 build-time env vars
- **Dataverse transcript logging** (CS does this; we surface a link)
- **D365 Omnichannel handoff** (CS native; we configure, don't code)
- **Auto first-message handoff** — the user's question that triggered the widget mount is
  auto-relayed to CS so the user never has to retype
- **Light/dark theme** matched to host
- **Conversation id discipline** — CS owns the only id, we never mint a parallel one
- **Same React source → two surfaces:** M365 Copilot widget AND public SWA URL

## Status (May 2026)

- ✅ All docs in place
- ✅ MCP server with verified OpenAI Apps SDK contract (smoke tests passing)
- ✅ DA published to CDX
- 🔄 Phase 5h.3: replacing iframe-of-SWA with single-file React widget bundle (in progress)
- 🔄 Phase 5h.4: replacing hand-rolled CS transport with `CopilotStudioWebChat.createConnection` OOB
- ⏳ Live-agent escalation via D365 Omnichannel (configured in CS Studio, not yet
  integration-tested in the widget)

→ Full progress in [docs/PROGRESS.md](docs/PROGRESS.md).

## Contributing

This is a reference implementation, not a product. Forks welcome. PRs that:

1. Fix bugs in the contract / wire shape — yes, please
2. Add tests — yes, please (see [docs/TEST-PLAN.md](docs/TEST-PLAN.md))
3. Add new sample brokers (Genesys, LivePerson) for v2 — yes, please
4. Add new UI features generic to all forks — yes, please

PRs that fork off into your own customization should be merged into your own fork, not back
upstream — keep this repo lean and generic so it works as a starting point for everyone.

## Trademarks & licensing

MIT (see [LICENSE](LICENSE)).

This project is an unofficial reference implementation. **Not** a Microsoft product. It uses
official Microsoft SDKs and follows official patterns documented at
[microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples)
and [microsoft/Agents](https://github.com/microsoft/Agents) — but is not affiliated with or
endorsed by those teams beyond personal contribution.

## Acknowledgments

- Microsoft 365 Copilot extensibility team (Declarative Agents, MCP Apps)
- Copilot Studio team (Wave-2 SDK, Direct Engine API)
- The `mcp-interactiveUI-samples` reference samples — canonical examples of the widget
  contract that informed every architectural decision here
- The OpenAI Apps SDK team for the protocol M365 Copilot's RemoteMCPServer client implements
- Andreas Adner's January 2025 LinkedIn post that confirmed M365 Copilot supports both
  OpenAI Apps SDK and MCP Apps — saved us a week of doubt
