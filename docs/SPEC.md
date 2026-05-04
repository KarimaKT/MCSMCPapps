# MCSMCPapps — Product specification

> **Status:** v0.5 (May 2026). This is the source of truth for what we are building, for whom,
> and what success looks like. If something in code or another doc disagrees with this file,
> this file wins until it is updated and re-reviewed.

## 1. One-line summary

Embed any Copilot Studio agent inside Microsoft 365 Copilot **with a fully custom UI** and
out-of-the-box live-agent escalation, in a way that any maker can fork, rebrand, and ship in
under 30 minutes.

## 2. Why now

Microsoft 365 Copilot today gives makers two extremes:

1. **Native CS channel** — easy, OOB, but the user gets the plain M365 Copilot chat surface.
   No custom UI, no branded widgets, no domain-specific layouts.
2. **Custom widgets via Declarative Agent + RemoteMCPServer + MCP Apps / OpenAI Apps SDK** —
   maximum UX control, but every maker reinvents the same scaffolding (auth, state, transport,
   bridge, escalation) from scratch and most fail before reaching production.

This project closes the gap. It is the **reference implementation** for "I want a CS-powered
agent in M365 Copilot, but with my own UI and a customer-grade escalation path." Everything
needed to ship is in the box.

## 3. Goals

- **G1.** A maker forks the repo, plugs in their CS agent IDs and brand variables, runs one
  publish command, and within 30 minutes has their agent running in M365 Copilot with their
  custom widget UI.
- **G2.** The CS agent's behavior (topics, knowledge, agentic flow, Dataverse logging) is
  **unchanged** — we are a thin presentation layer, not a rewrite of CS.
- **G3.** Live-agent escalation works on day one via OOB CS → Dynamics 365 Omnichannel for
  Customer Service. The maker writes zero escalation code; CS topic configuration handles it.
- **G4.** The conversation id allocated by CS is **the** conversation id — no parallel ids,
  no orphan state, no "which side am I on" debugging.
- **G5.** The same React UI source compiles to two delivery channels:
   1. The skybridge widget served by our MCP server, rendered inside M365 Copilot.
   2. A standalone branded WebChat at a public URL (Static Web App), embeddable on a
      customer's site.
- **G6.** Every important parameter (CS env id, schema, brand variables, MCP origin, CSP
  allowlists) is documented in one place and discoverable in under 60 seconds by a new maker.
- **G7.** The codebase is modular: any one of {widget UI, MCP server, DA manifest,
  WebChat-only path} can be replaced without touching the others.

## 4. Non-goals (v0.5)

- **NG1.** We do not host or train the LLM. CS owns the brain.
- **NG2.** We do not support brokers other than D365 Omnichannel for v1. Generic broker
  abstraction is documented for v2 in [ARCHITECTURE.md](ARCHITECTURE.md).
- **NG3.** We do not run on Teams personal-tab / Outlook / non-M365 surfaces in v1. The
  standalone SWA exists for off-Copilot embedding, but it's the secondary channel.
- **NG4.** We do not implement multi-tenant SaaS for the MCP server (one tenant = one
  deployment in v1).
- **NG5.** We do not authenticate end users to backend services other than CS via the SDK.
  If your widget needs to call a third-party API, you add the CSP allowlist + token logic.

## 5. Personas

### 5.1 Maker (primary)

**"Mira, the Copilot Studio maker."** Builds CS agents for her line of business. Comfortable
with CS YAML, Adaptive Cards, and Power Automate. Familiar with Git but not a frontend
specialist. Wants to fork this repo, swap out the brand and the CS agent IDs, and have a
custom-UI'd agent in M365 Copilot **today**, not next quarter.

**Top jobs:**
- Rebrand UI (logo, accent color, agent name)
- Connect to her own CS agent
- Add a chart, a table, or a custom Adaptive Card to the widget
- Change escalation routing (which queue goes to which team)

**Anti-needs:** doesn't want to learn skybridge MIME types, OAuth specs, or the difference
between `text/html` and `text/html+skybridge`.

### 5.2 Forking ISV / partner (secondary)

**"Patel, the partner SE."** Builds 5+ vertical CS agents for clients (insurance claims,
HR, field service). Wants this repo as the **chassis** every client deployment starts from.

**Top jobs:**
- Stamp out N parallel deployments without copy-paste drift
- Swap UI primitives in (Fluent UI, MUI, custom)
- Plug in client-specific MCP tools (SAP, ServiceNow, custom REST)
- Run CI/CD pipelines that publish updates without manual admin clicks

**Anti-needs:** doesn't want to maintain forked transport / bridge / auth code as Microsoft
SDKs evolve. Insists on OOB SDKs.

### 5.3 Microsoft / partner CSU advocate (tertiary)

