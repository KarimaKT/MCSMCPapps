---
title: "Better together: a Copilot Studio agent inside Microsoft 365 Copilot, with a UX you actually control"
draft: true
audience: "Developers, solution architects, ISV partners, Microsoft customers building agentic experiences"
suggested_publication_venues:
  - Microsoft Tech Community (Microsoft 365 Copilot blog or Copilot Studio blog)
  - Microsoft Learn Architecture Center (paired with the architecture article)
  - Personal LinkedIn / dev.to (community amplification)
estimated_read_time: 9 minutes
---

# Better together: a Copilot Studio agent inside Microsoft 365 Copilot, with a UX you actually control

> **Status: blog draft.** Lives in the repo so the words live with the code. Edit freely; ship when ready.

---

## The wish list every Copilot Studio team has

If you build with Microsoft Copilot Studio, you've probably nodded along to all of these:

1. *"I want my agent reachable from **Microsoft 365 Copilot**, where my users already are."*
2. *"But I don't want the host LLM **rephrasing** my agent's answers."*
3. *"And I need **long-running** topics — multi-step approvals, generated reports, orchestrated flows — without per-turn timeouts cutting them off."*
4. *"My answers include **rich content**: tables, charts, Adaptive Cards, files. The default Copilot response surface mangles them."*
5. *"I want **my brand**, my colors, my logo, my voice."*
6. *"I want **single-sign-on** — no extra prompts on top of the M365 sign-in the user already did."*
7. *"I want a **reproducible**, **maker-friendly** workflow my team can clone and re-skin per customer."*
8. *"I want to **only** appear in M365 Copilot — not Teams, not Outlook, not Word add-ins. Compliance is asking."*
9. *"And ideally I'd like to **side-load a custom UI** — maybe a document, a game, a dashboard — alongside the chat."*

Pick any one and there's a blog post about it. Pick all nine and you'd think you need a custom platform.

You don't. **They all fall out of one architectural choice**, made possible by three Microsoft pieces that just shipped: **Declarative Agents (DAs)**, the **MCP UI Apps spec**, and the **Microsoft 365 Agents SDK Copilot Studio Client**.

This post is about the pattern that connects them, what each of the nine wishes looks like once it's wired up, and the hardest-won lessons from a working reference build (`MCSMCPapps`, link below).

---

## The shape of the better-together pattern

```
M365 Copilot (the host)
   │
   ▼
Declarative Agent  ── matches user prompt, calls one tool
   │
   ▼
Remote MCP server  ── returns a UI widget descriptor (per the MCP Apps spec)
   │
   ▼
Widget host iframe (Microsoft-managed sandbox, isolated origin)
   │
   ▼
Your custom Web Chat (Static Web App)
   │     ── markdown, charts, Adaptive Cards, your branding, your interactions
   ▼
Copilot Studio agent (Wave-2)
         ── topics, knowledge sources, actions, Power Automate flows
```

That's it. One DA, one MCP server, one Web Chat, one CS agent. Each piece does the **single thing it's best at**:

- **Declarative Agent** decides when to launch.
- **MCP server** decides *what* to render (a widget URL).
- **Widget host** sandboxes the third-party HTML securely.
- **Your Web Chat** owns the user experience.
- **Copilot Studio** owns the intelligence.

When they cooperate, every wish on the list becomes a single, scoped concern.

---

## Wish-by-wish: how the pattern delivers

### 1 + 2. "In M365 Copilot, but without the host LLM rewriting answers"

The DA matches the launcher phrase ("open my agent") and immediately hands off to the MCP tool. The tool returns a **widget descriptor** — a UI surface that the host renders directly. M365 Copilot doesn't paraphrase or rewrite the widget content; it just hands the iframe over.

The conversation that happens inside that iframe is **a private, direct connection** to your Copilot Studio agent. The host LLM never sees an utterance, never edits a reply, never times out a turn. Your topic logic talks to your user as itself.

### 3. "Long-running topics"

Because the host LLM is out of the loop, the **per-turn budget M365 Copilot enforces on its own answers does not apply** to anything inside the widget iframe. Your Copilot Studio topic can run for two minutes calling Power Automate; it can stream progress events; it can resume across an idle. The conversation lives as long as the widget panel stays open.

In practice this is the wish that's hardest to deliver any other way. Custom Engine Agents are subject to the host's turn budget. This pattern routes around it without a hack.

### 4. "Rich content done right"

The widget is your HTML. Inside it, rendering is a deliberate engineering choice, not a constraint imposed by the host:

