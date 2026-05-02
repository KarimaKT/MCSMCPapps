# What is this thing? — terminology disambiguation

> Microsoft's "Copilot extensibility" surface has at least 6 names that mean overlapping things. Customers ask **"is it an M365 agent? a Copilot Studio agent? a declarative agent? an Agents SDK agent? a Teams app?"** — yes to all of them, in different layers. This doc is the rosetta stone.

## The one-paragraph answer

**MCSMCPapps is a Declarative Agent (DA) for Microsoft 365 Copilot, packaged as a Microsoft 365 app, that uses an API plugin (with a `RemoteMCPServer` runtime) to call a Model Context Protocol (MCP) server, which serves a UI widget that hosts a custom Web Chat client built on the Microsoft 365 Agents SDK Copilot Studio Client, which talks to a Microsoft Copilot Studio (Wave-2) agent over the Bot Framework Activity protocol via the Power Platform Direct Engine endpoint.**

That's seven nouns. Each does a specific job:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Microsoft 365 Copilot                                               │
│   the host UI where the agent picker lives                          │
└────────────────────────────────────────┬────────────────────────────┘
                                         │
┌────────────────────────────────────────▼────────────────────────────┐
│ Declarative Agent (DA)                                              │
│   schema v1.6 declarativeAgent.json                                 │
│   defines: name, instructions, conversation_starters, actions[]     │
│   packaged inside a Microsoft 365 app manifest                      │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ actions[].file
┌────────────────────────────────────────▼────────────────────────────┐
│ API plugin manifest (ai-plugin.json)                                │
│   schema v2.4                                                       │
│   declares: functions[], runtimes[]                                 │
│   runtime.type = "RemoteMCPServer"                                  │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ MCP over HTTP
┌────────────────────────────────────────▼────────────────────────────┐
│ MCP server                                                          │
│   built with @modelcontextprotocol/sdk (Streamable HTTP transport)  │
│   tool: openCopilotStudioChat                                       │
│   resource: ui://...   (the UI widget HTML)                         │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ ui.resourceUri (MCP Apps)
┌────────────────────────────────────────▼────────────────────────────┐
│ UI widget (sandboxed iframe in M365 Copilot)                        │
│   served by widget-renderer.usercontent.microsoft.com               │
│   our HTML iframes the Static Web App                               │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ HTTPS
┌────────────────────────────────────────▼────────────────────────────┐
│ Custom Web Chat (Vite SPA, this repo)                               │
│   uses @microsoft/agents-copilotstudio-client                       │
│      (a package from the Microsoft 365 Agents SDK)                  │
│   acquires Power Platform API token via MSAL                        │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ Bot Framework Activity protocol
                                         │ over the Power Platform Direct Engine