**"Anders, the customer-success engineer."** Demos this to enterprise prospects. Needs the
demo to work first time, every time, in CDX, with the full story (custom UI + CS brain +
live-agent escalation) visible in one 5-minute walkthrough.

**Anti-needs:** doesn't want intermittent failures, doesn't want to debug in front of customer.

### 5.4 End user (always)

**"Elena, the analyst at Contoso Electronics."** Opens M365 Copilot, asks a Eurozone GDP
question, expects a great answer with charts. Doesn't know or care that there's CS, MCP,
skybridge, or anything else in the chain.

**Top jobs:** ask, get answer, escalate to human if stuck.

## 6. Scenarios

### 6.1 First-load happy path

1. Elena opens M365 Copilot, types "compare GDP of top 5 EU economies."
2. M365 Copilot routes the message to the Eurozone Analyst declarative agent.
3. The DA decides to call the `openCopilotStudioChat` tool.
4. Our MCP server returns: structured content + a UI resource link.
5. M365 Copilot renders the widget (single-file React bundle).
6. Widget reads the user's query from the host bridge, opens a CS Wave-2 conversation
   via `CopilotStudioWebChat.createConnection()`, sends the query as the first message.
7. CS streams back: text, charts (data URIs), Adaptive Cards.
8. Widget renders inline. Elena sees the answer with charts, branded chrome, suggested actions.

**Success criteria:** end-to-end median latency from "Elena hits enter" to "first content
streams" ≤ 4 seconds on a warm App Service B1 instance.

### 6.2 Multi-turn

1. Elena follows up: "show inflation by member state."
2. Widget posts the new message via the same CS conversation id (no new conversation).
3. CS continues the topic, returns updated content. Widget streams.

**Success criteria:** zero "Something went wrong" cards across a 10-turn session, including
across an App Service container restart in the middle.

### 6.3 Live-agent escalation

1. Elena: "I think the CPI number for Spain is wrong, can a person check?"
2. CS topic detects the escalation phrase OR shows an Adaptive Card with "Connect to agent"
   button.
3. CS uses its **OOB Dynamics 365 Omnichannel** handoff — Settings → Agent transfers →
   Omnichannel — to transfer the conversation. We write zero code for this.
4. The Omnichannel agent picks up the thread with full context (CS provides transcript).
5. Inside our widget, the user sees an Adaptive Card or system message indicating
   "connecting to agent…" and then receives the live agent's messages on the same surface.

**Success criteria:** escalation works with **no MCP server code** — it's pure CS topic +
OOB connector configuration. If a maker forks this and disables our widget entirely, the
CS agent **still** escalates correctly when run on any other channel.

### 6.4 Maker rebrands and republishes

Mira clones the repo, runs:

```pwsh
# 1. Edit env/.env.dev with her CS agent IDs and brand vars
# 2. Build + deploy infra (one azd up command, see DEPLOY.md)
azd up

# 3. Publish the DA to her tenant
cd declarative-agent
npx -y -p @microsoft/teamsapp-cli@3.1.1 teamsapp publish --env dev
```

Her admin approves the app in Teams Admin Center. Mira's branded Eurozone-style agent
now appears in her M365 Copilot, with her CS agent as the brain.

**Success criteria:** end-to-end maker time from `git clone` to working in M365 Copilot:
≤ 30 minutes, including the 1–5 minute admin approval wait.

### 6.5 Standalone WebChat (off-Copilot channel)

A customer wants the same agent embedded on their public website (no M365 Copilot
involved). They iframe the SWA URL into their site. Same CS agent, same UI, no DA, no MCP.

**Success criteria:** the SWA is its own deployable target, MIT-licensed, with its own
auth path (anonymous CS public Direct Engine endpoint or AAD SSO via MSAL — maker chooses).

## 7. Success metrics

| Metric | v0.5 target | v1.0 target |
|---|---|---|
| Maker fork-to-running time | ≤ 60 min | ≤ 30 min |
| Widget render success rate (per tool call) in M365 Copilot | ≥ 95% | ≥ 99.5% |
| Mid-session "Something went wrong" rate | ≤ 5% | ≤ 0.5% |
| First-token latency p50 (warm) | ≤ 4 s | ≤ 2 s |
| Escalation hand-off success | ≥ 95% (with valid Omnichannel config) | ≥ 99% |
| Maker reads ≤ 1 page of docs to rebrand | "yes" / "no" | "yes" |
| Net Promoter from forking partners | n/a | ≥ 30 |

### 7.1 Per-turn latency budget

Reference budget for one user turn in M365 Copilot (data-widget pattern,
Entra SSO + OBO + CS Direct Engine). Numbers are warm-path observations from
the v0.6 deployment on App Service B1.

