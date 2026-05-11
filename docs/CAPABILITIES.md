# MCSMCPapps — capabilities & demo plan

> **⚠️ STALE on rendering details — was written for the v0.5 BotFramework Web Chat-based widget.** The capability matrix (markdown, Adaptive Cards, citations, suggested actions, forms, etc.) is conceptually right — those features all ship in v0.7 — but the implementation rows that name `botframework-webchat`, `dist-widget/`, or `Composer + BasicWebChat` are obsolete. For current rendering reality, see [CS-PARITY.md](CS-PARITY.md). Demo script ideas in this file are still useful.

> Authoritative inventory of what this pattern can do end-to-end. Lives next to [BUILD-GUIDE.md](BUILD-GUIDE.md). When demoing, walk through the phases below in order.

## TL;DR

The Declarative Agent + MCP App + custom WebChat + Copilot Studio pattern lets you build **anything a modern web chat can do**, with full Microsoft 365 SSO, hosted in the M365 Copilot pane, and free of the host LLM's per-turn timeouts.

This document catalogs the features the runtime supports, plus a recommended **demo script** that exercises each one.

---

## Capability matrix

### Content rendering

| Feature | Mechanism | Status in this repo | Demo idea |
|---|---|---|---|
| **Markdown** (full GFM) | `marked` + custom typography CSS | ⏳ Phase 7 Chunk B | Bot returns a 3-paragraph briefing with `## headers`, lists, links |
| **GFM tables** | Markdown tables → `<table>` + striped CSS | ⏳ Phase 7 Chunk B | Bot returns a comparison table of EU member states |
| **Code blocks with syntax highlighting** | `highlight.js` (common langs only) | ⏳ stretch | Bot returns SQL or Python snippet |
| **Inline images** | Markdown `![]()` → `<img>` lazy-loaded | ⏳ Phase 7 Chunk B | Bot embeds a Wikimedia chart |
| **Adaptive Cards** | `adaptivecards` SDK; render JSON to DOM | ⏳ Phase 7 Chunk B | Bot returns a fact set: "GDP, Inflation, Population" |
| **Rich reports / professional headers** | Markdown OR Adaptive Card with column layout | ⏳ Phase 7 Chunk B | Topic generates a McKinsey-style brief in markdown |
| **Sanitized raw HTML** | `DOMPurify` allowlist; embedded inside markdown HTML blocks | ⚠️ optional | Hand-styled email-template-like outputs |
| **Math equations** | KaTeX, conditional load | ❌ skip | LaTeX → equations |
| **Mermaid diagrams** | `mermaid`, conditional load | ❌ skip | Sequence/gantt/flow diagrams |
| **Charts** | Chart.js or Vega-Lite from JSON spec | ❌ skip | Bot sends Vega spec → renders interactive chart |

### Interactivity

| Feature | Mechanism | Status | Demo idea |
|---|---|---|---|
| **Suggested actions / buttons** | `suggestedActions.actions` row beneath last bot message | ⏳ Phase 7 Chunk B | Greeting offers 3 starter prompts |
| **Adaptive Card forms with submit** | `Action.Submit` round-trips JSON to a topic | ⏳ Phase 7 Chunk B | Form asks for budget + region, topic recalculates |
| **Date pickers, sliders, choice sets** | Adaptive Card built-ins | ⏳ Phase 7 Chunk B | "Choose your scenario" wizard |
| **Inline approval flows** | Approve/Reject buttons → topic branches | ⏳ Phase 7 Chunk B | Approve a generated draft |
| **Carousels** | Multiple Adaptive Cards horizontal scroll | ⚠️ optional | Top 5 EU economies as cards |
| **Reaction emojis / feedback** | 👍/👎 buttons → custom outbound event | ❌ skip | Quality signal collection |
| **Voice input** | Browser `SpeechRecognition` API | ❌ skip | Click mic, speak, see transcribed query |
| **Speech output** | `SpeechSynthesis` API | ❌ skip | Auto-narrate bot replies |
| **Keyboard shortcuts** | DOM listeners (`/`, `↑`, `Esc`) | ⏳ Phase 7 Chunk B | Press `/` to focus input from anywhere |

