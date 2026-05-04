# MCSMCPapps

> **Bring your Copilot Studio agent into Microsoft 365 Copilot, with a real app surface — markdown, Adaptive Cards, forms, citations, fullscreen analyst canvas, copy/print/PDF — and zero rewrites of your CS agent.**

[![Status](https://img.shields.io/badge/status-v0.7-blue)](docs/PROGRESS.md)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Fork-time](https://img.shields.io/badge/fork--to--running-≤_60_min-orange)](docs/QUICK-START.md)

## What this is

A reference implementation that lets a Copilot Studio (CS) agent **render properly** inside Microsoft 365 Copilot. Same CS topics, knowledge, hand-off flow, Dataverse logging — surfaced through an MCP App widget that renders markdown, Adaptive Cards, form inputs, Submit postbacks, suggested actions, and a fullscreen "analyst canvas" with Copy / Print / Save-as-PDF.

You fork this repo, point it at your CS environment + agent schema, swap the brand vars, publish. Your agent now appears in M365 Copilot as a first-class app rather than a tool the host LLM may or may not call.

## What it looks like

- **Inline mode** (in the M365 Copilot chat thread): branded card, markdown reply with tables and headings, Adaptive Cards rendered natively, citations, suggested-reply buttons.
- **Fullscreen mode** ("Open analyst" button): sticky header with agent avatar, conversation id chip, toolbar (Copy / Print / Done), a 980 px reading column, keyboard shortcuts (`c` copy, `p` print, `Esc` back).
- **Forms work:** CS topics that emit `Input.Text` + `Action.Submit` cards round-trip back to CS via a dedicated MCP tool. Slot-filling, multi-step wizards, claim intake — all functional.

## Why bother (vs. CS native channel in M365 Copilot)

| | CS native channel | This project |
|---|---|---|
| Custom UI / branding | ❌ | ✅ |
| Markdown rendering | partial | ✅ |
| Adaptive Cards | partial | ✅ (full v1.5 renderer in widget) |
| Form submit / postback | partial | ✅ (dedicated MCP tool) |
| Fullscreen reader / PDF export | ❌ | ✅ |
| CS-PARITY matrix tracking | n/a | [docs/CS-PARITY.md](docs/CS-PARITY.md) |
| Reusable for any CS agent | ❌ | ✅ (fork + rebrand) |

See [docs/CS-PARITY.md](docs/CS-PARITY.md) for the 32-row capability matrix.

## Architecture (60-second story)

```
Microsoft 365 Copilot
└─ Declarative Agent (DA): "Eurozone Analyst"
    └─ RemoteMCPServer pointing at our App Service
        └─ Tools:
            • openCopilotStudioChat (every user message)
            • submitAdaptiveCardAction (Adaptive Card Submit clicks)
        └─ Resource: ui://mcsmcpapps/chat (single-file React widget)
                                  │
                                  ▼
                 ┌────────────────────────────────────┐
                 │  Skybridge sandboxed iframe        │
                 │  React 16 + AdaptiveCards + marked │
                 │  reads window.openai.toolOutput    │
                 │  renders the structured payload    │
                 └────────────────────────────────────┘
                                  ▲
                                  │ structuredContent: { replyText, citations,
                                  │ adaptiveCards, suggestedActions, ... }
                                  │
                 ┌────────────────────────────────────┐
                 │  MCP server (App Service Linux)    │
                 │  Entra SSO + OBO -> PP token       │
                 │  Server-side cache (per oid+thread)│
                 │  CS Direct Engine SDK              │
                 └────────────────────────────────────┘
                                  │
                                  ▼
                  Copilot Studio agent (your brain)
```

**Key property:** the chat hot path goes browser → host → server → CS Direct Engine. No MSAL in the browser, no chat library in the widget, no parallel CS conversation. The widget is a pure renderer of structured tool output.

## Quickstart for a new maker

See [docs/QUICK-START.md](docs/QUICK-START.md) for the end-to-end fork-and-rebrand flow. TL;DR:

1. Fork this repo
2. Set 6 maker variables (CS env id + schema, brand name + accent + logo letter, M365 tenant)
3. Run the brand-swap script (or edit `.env` files)
4. `azd up` to provision Azure resources (App Service, Static Web App)
5. `teamsapp publish --env dev` to push the DA to your tenant
6. Approve the app in Microsoft 365 admin center → All agents → Requests
7. Test in [m365.cloud.microsoft/chat](https://m365.cloud.microsoft/chat)

Total time on a clean machine: ≤ 60 min.

## Repository layout

```
MCSMCPapps/
├── README.md                 ← this file
├── docs/
│   ├── QUICK-START.md         maker fork-and-rebrand recipe
│   ├── CS-PARITY.md           32-row capability matrix
│   ├── ARCHITECTURE.md        deep technical detail
│   ├── SPEC.md                product spec, latency budgets
│   ├── FEATURE-REQUESTS.md    asks for the M365 Copilot platform team
│   ├── decisions/             ADRs (architectural decisions)
│   └── specs/                 implementation specs (per milestone)
├── declarative-agent/        DA + plugin + manifest (TeamsApp project)
├── mcp-server/               Node 20 MCP server, Express + MCP SDK
│   └── src/
│       ├── tools/
│       │   ├── openCopilotStudioChat.ts
│       │   └── submitAdaptiveCardAction.ts
│       └── resources/chatWidget.ts
├── webchat-ui/               React widget bundle (single-file inline)
│   └── src/widget-v2/main.tsx
└── infra/                    Bicep / azd
```

## Status & roadmap

- ✅ **v0.6.x** — foundations (Entra SSO, OBO, PP token cache, header-keyed conversation continuity, silent dispatcher pattern)
- ✅ **v0.7.0** — Adaptive Cards static rendering, Markdown, fullscreen analyst canvas with Copy/Print
- ✅ **v0.7.1** — Adaptive Card `Action.Submit` + form inputs end-to-end
- ✅ **v0.7.2** — Suggested actions / quick replies
- 🔄 **v0.7.3** — Hand-off to live agent (D365 Omnichannel)
- 🔜 **v0.7.4** — Streaming partial replies (FR 5.1 dependency)
- 🔜 **v0.8** — File downloads, voice gaps documented

See [docs/PROGRESS.md](docs/PROGRESS.md) for the full log.

## Contributing & feature requests

Platform-side asks for Microsoft (M365 Copilot, declarative-agent, MCP App): [docs/FEATURE-REQUESTS.md](docs/FEATURE-REQUESTS.md).

Repo-side issues / PRs welcome. Read [docs/SPEC.md](docs/SPEC.md) before proposing architectural changes.

## License

[MIT](LICENSE).