| Phase | Time | Owner | Reducible by us? |
|---|---|---|---|
| Host LLM picks tool | 0.3–1 s | M365 Copilot | No |
| Network → App Service | 0.05–0.2 s | network | No |
| JWKS validate inbound token | <50 ms (cached) | server | Already cached |
| Entra OBO → PP token | 100–500 ms | Entra | **Yes — server-side PP token cache (per `oid`, ~1 h)** |
| `startConversationStreaming` | 1–4 s | CS Direct Engine | **Yes — server-side conversationId cache (per `oid`, 25 min)** |
| `sendActivityStreaming` + bot answer | 1.5–4 s | CS bot LLM | No (bot-side) |
| Return → host parses → widget mount | 0.3–0.6 s | host + browser | Limited |
| Host LLM post-tool narrate | 0.5–2 s | M365 Copilot | Workaround only (FR 2.7) |

**Cold first turn:** ~5–15 s. **Warm follow-up turn (with both caches hit):**
~2–4 s server time + 1–2 s host overhead. Floor is bounded by host LLM passes
+ CS bot inference; both are out of our control.

The two caches that make follow-up turns acceptable live in
`mcp-server/src/caches.ts` (in-process Map, single App Service instance,
keyed by Entra `oid`). They compensate for the host LLM being unreliable
about echoing `conversationId` back as a tool argument, and for OBO being
a per-call HTTPS round trip.

## 8. Important parameters (single source of truth)

> **Maker:** these are the values you change. Everything else can stay as-is.

| Parameter | Where it lives | What it does | Default |
|---|---|---|---|
| `VITE_CS_ENVIRONMENT_ID` | `webchat-ui/.env` | Power Platform environment GUID hosting your CS agent | _none_ |
| `VITE_CS_SCHEMA_NAME` | `webchat-ui/.env` | CS agent schema name (Settings → Advanced) | _none_ |
| `VITE_CS_TENANT_ID` | `webchat-ui/.env` | AAD tenant of the CS environment | _none_ |
| `VITE_ENTRA_CLIENT_ID` | `webchat-ui/.env` | Entra app reg client id used for MSAL silent SSO | _none_ |
| `VITE_BRAND_AGENT_NAME` | `webchat-ui/.env` | Display name in widget header | "Eurozone Analyst" |
| `VITE_BRAND_COMPANY_NAME` | `webchat-ui/.env` | Customer org name | "Contoso Electronics" |
| `VITE_BRAND_LOGO_TEXT` | `webchat-ui/.env` | Single-glyph logo when no PNG provided | "€" |
| `VITE_BRAND_LOGO_URL` | `webchat-ui/.env` | Optional logo PNG (overrides text) | _empty_ |
| `VITE_BRAND_ACCENT` | `webchat-ui/.env` | Primary accent color | "#003399" |
| `VITE_BRAND_ACCENT_FG` | `webchat-ui/.env` | Foreground for accent backgrounds | "#ffd200" |
| `VITE_BRAND_FONT` | `webchat-ui/.env` | Font stack | "Segoe UI" |
| `SWA_ORIGIN` | `mcp-server/.env` (App Service config) | Public origin of the standalone SWA, used in widget CSP | _none_ |
| `AGENT_NAME` | `mcp-server/.env` | Used in tool description + status text | "Eurozone Analyst" |
| `AGENT_DESCRIPTION` | `mcp-server/.env` | Tool description for the host model | _short blurb_ |
| `manifest.json: version` | `declarative-agent/appPackage/manifest.json` | Bumped on every publish | "1.0.5" |
| `m365agents.yml: TEAMS_APP_TENANT_ID` | `declarative-agent/env/.env.dev` | Target tenant for publish | CDX tenant |

Every maker change is at one of these knobs. Nothing else needs touching.

## 9. Out-of-the-box capabilities (what you get for free)