┌────────────────────────────────────────▼────────────────────────────┐
│ Microsoft Copilot Studio agent (Wave-2)                             │
│   topics, knowledge, actions, Power Automate flows, etc.            │
└─────────────────────────────────────────────────────────────────────┘
```

## The two things both named "M365 Agents" — critical to keep straight

| | **M365 Agents Toolkit** | **M365 Agents SDK** |
|---|---|---|
| What | A **VS Code extension** | A set of **npm packages** |
| When it runs | At **build / publish time** (you click Provision / Publish) | At **runtime** (in the user's browser) |
| Where it lives | Your developer laptop | Inside the deployed Web Chat SPA |
| What it produces | A `.zip` app package + Teams catalog entry | HTTP requests to the CS Direct Engine endpoint |
| Specific identifier in this project | `teamsdevapp.ms-teams-vscode-extension` | `@microsoft/agents-copilotstudio-client` |
| Could you replace it? | Hand-write the manifest + zip + admin-portal-upload manually | Hand-write the SSE/JSON-RPC client to the Power Platform endpoint manually |
| Used by this project? | ✅ yes — once, to publish the DA | ✅ yes — every time a user opens the chat |

**Both are Microsoft products that have "Agents" in their name. They do completely different things at completely different times. Knowing which one is which prevents most confusion in this whole stack.**

## "Is this a [X]?" — the disambiguation table

When someone asks any of these questions, here is the precise answer.

| Question | Answer | Why |
|---|---|---|
| "Is this a Microsoft 365 Copilot agent?" | ✅ Yes (in the DA sense) | A Declarative Agent IS a Microsoft 365 Copilot agent; that's the canonical name. |
| "Is this a declarative agent?" | ✅ Yes | The user-visible piece in M365 Copilot is a DA. |
| "Is this a Copilot Studio agent?" | ✅ Yes (the brain is) | The conversational AI behind the chat lives in Copilot Studio. The DA is just a launcher in front of it. |
| "Is this an M365 Agents SDK agent?" | ⚠️ Mostly no — we **use** the SDK as a runtime client; we do not host an Agents-SDK-runtime agent | The **M365 Agents SDK** is a *runtime client library* the Web Chat uses to talk to Copilot Studio. It is **not** an agent runtime. Our agent's runtime is Copilot Studio. |
| "Did you use the M365 Agents Toolkit?" | ✅ Yes — to *author and publish* | The **M365 Agents Toolkit** is a *VS Code build-time extension*. We used it once: to scaffold + zip + validate + publish the DA app package to the tenant catalog. It does not run at runtime. |
| "Wait, that's confusing — Agents Toolkit AND Agents SDK?" | They are different things with overlapping names | **Toolkit = build-time VS Code extension** (scaffolds + publishes the DA). **SDK = runtime npm package** (the SPA uses it to chat with CS). They never overlap at runtime. We used both, in different layers. |
| "Is this a Bot Framework bot?" | ⚠️ Sort of, internally | CS Wave-2 speaks the Bot Framework **Activity protocol** internally. But you don't write Bot Framework code; CS hosts everything. |
| "Is this a Teams app?" | 🚫 No (in surface), but ✅ yes (in distribution) | The package is technically a Microsoft 365 app manifest (which Teams Admin Center calls a "Teams app" out of habit). The app **runs only in M365 Copilot** because the manifest declares only `copilotAgents.declarativeAgents` — see [M365-COPILOT-ONLY-DEPLOYMENT.md](M365-COPILOT-ONLY-DEPLOYMENT.md). |
| "Is this an Outlook add-in?" | 🚫 No | The manifest declares no `extensions` block. |
| "Is this an Office add-in?" | 🚫 No | Same. |
| "Is this an MCP server?" | ✅ The launcher half is | We host an MCP server. It exposes one tool with a UI resource. The chat itself is not MCP. |
| "Is this an MCP App?" | ✅ Yes | "MCP App" is the spec name for an MCP server that ships UI widgets. Our MCP server is one. |

## "What tool do I author this in?" — the disambiguation table

| Tool | What it's for | Can author this project? |
|---|---|---|
| **Microsoft 365 Copilot — Agent Builder** (no-code, in chat UI) | Quick personal DAs with WebSearch / OneDrive / SharePoint grounding | ❌ **No.** The Agent Builder UI does not surface API plugin / MCP runtime configuration. You cannot attach a `RemoteMCPServer` action from this UI today. |
| **Copilot Studio** (low-code, copilotstudio.microsoft.com) | The actual conversational AI: topics, knowledge, actions, Power Automate flows, generative answers | ✅ **Yes — for the CS agent half.** This is where you build the topics. ❌ **No** for the DA / MCP server half — that's not authored in CS. |
| **Microsoft 365 Agents Toolkit** (VS Code extension) | Full DA authoring incl. `actions[]`, MCP server scaffolding, app package zip, sideload, tenant publish | ✅ **Yes — for the DA half.** This is the only authoring path that supports our `RemoteMCPServer` runtime today. |
| **Power Platform CLI** (`pac`) | CS solution import/export, environment management | ⚠️ Optional. Useful for moving the CS agent across tenants. |
| **`@microsoft/agents-copilotstudio-client`** (npm package) | Browser/Node client SDK for talking to a CS agent over Direct Engine | ✅ **Yes — for the Web Chat half.** This is what the SPA uses to chat with the CS agent. |
| **`@modelcontextprotocol/sdk`** (npm package) | Building MCP servers (and clients) | ✅ **Yes — for the MCP server half.** This is what powers our launcher. |

So the **easiest correct setup** is:

1. **Copilot Studio (web)** → build / open your CS agent
2. **VS Code + M365 Agents Toolkit extension** → DA scaffolding, MCP server scaffolding, sideload to tenant
3. **GitHub Actions** → CI/CD for the SPA + MCP server
4. **Browser** → test in M365 Copilot

You **cannot** skip step 2 with the Agent Builder UI — at least not as of May 2026.

## Two sentences a customer can write down

> *Our agent is a **Microsoft 365 Copilot Declarative Agent** that calls a **remote MCP server** (per the MCP Apps spec) to render a **custom Web Chat** UI widget; the widget talks to our **Microsoft Copilot Studio Wave-2 agent** via the **M365 Agents SDK Copilot Studio Client** over the **Bot Framework Activity protocol** through the **Power Platform Direct Engine** endpoint.*

> *Authored in **Copilot Studio** (the agent brain) plus **Microsoft 365 Agents Toolkit** in VS Code (the DA + MCP launcher). The no-code Agent Builder in M365 Copilot cannot author this pattern today because it does not expose MCP/`RemoteMCPServer` runtime configuration.*

## Easiest setup recipe (the verb sequence)

For someone starting from zero on a fresh machine:

| # | Verb | Tool | Outcome |
|---|---|---|---|
| 1 | Sign in | <https://copilotstudio.microsoft.com> | A CS agent exists with at least one topic |
| 2 | Capture IDs | CS Settings → Advanced + Channels → Web app | environmentId, schemaName, MCP audience |
| 3 | Create app reg | <https://entra.microsoft.com> in CS tenant | clientId; SPA platform; redirect URIs; `Power Platform API → CopilotStudio.Copilots.Invoke` consented |
| 4 | Configure CS auth | CS Settings → Security → Authentication → Manual Entra V2 federated | CS agent will accept tokens from your app reg |
| 5 | Clone scaffold | `git clone https://github.com/KarimaKT/MCSMCPapps` | Working code for SPA + MCP server + DA |
| 6 | Fill `.env` | `webchat-ui/.env` and `mcp-server/.env` | All `VITE_*` and `SWA_ORIGIN` set |
| 7 | Provision Azure | `az deployment group create` (Bicep) | SWA + App Service running |
| 8 | Push | `git push` | GitHub Actions deploys both apps |
| 9 | Provision M365 | VS Code → M365 Agents Toolkit → Lifecycle → Provision | Teams app entry created in your CDX tenant |
| 10 | Publish | Same toolkit → Lifecycle → Publish | App in tenant catalog with status "Pending" |
| 11 | Approve | Teams Admin Center → Manage apps → click Publish on the pending card | App becomes "Published" in catalog |
| 12 | Pin | <https://admin.microsoft.com> → Copilot → Manage agents → Pin to all | Agent appears in users' Copilot |
| 13 | Test | <https://m365.cloud.microsoft/chat> → agent picker → "Open my agent" | The widget renders, MSAL silent SSO completes, chat connects |

