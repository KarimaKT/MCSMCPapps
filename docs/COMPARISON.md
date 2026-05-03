# Comparison — when to use this pattern, when not to

> If you only read one section, read [§1 The decision matrix](#1-the-decision-matrix).

## 1. The decision matrix

You want to embed a Copilot Studio agent somewhere. Pick the right surface:

| If you want… | Use… | Burden |
|---|---|---|
| **Plain CS chat inside M365 Copilot.** Standard look, OOB. | CS native **Microsoft 365 Copilot** channel | maker: 5 min config, no code; admin: approve once |
| **Custom-branded UI inside M365 Copilot.** Charts, layouts, your design. | **This pattern (DA + MCP + skybridge widget)** | maker: 30 min from fork; admin: approve once + on every update; engineering: maintain MCP server |
| **Plain CS chat inside Teams personal scope.** | CS native **Microsoft Teams** channel | maker: 5 min, no code |
| **Branded WebChat embedded on your public website.** | This pattern's **standalone SWA** (same React source) | maker: 30 min; need an Entra app reg |
| **Voice / phone.** | CS native **Microsoft Teams Phone / ACS** channel | platform-dependent |
| **Slack / FB Messenger / etc.** | CS **3rd-party channels** OR custom Bot Framework adapter | depends |
| **Custom UI everywhere** (Teams personal tab + M365 Copilot + your website) | Compile this React app to multiple bundle targets | engineering: maintain three deploy targets |

Most customers want one of: native channel (cheap, standard) OR this pattern (premium, custom).
Don't pick this pattern unless the custom UI is the actual differentiator.

## 2. Pros and cons of this pattern

### 2.1 Pros

- ✅ **Full UX control** inside M365 Copilot — your charts, your colors, your layout
- ✅ **CS as brain** — keep all your topics, knowledge, agentic flow, Dataverse logging
- ✅ **OOB live-agent escalation** via D365 Omnichannel (CS Settings → Agent transfers — no
  code from us)
- ✅ **One React source → two surfaces** (M365 Copilot widget + standalone SWA)
- ✅ **Conversation id discipline** (CS owns the only id; we never mint a parallel one)
- ✅ **Streaming OOB** via `botframework-webchat` Composer
- ✅ **Adaptive Cards OOB** — same renderer as Teams, M365 Copilot, BotFramework
- ✅ **MIT licensed reference implementation** — fork it, use it
- ✅ **Modular code** — every layer has a clean interface (see [ARCHITECTURE.md §10](ARCHITECTURE.md#10-modularity-contracts))

### 2.2 Cons

- ❌ **Admin approval friction** on every update (see [FEATURE-REQUESTS.md §1.2](FEATURE-REQUESTS.md))
- ❌ **Skybridge MIME / `_meta` shape is not yet documented in Microsoft Learn** — relies on
  reverse-engineering Microsoft's `mcp-interactiveUI-samples` reference repo
- ❌ **Iframing external origins from inside the widget is not supported** — you must bundle
  your UI as a single-file HTML
- ❌ **Custom UI ≠ deeply integrated** — your widget renders inside a frame; M365 Copilot's
  message scrollback, attachments panel, etc. are still the host's
- ❌ **More moving parts** than the native channel: Azure App Service + DA manifest + MCP
  server + Entra app reg
- ❌ **Cost** — App Service B1 (~$13/mo) + SWA Free + storage ≈ $15/mo per environment
- ❌ **Versioning churn** — DA / MCP Apps / OpenAI Apps SDK contracts are evolving; expect
  to bump server versions and re-publish

### 2.3 When this is the wrong pattern

- You don't actually need custom UI. CS plain chat in M365 Copilot answers most asks. Use the
  native channel.
- You don't have a CS agent and don't plan to build one. Use Azure AI Foundry, Semantic Kernel,
  or build a hand-rolled DA + MCP from scratch.
- You need offline-first or air-gapped. Skybridge / M365 Copilot / CS are cloud-only.
- Your customer admin is not willing to approve app updates more than once a quarter. The
  velocity hit makes this pattern impractical for them today (until [FEATURE-REQUESTS.md §1.2](FEATURE-REQUESTS.md) is fixed).

## 3. Burden-of-responsibility chart

When you use this pattern, who owns what?

| Responsibility | You (the maker / forking ISV) | Microsoft (CS) | Microsoft (M365 Copilot host) | Microsoft (D365 Omnichannel) |
|---|---|---|---|---|
| Topic authoring, knowledge sources, agentic flow | | ✅ platform | | |
| Conversation memory, turn state | | ✅ in CS | | |
| Dataverse logging | | ✅ OOB | | |
| Reasoning / LLM calls | | ✅ in CS | | |
| Streaming activities | ⚠️ wired correctly | ✅ Direct Engine API | | |
| Adaptive Cards rendering | | ⚠️ schema | ✅ in widget via OOB BotFramework Web Chat | |
| Custom UI (charts, layouts, brand) | ✅ React in `webchat-ui/` | | | |
| Hosting your UI | ✅ Azure App Service + SWA | | | |
| Skybridge widget rendering | | | ✅ host-side | |
| Tool routing (model decides to call your tool) | ⚠️ tool description | | ✅ host model | |
| MCP protocol transport | ✅ `mcp-server/` (thin) | | ✅ M365 Copilot client | |
| Entra app reg, SSO | ✅ tenant config | | | |
| Token acquisition (widget side) | ✅ MSAL flows | | ✅ host bridge surfaces | |
| Live-agent queue, agent UX | | | | ✅ Omnichannel app |
| Live-agent SLA, staffing | ✅ business operation | | | ✅ Omnichannel platform |
| Approving the app in tenant | ⚠️ submit | | ✅ admin tooling | |
| Compliance, data residency | ✅ your config (App Service region, SWA region) | ✅ CS env region | | ✅ Omnichannel region |

Read it as: ✅ owns it; ⚠️ touches it but doesn't own it.

The maker's net: you own UI and hosting, you wire the pieces, CS does the brain work,
M365 Copilot is the surface, Omnichannel does the human handoff.

## 4. Cost comparison (single environment, monthly, USD, Apr 2026 list prices)

| Surface | Hosting | Auth / API | Storage | LLM | Other | Total |
|---|---|---|---|---|---|---|
| Native CS in M365 Copilot | $0 | included with M365 Copilot license | $0 | included | CS license per agent | ~$0 hosting |
| **This pattern** | App Service B1 ~$13 + SWA Free $0 | Entra free | minimal | included via CS | bandwidth ~$1 | **~$15** |
| Standalone SWA only | SWA Free $0 | Entra free | $0 | via CS | $0 | $0 hosting |
| Teams personal tab + bot | App Service B1 ~$13 | Entra free | minimal | via CS | bot channel reg $0 | ~$13 |
| Hand-rolled (Foundry + custom UI) | App Service P1v3 ~$200 | Entra free | minimal | Foundry per-token | varies | $200+ |

This pattern is cheap because CS provides the brain, the SWA Free tier is generous, and B1
is ample for demo / single-tenant SMB workloads. Production-scale (≥10 concurrent users with
strict SLA) wants P1v3 + Cosmos for state — see [ARCHITECTURE.md §11](ARCHITECTURE.md#11-future-work).

## 5. Migration paths

### 5.1 From native CS channel → this pattern

You already have a CS agent live in M365 Copilot via the native channel.

1. Disable the M365 Copilot native channel on your CS agent (or leave it on; both can coexist).
2. Fork this repo. Set the same env / schema in `webchat-ui/.env`.
3. Set your DA `manifest.json: id` and `developer.*` fields.
4. Build, deploy infra, publish DA.
5. Test M1–M6 in [TEST-PLAN.md](TEST-PLAN.md).

Risk: low. Your CS agent is unchanged. You're adding a new surface, not migrating off one.

### 5.2 From this pattern → CS native channel

You decided custom UI is not worth the friction.

1. Enable the CS native M365 Copilot channel in CS Studio.
2. Publish your CS agent.
3. Optionally remove the DA from your tenant (admin → uninstall app).
4. Decommission App Service.

Risk: low. You lose custom UI; everything else stays.

### 5.3 From hand-rolled custom DA → this pattern

You have a DA + MCP server you wrote from scratch and it has the empty-card / contract bugs
this repo solves.

1. Replace your widget HTML with this repo's single-file React bundle (or fork the
   `webchat-ui/` source if you want a different UI).
2. Replace your tool's `_meta` block with this repo's verified shape (see
   [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md)).
3. Verify with the MCP Inspector against your endpoint.

Risk: medium. You may have external dependencies or tools that don't directly map.

## 6. Comparable patterns (and why we didn't pick them)

| Pattern | Why it's tempting | Why we didn't pick it |
|---|---|---|
| Iframe of an external SPA inside the widget | Reuses your existing SPA verbatim | Skybridge sandbox doesn't reliably mount sub-iframes; OpenAI docs explicitly discourage; failed in our tests |
| Roll our own widget runtime (no skybridge) | Maximum freedom | Then you don't get rendered inside M365 Copilot — defeats the goal |
| Adaptive Card-only UI returned via tool content | OOB, no skybridge complexity | No interactive UI, no live chat, no streaming |
| Bot Framework + custom skill in front of CS | Mature SDK | Adds a layer we don't need; CS speaks Direct Engine directly to widgets |
| AgentApplication in front of CS | Resilience, multi-channel | Duplicates state CS already manages; violates conversation-id discipline |
| ChatGPT Apps (skip M365 Copilot) | Same widget contract | Different host, different audience; not what the customer asked for |

## 7. Productization opportunities

If Microsoft were to productize this pattern, what would they ship?

- **`npm create @microsoft/copilot-widget@latest`** — scaffold a working skybridge widget
  with branding, MSAL, BotFramework Web Chat, single-file build, in 1 command.
- **CS Studio "Add a custom UI" wizard** — pick a starter (chart-heavy, form-heavy,
  card-heavy), generate the DA + MCP server + widget repo, hook up your CS env id, deploy.
- **Hosted MCP server** — Microsoft hosts the MCP server portion as a managed service; maker
  brings only the widget HTML and CS env id.
- **Trusted publisher tier** — see [FEATURE-REQUESTS.md §1.2](FEATURE-REQUESTS.md).
- **Built-in escalation broker abstraction** in CS for non-Omnichannel brokers.

We are not Microsoft. But this repo is the closest thing to that productization until it
ships natively.

## 8. Decision aid: 30-second flowchart

```
Q1: Do you need a custom UI inside M365 Copilot?
    NO  → CS native M365 Copilot channel. Stop here.
    YES → Q2

Q2: Do you have (or are willing to create) a Copilot Studio agent?
    NO  → Different pattern (Foundry + custom DA + MCP). Not this repo.
    YES → Q3

Q3: Are you OK with admin approval friction on every update?
    NO  → Native channel today; revisit when FR §1.2 lands.
    YES → Q4

Q4: Do you need live-agent escalation?
    NO  → Use this pattern; ignore the Omnichannel parts.
    YES → Q5

Q5: Is your live-agent platform D365 Omnichannel for Customer Service?
    YES → Use this pattern as-is. CS native handoff covers it.
    NO  → Use this pattern but plan to extend with a custom escalation
          broker in v2 (see ARCHITECTURE.md §11).
```

## 9. Worked examples

- **Eurozone Analyst** (this repo's reference). Custom UI, CS brain, no escalation needed
  in v0.5. Picks the pattern. Cost ~$15/mo. Maker time ~30 min.
- **HR consultant management** (Microsoft's `trey-research` sample). Multiple custom UI
  surfaces (dashboard, profile cards, bulk editor). CS or non-CS brain. Same skybridge
  pattern. See `mcp-interactiveUI-samples` repo.
- **Field service dispatch** (Microsoft's `fieldops` sample). Map widget, dispatch planning
  UI. Same pattern.
- **Approvals queue** (Microsoft's `approvals-box` sample). List + detail widgets. Same
  pattern.

The pattern is well-trodden by Microsoft's own samples. This repo adds: CS as brain,
escalation via Omnichannel, dual SWA + widget delivery, productization-grade docs.