- **Streaming responses** from CS via Wave-2 SDK
- **Adaptive Cards** rendered in widget (via `botframework-webchat` OOB)
- **Suggested actions** ("Try…" buttons under messages)
- **Inline charts** (CS returns data-URI PNGs from Power Automate / quick-chart actions)
- **Markdown** safely rendered (DOMPurify default)
- **Branding** via 8 build-time env vars; no runtime branding API surface
- **Dataverse transcript logging** (CS does this OOB; we surface a link in [CAPABILITIES.md](CAPABILITIES.md))
- **D365 Omnichannel handoff** (CS native; we configure, we don't code)
- **First-message handoff** (the user's message that triggered the tool call is auto-relayed
  to CS so the user never has to retype)
- **Light/dark theme** matched to M365 Copilot host
- **Conversation id discipline** (CS owns it; we never mint a parallel one)

## 10. Maker customization paths

| You want to… | Touch this | Don't touch this |
|---|---|---|
| Change brand | `webchat-ui/.env` | anything else |
| Add a UI feature (new card, new button) | `webchat-ui/src/` | mcp-server, manifest |
| Add a tool the model can call | `mcp-server/src/tools/` | webchat-ui, manifest |
| Change escalation routing | CS Studio UI (no code) | nothing |
| Connect to a different CS agent | `webchat-ui/.env` + `declarative-agent/appPackage/manifest.json: id` | code |
| Add custom data source | `mcp-server/src/tools/your-tool.ts` (new file) | existing tools |
| Change DA description / name | `declarative-agent/appPackage/declarativeAgent.json` | code |

## 11. Decisions (and the assumptions behind them)

**D1 — Brain = Copilot Studio.** Not Azure AI Foundry, not OpenAI direct. Reason: the
customer wants OOB Dataverse logging, OOB Omnichannel escalation, OOB topic authoring by
non-developers. CS provides all of this. Cost: maker must keep their CS agent in a Power
Platform environment.

**D2 — Surface = M365 Copilot first.** Reason: customer's primary deployment target.
Standalone SWA is the same code, deployed differently, for the off-Copilot channel.

**D3 — Custom UI shape = single-file React bundle, not iframe.** Reason: skybridge sandbox
in M365 Copilot does not reliably mount iframes from external origins, even with `frameDomains`
in CSP. Documented in [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md). Cost: widget bundle is
~120 KB gzip; we cannot reuse the SWA HTML shell as the widget HTML.

**D4 — Transport = `CopilotStudioWebChat.createConnection()` from
`@microsoft/agents-copilotstudio-client`.** Reason: this is OOB. Hand-rolling the streaming
transport (which we did initially) re-implements behavior the SDK gets right. Cost: the SDK
expects React + `botframework-webchat`; we adopt those.

**D5 — Escalation = OOB CS → D365 Omnichannel.** Reason: CS has a one-click Settings →
Agent transfers → Omnichannel connector. Generic broker abstraction is documented in
[ARCHITECTURE.md](ARCHITECTURE.md) for v2. Cost: customers without D365 Omnichannel must
wait for v2 or bring their own broker via CS's Power Automate connector.

**D6 — Conversation id = CS-owned.** Reason: only one source of truth. The widget asks the
SDK for the conversation, the SDK gets the id from CS, the id flows to escalation. We never
mint our own. Cost: nothing — this is pure discipline.

**D7 — State store for escalation map = none in v1.** Reason: OOB CS Omnichannel handoff
doesn't require us to store state. The CS conversation id is the join key, CS holds the
state, Omnichannel holds the broker side. Cost: when we add brokers other than D365 Omnichannel
in v2, we'll add Azure Tables.

**D8 — MCP server = thin, single-purpose.** It serves the widget HTML and (in v2) exposes
escalation tools for non-OOB brokers. It does not proxy chat traffic. Reason: the chat hot
path goes widget → CS SDK → CS directly. Putting MCP in the path adds latency and a
failure mode for no architectural gain.

**D9 — License = MIT, repo = public.** Reason: this is a reference implementation we want
forks of.

**D10 — No multi-tenant SaaS.** One MCP server deployment serves one CS agent. Reason: scope.

## 12. Out of scope but tracked

- **Voice channel** (CS supports it; we haven't tested in M365 Copilot)
- **File upload from widget to CS** (CS supports it; widget surfaces it OOB via WebChat
  Composer; not in our test matrix yet)
- **Cross-tenant scenarios** (current architecture is single-tenant)
- **Multi-region deploy** (Bicep template targets one region; multi-region is a fork-time
  modification)

## 13. Glossary

- **CS** — Microsoft Copilot Studio
- **DA** — Declarative Agent (Microsoft 365 Copilot extension type)
- **MCP** — Model Context Protocol (the spec the DA uses to talk to our server)
- **MCP Apps / OpenAI Apps SDK** — the widget-rendering extensions on top of MCP
- **Skybridge** — codename for the sandboxed iframe runtime hosting MCP Apps widgets in
  M365 Copilot / ChatGPT
- **CDX** — Microsoft customer dev experience tenant (used for sample / demo)
- **Wave-2** — current generation of CS, used by `@microsoft/agents-copilotstudio-client`
  via the Direct Engine API (NOT classic Direct Line)
- **OOB** — out-of-the-box, i.e. a feature the platform provides without us writing code

## 14. Spec ownership and review cadence

- This file is owned by the project lead.
- Reviewed at every major version (v0.X → v1.0 → v2.0).
- Any change to a §3 goal, §4 non-goal, or §11 decision requires a PR comment and a sign-off.
- Architectural specifics live in [ARCHITECTURE.md](ARCHITECTURE.md). UI specifics live in
  [UI-POSSIBILITIES.md](UI-POSSIBILITIES.md). Branding contract in [MAKER-CONFIG.md](MAKER-CONFIG.md).