Steps 1, 2, 3, 4 need a tenant admin (or someone with the right delegated permissions). Steps 5–8 are pure dev. Steps 9–12 are admin again. Step 13 is the user.

## What you do NOT need

- ❌ Bot Framework Composer (irrelevant for Wave-2 CS)
- ❌ Bot Framework SDK directly (CS hosts the bot)
- ❌ `botframework-webchat` npm package (it doesn't speak Wave-2 Direct Engine)
- ❌ Direct Line secret in the browser (we use Entra SSO instead)
- ❌ A separate Teams app (the manifest can be Copilot-only — see [M365-COPILOT-ONLY-DEPLOYMENT.md](M365-COPILOT-ONLY-DEPLOYMENT.md))
- ❌ Azure OpenAI (CS hosts its own model)
- ❌ Power Apps / Power Pages (orthogonal)
- ❌ Microsoft Foundry (different platform)

## When does this list change?

- **When Microsoft adds MCP authoring to the no-code Agent Builder UI** (likely 2026/27): step 9–10 simplifies. Steps 1–8 stay.
- **When Wave-2 CS exposes a fully managed Web Chat client** (i.e. you don't have to host the SPA yourself): step 7 simplifies; the SPA goes away.
- **When CS Wave-2 supports proactive messages**: the "long-running conversation" pitch becomes "long-running + push" — bigger story.

Until then: this doc is the right map.