### Long-running scenarios (the core value-prop)

| Feature | Mechanism | Status | Demo idea |
|---|---|---|---|
| **Multi-minute topic runs** | Topic emits progress `event` activities; UI shows "Step 2 of 5" | ⏳ Phase 7 Chunk B | Topic that calls 3 Power Automate flows |
| **Long gaps between user messages** | Idle user, conversation stays alive | ⏳ Phase 7 Chunk B | User leaves for 10 min, returns, types — bot still has context |
| **Token refresh** | MSAL silent every 50 min; CS conversation token before expiry | ⏳ Phase 7 Chunk B | Demo runs longer than initial token TTL |
| **Background job tracking** | Topic returns job ID; UI polls via inbound `event` | ⏳ stretch | "Generating report…" persists across page idle |
| **Resumable conversations** | `conversationId` in `localStorage`; reconnect on next open | ⚠️ optional | Close tab, reopen, see full history |
| **Cross-device handoff** | `conversationId` encoded in URL | ❌ skip | Mobile QR scan |
| **Generated artefacts (downloads)** | Bot returns SAS URL; rendered as download card | ⏳ Phase 7 Chunk B | Topic produces a CSV → user clicks download |

### Identity & personalization

| Feature | Mechanism | Status | Demo idea |
|---|---|---|---|
| **Silent SSO** | Teams JS → MSAL silent → fallback | ✅ scaffolded | First load greets user by name |
| **User identity in greeting** | MSAL claims (`name`, `preferred_username`) → outbound `userContext` event | ⏳ Phase 7 Chunk B | "Hi Karima — what would you like to analyze today?" |
| **Tenant/role-aware behaviour** | `tid`, `roles` claims passed to topic | ⏳ Phase 7 Chunk B | Manager-only topics gated by role |
| **Light/dark theme** | CSS variables + `prefers-color-scheme` | ⏳ Phase 7 Chunk B | Toggle OS theme; UI flips |
| **Locale** | `navigator.language` → topic uses for date/number formatting | ⏳ Phase 7 Chunk B | EU member with `de-DE` sees `1.234,56 €` |

### Handoff to live agent (escalation)

| Feature | Mechanism | Status | Demo idea |
|---|---|---|---|
| **CS-driven escalation trigger** | Topic emits `event` with `name === 'handoff'`; orchestrator picks it up | ✅ SDK scaffolded ([handoff/](../webchat-ui/src/handoff/)) | Topic decides escalation > $X amount |
| **Routing user input to live platform** | `HandoffOrchestrator.routeUserMessage()` | ✅ SDK scaffolded | Mode badge flips; messages route through broker |
| **Live-agent inbound via SSE** | `CustomWebhookProvider` consumes broker SSE stream | ✅ SDK scaffolded | Live agent typing indicator + messages render |
| **Resume CS topic on session end** | `cs.resumeFromLive(payload)` | ✅ SDK scaffolded | "Welcome back — here's a summary" topic branch |
| **Server-side broker** | Customer-supplied Azure Function (4 endpoints) | ⏳ customer build | See § "Live agent escalation" |
| **Platform-specific provider** | Implement `HandoffProvider` per platform | ⏳ customer build | Genesys / D365 CS / SF / ServiceNow / custom |

### Events (custom signals between UI and topic)

| Direction | Use | Status | Demo idea |
|---|---|---|---|
| **Outbound (UI → topic)** | `userContext` event sent on connect with name, email, locale, theme | ⏳ Phase 7 Chunk B | **The one event hook for this round.** Topic logs it, uses for greeting. |
| **Inbound (topic → UI)** | Topic emits `progress` events with step counters | ⏳ stretch | Long-running topic shows live progress bar |
| **Bidirectional** | Custom telemetry signals | ❌ skip | Out of scope for demo |
| **`conversationStart`** | Built-in in CS — fires automatically when conversation opens | ✅ free | Greeting topic |