- **Markdown with GFM tables, headings, lists, code blocks, citations** — `marked` + `DOMPurify`.
- **Adaptive Cards with form round-trip** — the official `adaptivecards` SDK.
- **Inline images** (data URLs from a topic, or SAS URLs from Blob Storage).
- **Suggested-action buttons** that re-enter the topic.
- **Charts**, **Mermaid diagrams**, **math equations** — opt-in libraries the maker can wire up.

In the MCSMCPapps reference build, a CS topic returns a generated PNG chart inline with its analysis, formatted as a McKinsey-style brief. That experience is impossible to deliver in the default Copilot response area; trivial inside the widget.

### 5. "My brand, my voice"

Eight environment variables (`VITE_BRAND_AGENT_NAME`, `VITE_BRAND_LOGO`, `VITE_BRAND_ACCENT_COLOR`, …) pin every visible piece of the UI at build time. Forking the project for a new customer is editing that block of `.env`, pushing, deploying. No TypeScript edits to rebrand. Branding is **build-time only**, intentionally — runtime rebranding by the bot would couple chat content to UI surface and break the maker's single source of truth.

### 6. "SSO that just works"

Inside the widget, the SPA acquires a **Power Platform API access token** via MSAL silent flow. The user is already signed into M365 Copilot in the same browser session, so the silent acquisition succeeds without a popup. No second prompt. No second password. No "trust this app" except the one-time admin consent the tenant administrator already did.

The Copilot Studio agent is configured for **Manual Entra V2 with federated credentials**, so there is **no client secret to rotate** anywhere in the stack. Compliance teams stop asking the rotation question.

### 7. "Reproducible, maker-friendly workflow"

This is the part most blogs skip. The reference build documents:

- **Eight ingredients** that a maker provisions once.
- **Twelve commandments** — the precise lessons that cost real time during the build (manifest schema must be `v2.4`, not `v2.3`; `runtime.spec.url`, not `runtime.url`; Teams app version must not start with `0`; Power Platform API service principal must already exist in the CS tenant; …).
- A **GitHub Actions CI gate** that fails the build if anyone introduces a non-Copilot capability block.
- A **maker config doc** so a customer can clone the repo, edit eight variables, and have their own branded agent in a working state in roughly half a day.

The full BUILD-GUIDE is a no-AI walk-through: every command, every portal click, every verification step. Hand it to engineering and they ship it.

### 8. "Only in M365 Copilot — not Teams, not Outlook, not Word"

This is the wish I see most often when pitching to compliance-conscious customers. They love the agent; they don't want it surfacing inside Teams chat or as an Outlook add-in.

The answer is structural. The Microsoft 365 app manifest declares **capability blocks**. Each block grants the app access to one surface family:

| Manifest block | App appears in |
|---|---|
| `bots` | Teams chat |
| `staticTabs` (without Copilot context) | Teams personal tab, Outlook |
| `composeExtensions` | Teams + Outlook compose |
| `meetingExtensionDefinition` | Teams meetings |
| `extensions` | Word/Excel/PowerPoint/Outlook add-ins |
| `copilotAgents.declarativeAgents` | **Microsoft 365 Copilot only** |

A package whose manifest declares **only** `copilotAgents.declarativeAgents` cannot appear in Teams, Outlook, or Word. The unified app catalog (administered through Teams Admin Center, but consumed by every M365 surface independently) returns this app **only** in response to the M365 Copilot surface query. Teams' surface query returns nothing for it. Outlook's likewise. Word's likewise.

It's a structural guarantee, not a policy one. It's also CI-enforceable: a pre-merge check rejects any PR that adds a forbidden block. The MCSMCPapps repo ships exactly this guard so the contract survives long after the original developer moves on.

### 9. "Side-by-side custom UI alongside the chat"

The widget's HTML is yours. There's nothing forcing it to be a single chat panel. The MCP Apps spec exposes three display modes:

| Mode | Looks like | Use case |
|---|---|---|
| `inline` | A panel in the Copilot pane | Standard chat |
| `fullscreen` | Takes over the whole pane | Document editor + AI; data dashboard + chat; code review + reviewer |
| `pip` | Picture-in-picture overlay | Persistent assistant while user navigates |