### Rest-of-M365 integration (driven by the topic, surfaced in UI)

| Feature | Status | Demo idea |
|---|---|---|
| **Topic calls MCP tool** | available now via CS Tools | Topic uses an MCP tool to fetch live FX rates |
| **SharePoint preview** | optional renderer | Bot returns SP file URL → rich preview card |
| **Outlook calendar entries** | optional renderer | Topic returns iCal payload → "Add to calendar" button |
| **Teams meeting links** | basic renderer | Clickable join button |
| **Open in Office** | URL scheme | "Edit in Word" link |

### Accessibility & polish

| Feature | Status | Why it matters |
|---|---|---|
| `role="log"` on message list, `aria-live="polite"` on new messages | ⏳ Phase 7 Chunk B | Screen readers announce new bot replies |
| Focus trapped to input when chat opens | ⏳ Phase 7 Chunk B | Keyboard users land in the right place |
| High-contrast theme support | ⏳ Phase 7 Chunk B | Required for enterprise deployments |
| Reduced-motion respect | ⏳ Phase 7 Chunk B | Disables typing-dot animation when set |

### Security & compliance

| Feature | Status | Why it matters |
|---|---|---|
| Content Security Policy | ✅ done (in `staticwebapp.config.json`) | Blocks XSS, restricts iframe origins |
| Token never in browser bundle | ✅ design enforced | No secrets shipped to client |
| Federated credentials on app reg | ✅ done | No client secret to rotate |
| Bearer-token validation on connect | ✅ via SDK | Rejects unauthenticated calls |
| DOMPurify on all HTML render paths | ⏳ Phase 7 Chunk B | Sanitizes any markdown HTML blocks |

---

## What's NOT possible (or hard) with this pattern

Honest scope statement so demos don't oversell.

| Limitation | Why |
|---|---|
| **Proactive messages** (bot pings user unprompted from nowhere) | Browser must be connected; CS doesn't push to closed iframes |
| **File upload to topic** | CS Wave-2 endpoint shape for uploads is still firming up; not bake-in-able yet |
| **Conversations across multiple bots simultaneously** | One iframe = one CS agent today |
| **Real-time collaborative editing** | Out of scope; this is a chat surface, not a Loop component |
| **Sub-second voice latency end-to-end** | Browser STT + CS round-trip + TTS isn't sub-second; ~1.5–3s realistic |
| **Long-running offline jobs that survive browser close** | Topic continues server-side, but UI rejoin requires conversation persistence we haven't built |

---

## Live agent escalation (handoff to a real human)

This is one of the most impactful capabilities the SDK + custom UI approach unlocks. Plain Direct Line + Bot Framework Web Chat **cannot** do this cleanly because Web Chat is hardwired to one Direct Line conversation; you can't multiplex messages from another source. Our renderer **can**, because we own the message stream.

A ready-to-customise implementation lives in [`webchat-ui/src/handoff/`](../webchat-ui/src/handoff/) — customer integration is ~4 lines plus a small server-side broker.

### Architecture

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ WebChat UI (this repo)                                                      │
│                                                                             │
│   HandoffOrchestrator state machine: cs ▶ handoff ▶ live ▶ returning ▶ cs   │
│     - routeUserMessage(text)  : if live → broker; else → CS                 │
│     - merges inbound CS activities + inbound live-platform events           │
│     - emits onSystemMessage / onLiveInbound / onModeChange to your renderer │
└───┬──────────────────────────────────────────────────┬─────────────────────────────────────────────────┘
    │                                                  │
    ▼                                                  ▼
┌─────────────────────────────────────────┐   ┌────────────────────────────────────────────┐
│ Copilot Studio agent (CDX)            │   │ Token broker (your Azure Function) │
│                                       │   │                                    │
│ Topic "Escalate to live":             │   │ POST /api/handoff/start            │
│   sendEvent('handoff', {dest, ctx})  ──┼──▶│ POST /api/handoff/message          │
│                                       │   │ POST /api/handoff/end              │
│ Topic "Resume from live":             │   │ GET  /api/handoff/stream (SSE)     │
│   listens for resumeFromLive event   ──┼──◀│                                    │
└──────────────────────────────────────────┘   └───┬───────────────────────────────────────────┘
                                              │
                                              ▼
                                       ┌──────────────────────────────────────────┐
                                       │ Live-agent platform                  │
                                       │ (Genesys, D365 CS, Salesforce,       │
                                       │  ServiceNow, custom)                 │
                                       └───────────────────────────────────────────┘
```

### Sequence: full handoff round-trip

```text
User           UI/Orchestrator    CS agent       Broker        Live platform
  │                  │               │             │                │
  │ "refund $250"    │               │             │                │
  ├───────────────▶│───────────────▶│             │                │
  │                  │               │ sees policy threshold; emits     │
  │                  │◀─────────────│ event handoff(billing-tier-2)   │
  │                  │ beginHandoff()│             │                │
  │ "Connecting..."  │               │ notifyHandoffPending│           │
  │◀───────────────│───────────────▶│             │                │
  │                  │ startSession  │             │ createConversation              │
  │                  ├─────────────────────────────▶│───────────────▶│
  │                  │◀──────────────────────── sessionId ────│                │
  │                  │ SSE subscribe │             │                │
  │ (typing...)      │◄═══════════════════════════════│◄═══════════════│
  │ "Hi, I'm Sam."   │◄═ inbound message via SSE ════│◄═ webhook ═══════│
  │◀───────────────│               │             │                │
  │ ...long human chat...                                                  │
  │                  │               │             │ session.closed │
  │                  │◄═════════════ endedEvent ════│◄═══════════════│
  │ "Session ended." │ finishLive    │             │                │
  │◀───────────────│───────────────▶│             │                │
  │                  │ resumeFromLive│             │                │
  │ "Welcome back."  │◄───────────────│             │                │
  │◀───────────────│               │             │                │
```

### What you (the customer) build

| Layer | What | Effort |
|---|---|---|
| **CS topic "Escalate to live"** | Emit a `handoff` event with destination + context. | 5 min |
| **CS topic "Resume from live"** | Listen for `resumeFromLive` event; greet user back, optionally log to Dataverse. | 10 min |
| **Token broker** (Azure Function) | 4 endpoints: `start`, `message`, `end`, `stream` (SSE). Translates between live-platform schema and `HandoffInbound`. Holds platform credentials. | 1–2 days for first platform; less for subsequent |
| **Live-platform configuration** | Configure outbound webhooks to point at your broker; auth (API key, HMAC, mTLS). | Hours, varies by platform |
| **WebChat wiring** | Instantiate `HandoffOrchestrator` + `CustomWebhookProvider`, route user input through it, listen for the `handoff` event. | < 1 hour (boilerplate already in repo) |

### Per-platform notes

| Live platform | Inbound webhooks | Outbound REST | Notes |
|---|---|---|---|
| **D365 Customer Service** | Omnichannel webhooks; or Bot Framework Skill | Skill protocol or REST | Best fit for MS-aligned customers; native handoff exists |
| **Genesys Cloud** | Notification topics + Open Messaging webhooks | Open Messaging REST | Excellent docs; common pick |
| **Salesforce Service Cloud** | Live Agent / Messaging for Web pre-chat APIs + Apex triggers | Messaging REST / Live Agent SOAP | Heaviest lift |
| **ServiceNow** | Outbound REST messages + Virtual Agent Bridge | Inbound REST / VA Bridge | Custom auth dance |
| **Custom platform** | Whatever you build | Whatever you build | Easiest to prototype |

### Trade-offs to surface to stakeholders

| Trade-off | Reality |
|---|---|
| **Server component required** | Can't be done purely in the browser; broker holds platform credentials and session mapping |
| **Per-platform translation effort** | Each live platform has a unique auth model and message schema |
| **Latency** | Webhook → broker → SSE → UI typically 200–600 ms; visibly fine but not as snappy as a native live-chat widget |
| **Compliance** | Transcripts now span CS + live platform; retention/PII policies must cover both |
| **Reconnect across sessions** | If user closes the tab during handoff, server-side session-resume logic is needed to rejoin |

### Code reference

- Public surface: [`src/handoff/index.ts`](../webchat-ui/src/handoff/index.ts)
- Orchestrator: [`src/handoff/HandoffOrchestrator.ts`](../webchat-ui/src/handoff/HandoffOrchestrator.ts)
- Generic webhook provider: [`src/handoff/providers/custom.ts`](../webchat-ui/src/handoff/providers/custom.ts)
- Types contract: [`src/handoff/types.ts`](../webchat-ui/src/handoff/types.ts)

The orchestrator is fully unit-testable and platform-agnostic. To add a new live platform, implement `HandoffProvider` (4 methods) and pass it in. No orchestrator code changes.

---

## Recommended end-to-end demo script (~10 min)

Use the agent's existing topics as much as possible; add stubs only where called out.

### Setup (do once before demo)

- ✅ Sign in to CDX tenant in M365 Copilot
- ✅ Have a CDX test user pre-signed in to the SWA URL in another tab to show isolation

### Act 1 — the launcher (Phase 5 demo)

1. **In M365 Copilot**: type *"Open my agent"*
2. The Declarative Agent fires, the MCP App tool returns the iframe payload, the WebChat loads silently.
3. **Talking point**: no second sign-in — silent SSO flowed from M365 Copilot.

### Act 2 — basic chat & branding

4. The chat shows a personalized greeting: *"Hi Karima, I'm the Eurozone Analyst. Here's what I can do today:"* with three suggested actions.
5. **Talking point**: the greeting was generated client-side using the `userContext` event we sent on connect. Topic stayed agnostic to the embedding surface.

### Act 3 — markdown report

6. Click suggested action **"Brief me on the Eurozone economy"**.
7. Topic returns a 4-section markdown briefing with `## headers`, a comparison table, an inline image, and a "Read more" link.
8. **Talking point**: same topic output renders as a clean professional brief here, would render as plain text in a basic Direct Line chat.