In `fullscreen` mode, **half your widget can be Monaco** showing a code diff while the other half is the chat coaching the reviewer. Or **Quill** editing a document the topic has been writing. Or a **MakeCode Arcade game** the agent is playing against you (a sister project I'm prototyping).

The bot drives the other pane via **outbound `event` activities**: a JSON Patch on the document, a move on the game board, a row selection on the dashboard. The user clicks back into the chat as if they typed there. State stays in sync because it's all one widget HTML.

The pattern that makes this work — **CS event activities as the lingua franca between chat and UI** — is the same primitive used for the live-agent escalation orchestrator (handing the user off to a real human via Genesys/D365/etc.) and for the output-language interception trigger (translating every message regardless of source). One primitive, many applications. That's how a small set of pieces compounds.

---

## What this isn't

Honest scope so the post doesn't oversell:

- **Not a Microsoft 365 Copilot Agent Builder build.** The no-code Agent Builder UI doesn't expose `RemoteMCPServer` runtime configuration today; you need the Microsoft 365 Agents Toolkit in VS Code.
- **Not multi-tenant out of the box.** Single-tenant CDX or single-tenant production is the v1 audience. Multi-tenant SaaS is a separate (well-understood) lift on top.
- **Not for proactive messages.** The bot can't ping the user when nothing is open. The chat must be in front of them. (Add a Teams channel for proactive needs.)
- **Not a replacement for native channels.** If your audience is in Teams chat all day, build a Teams app. If they're in Outlook, build an Outlook add-in. This pattern is for the audience that lives in M365 Copilot.

---

## The lessons that cost real time

Sharing these so the next builder skips them:

1. **Plugin manifest schema must be `v2.4`.** The validator's pair of "unrecognized member" + "required member missing" errors firing together means *wrong schema version*, not wrong shape.
2. **Teams app `version` cannot start with `0`.** Tenant-catalog publish rejects `0.x.y`. Start at `1.0.0`.
3. **The Power Platform API service principal often isn't in the customer tenant by default.** Without it, the API permission picker doesn't even show "Power Platform API". One-time fix via Microsoft Graph PowerShell: `New-MgServicePrincipal -AppId 8578e004-…`.
4. **Anonymous MCP server is fine.** It only controls who can invoke the tool. The chat the tool returns enforces its own Entra SSO at the browser-to-CS link, independently. Two unrelated boundaries.
5. **Copilot Studio Wave-2 doesn't speak classic Direct Line.** Use `@microsoft/agents-copilotstudio-client` from the Microsoft 365 Agents SDK, not `botframework-webchat`.
6. **`@microsoft/agents-copilotstudio-client` (the SDK) ≠ Microsoft 365 Agents Toolkit (the VS Code extension).** Two different products that both have "Agents" in the name. The Toolkit is build-time scaffolding; the SDK is the runtime client. We use both, in different layers.

Full annotated list: `docs/FINAL-RECIPE.md` in the reference repo.

---

## Try it yourself

Reference implementation: <https://github.com/KarimaKT/MCSMCPapps>

What's in there:

- Complete BUILD-GUIDE (no AI required to follow).
- The eight `VITE_BRAND_*` knobs to make it your own.
- Bicep + GitHub Actions for the SWA + the MCP server App Service.
- The Declarative Agent + Microsoft 365 Agents Toolkit project, ready to Provision/Publish.
- A working tic-tac-toe sister project (`ArcadeVsAgent`, design only) that demonstrates the side-by-side pattern.
- Docs covering: auth boundaries, UI possibilities, capabilities matrix, a Microsoft Learn Architecture Center draft, a customer-facing "M365-Copilot-only" deployment + verification + CI guard.
- A Copilot Studio "skill" that helps other agent builders apply the pattern.

If you fork it and rename, keep the manifest scope check workflow turned on. That's what makes the M365-Copilot-only guarantee survive PRs from the future.

---

## Why the timing matters

Each of these three pieces is **brand new**:

- **Microsoft 365 Copilot Declarative Agents** — generally available, schema 1.6 in 2026.
- **MCP Apps spec** — interactive UI widgets in DAs, March 2026.
- **Microsoft 365 Agents SDK** — the `@microsoft/agents-copilotstudio-client` library reached 1.5 GA in April 2026.

Stacking them produces something that wasn't possible six months ago: a Copilot Studio agent that lives **in** Microsoft 365 Copilot, with a UI **you** control, surfaced on a **single channel** by structural guarantee, with no client secret to rotate, no host LLM rewriting your replies, no per-turn timeout killing your long-running topics, and a CI gate that keeps it that way.

That's the better-together story. Three Microsoft platforms, one customer outcome, and a clean repo to crib from.

---

*Reference build: <https://github.com/KarimaKT/MCSMCPapps>. Sister project (game-vs-agent design): <https://github.com/KarimaKT/ArcadeVsAgent>.*

*If you're a Microsoft FTE: this would be a good fit for the Microsoft 365 Copilot blog or the Copilot Studio blog. The architecture article in the repo (`docs/ARCHITECTURE-CENTER-DRAFT.md`) is structured for direct submission to the Microsoft Learn Architecture Center.*