### Act 4 — Adaptive Card form

9. Click **"Run a scenario"** suggested action.
10. Topic returns an Adaptive Card with country, sector, and target year inputs + Submit button.
11. Submit a scenario → topic responds with a fact-set Adaptive Card showing the projection.
12. **Talking point**: full form round-trip; no page reload; identical experience whether shown in Copilot, Teams, or a standalone browser.

### Act 5 — long-running

13. Click **"Generate the full report"**.
14. Topic shows progress: *"Step 1 of 5: Gathering data…"* updates every few seconds via inbound `event` activities.
15. While it runs, switch tabs for ~3 minutes, come back. Connection still alive. Final output arrives as a downloadable artefact card.
16. **Talking point**: this is the whole reason for the pattern — the host LLM would have killed the turn at 30s.

### Act 6 — coexistence

17. Without closing the chat, switch to the M365 Copilot main pane and ask an unrelated question (e.g., "What meetings do I have tomorrow?").
18. The default Copilot answers normally; your custom embedded chat stays alive in its panel.
19. **Talking point**: the DA is single-purpose; everything else routes normally. No interference.

### Act 7 — security wrap-up

20. Show DevTools → Network: no client secret, no Direct Line secret, only short-lived bearer tokens.
21. Show DevTools → Application → IndexedDB / cookies: only MSAL silent cache.
22. Show the Entra app reg in portal — federated credential, no secret to rotate.

---

## Roadmap inside this repo

Aligned with the capability matrix above:

- **Now (Phase 7 Chunk A — next commit):** SDK transport + MSAL token + minimal message round-trip. Verify connection.
- **Next (Phase 7 Chunk B):** Rich UI — markdown, Adaptive Cards, suggested actions, typing, event hook, branding, theme.
- **Then (Phase 5):** MCP App + DA manifest + sideload to CDX M365 Copilot.
- **Stretch (Phase 8 — post-demo):** progress events for long-running, code highlighting, conversation persistence.

Update this document each phase as features land or get deferred.
