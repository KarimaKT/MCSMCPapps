# UI possibilities — what the maker can build

> Audience: a maker who already has the WebChat working and wants to know **what's possible**, **what Copilot Studio can send and consume**, and **what UI features are worth adding**.
>
> This doc is the menu. Pick from it; you don't have to build everything.

The WebChat in this repo is a thin **renderer** for what your Copilot Studio agent emits, plus a **bridge** that sends user actions back. Every UI feature below boils down to one of:

1. **CS sends something** (an `Activity`) that the WebChat renders.
2. **The user does something** that the WebChat sends back as an `Activity`.
3. **The WebChat does something locally** (browser-only) without CS involvement.

Knowing which side owns what saves a lot of design back-and-forth.

---

## What Copilot Studio Wave-2 can send (today)

These are the activity shapes the **Microsoft 365 Agents SDK Copilot Studio Client** streams to us. We render whichever ones we choose to support.

| Activity | Fields you'll use | Renderer status in this repo |
|---|---|---|
| `message` (text) | `text` (markdown) | ✅ Markdown via `marked` + DOMPurify |
| `message` (with attachments) | `attachments[]` | ✅ Image / Adaptive Card / Hero Card / file chip |
| `message` with `suggestedActions` | `suggestedActions.actions[]` | ✅ Button row |
| `typing` | — | ✅ Bouncing dots |
| `event` | `name`, `value` | ⚠️ Logged to console; route to your handler |
| `conversationUpdate` | `membersAdded` | ✅ Ignored (no-op) |
| `endOfConversation` | `code` | ⚠️ Not yet rendered; trivial to add |
| `handoff` | `value` (handoff payload) | ✅ Routed to `HandoffOrchestrator` (see live-agent escalation) |
| `trace` | `name`, `value` | ⚠️ Logged; not rendered |

### Attachments CS can produce

| ContentType | What it is | Renderer status |
|---|---|---|
| `application/vnd.microsoft.card.adaptive` | Adaptive Card v1.5 JSON | ✅ Renders + form submission round-trip |
| `application/vnd.microsoft.card.hero` | Title + image + buttons | ✅ Renders |
| `application/vnd.microsoft.card.thumbnail` | Compact card variant | ⚠️ Falls through to file chip; trivial to add |
| `image/png`, `image/jpeg`, etc. | Image (URL or `data:` URL) | ✅ Inline `<img>` |
| `application/octet-stream` + `contentUrl` | Generic file | ✅ Download chip with filename |

> **Today's reality:** the `Eurozone Analyst` agent inlines its generated charts as `data:image/png;base64,...` in `attachment.contentUrl`. That works fine but caps at ~1 MB before getting awkward. For larger artifacts, the topic should upload to Blob Storage and return a SAS URL.

---

## What the WebChat can send back to CS

Every user action becomes an outbound `Activity`.

| User action | Outbound activity | What CS sees |
|---|---|---|
| Types text and presses Enter | `message` with `text` | A regular user turn |
| Clicks a suggested-action button | `message` with `text` = the button's `value` | Same as if they typed it |
| Submits an Adaptive Card form | `message` with `value` = the form's submit data | Topic reads `Activity.Value` |
| Opens the chat (one-shot on connect) | `event` with `name: "userContext"`, `value: { name, upn, oid, locale, theme, host }` | Topic listens for it and uses for personalization |
| Selects a language (future) | `event` with `name: "languagePreferenceSet"` | Topic stores `Global.PreferredLang` |
| Triggers a custom action (you decide) | Any `event` shape you define | Topic listens by `name` |

**Key principle:** CS understands **events** as a first-class signal. Anything the maker builds into the UI that should affect agent behavior should fire an `event` activity, not a plain text message. That keeps the conversation transcript clean.

---

## Display modes — chat vs full app

The widget host (Microsoft 365 Copilot) supports three display modes per the **MCP Apps spec**. The widget HTML chooses which it wants and Copilot decides whether to honor it.

| Mode | Looks like | When to use |
|---|---|---|
| `inline` (default) | Chat panel in the Copilot pane | Standard chat experiences |
| `fullscreen` | Widget takes over the full Copilot pane | Document editors, dashboards, multi-column layouts, side-by-side review |
| `pip` | Picture-in-picture floating widget | Persistent assistants, music player, notification stream |

### Side-by-side document + chat (concrete patterns)

A maker can build any of these inside the widget iframe:

| Pattern | Implementation sketch |
|---|---|
| **Code review** | `fullscreen` mode. Left: Monaco editor showing PR diff. Right: chat. CS topic emits `event: codeAnnotation` carrying line numbers + comments; widget renders them as inline gutter markers. User clicks "Apply suggestion" button; widget sends `event: applySuggestion` back to CS. |
| **Document drafting** | `fullscreen` mode. Left: Quill editor on a document the topic populates. Right: chat. Bot says "I've drafted §3"; emits `event: docPatch` with a JSON Patch. Widget applies the patch. User edits manually; sends `event: docState` back occasionally. |
| **Data exploration** | `fullscreen` mode. Left: data table + chart. Right: chat. User selects rows; widget sends `event: rowsSelected`. Bot offers to summarize them. |
| **Approval flow** | `inline` mode initially; widget requests `fullscreen` when a complex approval card arrives. Adaptive Card form for approval; submission round-trips. |
| **Live shopping** | `pip` mode. Widget always-visible while user browses. Chat suggests products; user clicks; widget loads product page in an inner iframe. |

**Limit:** the side-by-side doc lives **inside** the widget. The widget cannot reach into Copilot's host page, Word Online, Excel Online, or another tab. If the maker wants to edit a Word document specifically, they embed the Word Online iframe and bridge messages via `postMessage`.

---

## Popular chat features and their cost

Common-sense things users expect, ranked by build effort vs value.

### Tier 1 — must-have polish (cheap, high value)

| Feature | Effort | What it takes |
|---|---|---|
| **Markdown bot replies** | ✅ DONE | `marked` + sanitize |
| **Typing indicator** | ✅ DONE | listen for `typing` activities |
| **Auto-scroll to newest** | ✅ DONE | `scrollIntoView` on append |
| **Enter to send** | ✅ DONE | form submit handler |
| **Light/dark theme** | ✅ DONE | CSS vars + `prefers-color-scheme` |
| **Status banner on errors** | ✅ DONE | `setStatus(text, 'error')` |
| **Branded header** | ✅ DONE | `VITE_BRAND_*` env vars |
| **Copy message text** | ⏳ small | Hover button on each bot bubble; `navigator.clipboard` |
| **Timestamps on hover** | ⏳ small | `<time>` element with formatted ISO |
| **Avatar / sender label** | ⏳ small | Render bot name from `from.name` |
| **"Bot is thinking" longer than 5s** | ⏳ small | Timer that escalates the typing message |

### Tier 2 — table-stakes for production (medium)

| Feature | Effort | What CS provides | What the maker builds |
|---|---|---|---|
| **Suggested-action buttons** | ✅ DONE | `suggestedActions.actions[]` | Already rendered as button row |
| **Adaptive Cards forms** | ✅ DONE | `attachments[].contentType: card.adaptive` | Already renders + submit round-trip |
| **Image inlining** | ✅ DONE | `attachments[].contentType: image/*` | Already renders |
| **File downloads** | ✅ DONE | `attachments[].contentUrl` | Already renders as chip |
| **Conversation history (within session)** | ✅ DONE | the SDK streams it | Append to log |
| **Stop generation button** | ⏳ medium | (none — would close the conversation) | Local cancel; tell user we cancelled |
| **Retry last message** | ⏳ small | n/a — local state | Re-send the most recent user message |
| **Input character counter** | ⏳ trivial | n/a | `input.value.length` |
| **Multiline input + Shift-Enter** | ⏳ small | n/a | Replace `<input>` with `<textarea>`; enter submits, shift-enter newlines |
| **Markdown rendering of code blocks** | ✅ DONE | bot text contains fenced code | already styled |
| **Syntax highlighting in code blocks** | ⏳ medium | nothing extra | add `highlight.js` lazy-loaded; ~50 KB |
| **Accessible focus management** | ⏳ small | n/a | Focus input on open; trap focus in modal cards |

### Tier 3 — power features (medium-high)

| Feature | Effort | What CS provides | What the maker builds |
|---|---|---|---|
| **Conversation persistence across sessions** | ⏳ medium | conversation IDs from the SDK | `localStorage` to remember `conversationId`; reconnect on next visit |
| **Voice input (browser STT)** | ⏳ medium | n/a | `SpeechRecognition` API; map to text input |
| **Voice output (browser TTS)** | ⏳ small | n/a | `SpeechSynthesis` API; speak bot replies on toggle |
| **Suggestions from chat history** | ⏳ medium | n/a — local NLP | Remember last N user prompts; offer recall |
| **Search within conversation** | ⏳ small | n/a | Inline find with `/` shortcut |
| **Copy/share the entire conversation** | ⏳ small | n/a | Serialize to markdown / JSON; download |
| **Pin / favourite messages** | ⏳ small | n/a | Local star + scroll to |
| **Reactions on bot messages (👍/👎)** | ⏳ medium | none | Render reaction buttons; outbound `event: feedback` to CS for analytics |
| **Multi-step progress bar** | ⏳ medium | CS topic emits `event: progress` with step counters | Render progress UI; advance on each event |
| **Reconnect after network blip** | ⏳ medium | the SDK errors; we re-init | Detect transport error; reopen conversation, replay user message |
| **Token-refresh during long sessions** | ⏳ small | n/a | Re-acquire MSAL token before expiry |
| **Locale-aware formatting** | ⏳ small | n/a | Use `navigator.language` for date/number rendering |

### Tier 4 — rich content (medium-high; depends on what the topic emits)

| Feature | Effort | What CS provides | What the maker builds |
|---|---|---|---|
| **Tables with sorting** | ⏳ medium | markdown tables in `text` | Detect tables in markdown AST; replace with sortable `<table>` |
| **Charts (Chart.js / Vega-Lite)** | ⏳ medium | attachment with custom contentType `application/vnd.vegalite+json` | Renderer recognizes the type and instantiates the chart lib |
| **Interactive maps** | ⏳ medium | attachment with `application/vnd.geojson` | Mapbox or Leaflet; CSP must allow tile servers |
| **Inline videos** | ⏳ small | markdown image with video URL or attachment with `video/*` | `<video>` tag with controls |
| **PDFs preview** | ⏳ small | attachment with `application/pdf` | `<embed>` tag or PDF.js |
| **Math equations (KaTeX)** | ⏳ small | bot uses `$\LaTeX$` syntax in markdown | Lazy-load KaTeX; replace `$...$` |
| **Mermaid diagrams** | ⏳ small | bot returns ` ```mermaid ` fenced code | Lazy-load Mermaid; replace fenced blocks |
| **Citation footnotes with hover preview** | ⏳ medium | bot returns markdown footnotes `[^1]` + a citations attachment | Render footnotes inline; popover on hover with the source |
| **Embedded SharePoint preview** | ⏳ medium | attachment with `text/uri-list` to a SP URL | Fetch SP metadata via Graph; render preview card |

### Tier 5 — collaboration (large)

| Feature | Effort | What CS provides | What the maker builds |
|---|---|---|---|
| **Live agent escalation** | ✅ scaffolded | event `handoff` from a topic | `HandoffOrchestrator` (already in repo) routes user input between CS and live platform via a broker |
| **Multi-user shared conversation** | ❌ not supported | n/a | Out of scope; CS conversations are per-user |
| **Real-time collaborative document** | ❌ not supported | n/a | Use a Loop component or Fluid Framework — different surface |
| **File upload to topic** | ⏳ large | CS Wave-2 file ingest is firming up | Wait for stable spec |

### Tier 6 — analytics + ops (medium)

| Feature | Effort | What CS provides | What the maker builds |
|---|---|---|---|
| **Application Insights telemetry** | ⏳ small | n/a | Wire `applicationinsights-web` to log message counts, time-to-first-byte, errors |
| **Feedback collection (👍/👎)** | ⏳ medium | n/a | Reaction buttons → `event: feedback` outbound; CS topic logs to Dataverse |
| **Conversation export (.md / .json)** | ⏳ small | n/a | Serialize log array to file |
| **Diagnostic mode toggle** | ⏳ small | n/a | URL flag `?debug=1` reveals raw activities, transport timing |

---

## Things CS **cannot** do (or doesn't yet)

Worth knowing so you don't promise them.

| Limitation | Workaround |
|---|---|
| **Proactive messages** (bot pings unprompted from nowhere) | None for embedded WebChat. Use Teams / email channel for proactive needs. |
| **Speech directly from CS** | CS doesn't synthesize speech. Use browser TTS on the WebChat side. |
| **File uploads from user** | Wave-2 ingest spec is firming up. For now, have the topic accept file URLs the user pastes. |
| **Push notifications** | Not in CS. Use Teams Activity Feed for that pattern. |
| **Multi-bot in one conversation** | One CS agent per conversation. Use `worker_agents` in the DA manifest if you need multiple agents to coordinate; they appear as one to the user but are distinct sessions. |
| **Streaming partial messages within a turn** | The SDK streams complete activities. Token-level streaming requires using a different platform. |
| **Real-time typing forwarding** | Bot sees full messages, not keystrokes. |

---

## Two things the maker should always design before building UI

### 1. What does CS need to *know* about user actions?

Most UI mistakes happen when the WebChat does something locally that CS later needs but doesn't have. Examples:

- ❌ "I added a stop-generation button locally" → CS keeps generating; user is confused when their next message is appended after a stale reply.
- ✅ Stop-generation closes the conversation; new message starts a fresh one.
- ❌ "I let users edit their last message inline" → CS keeps the original transcript.
- ✅ Inline edit re-sends as a new turn; conversation context still works.

For each new UI feature, ask: **does CS need to know this happened?** If yes, fire an `event` activity.

### 2. What's CS's responsibility vs the WebChat's?

| Responsibility | Owner |
|---|---|
| Topic logic, knowledge sources, AI reasoning | CS |
| Long-running orchestrations, tool calls, Power Automate flows | CS |
| Output translation (see IDEAS) | CS (via OnOutgoingMessage trigger) |
| Persisting conversation state | CS |
| Chat surface rendering (markdown, cards, suggested actions) | WebChat |
| User identity acquisition (SSO) | WebChat |
| Branding (colors, logo, font) | WebChat (build-time env vars) |
| Theme switching at runtime | WebChat (CSS vars + `prefers-color-scheme`) |
| Voice input/output | WebChat (browser APIs) |
| Diagnostics, telemetry | WebChat (Application Insights) |
| Side-by-side document panel | WebChat (built into the widget HTML) |

**Rule of thumb:** if it's about *what to say*, that's CS. If it's about *how to display it or how to capture user input*, that's the WebChat.

---

## Recommended next features (Tier 1 in chunks)

Best-bang-for-buck order to add features after Phase 5 ships:

1. **Multiline input + Shift-Enter newlines** — users complain about this within 30 seconds.
2. **Copy-message-text on hover** — users want to grab a chart caption or a snippet.
3. **Conversation export to markdown** — users want to share what the agent told them.
4. **Reactions / feedback** — gives the maker a data signal of quality.
5. **Token-refresh logic** — without this, sessions silently die after ~60 min.
6. **Application Insights** — instrument before users start complaining about latency.
7. **Reconnect-on-disconnect** — graceful network blip recovery.
8. **Voice input** — single biggest "wow" feature for non-technical users; `SpeechRecognition` API is free.

After those eight, branch by use case (charts, mermaid, side-by-side editor, etc.) per the menu above.

---

## Where the renderer code lives

| File | What it controls |
|---|---|
| [`webchat-ui/src/messageRenderer.ts`](../webchat-ui/src/messageRenderer.ts) | All message rendering — markdown, attachments, cards, suggested actions |
| [`webchat-ui/src/chatUi.ts`](../webchat-ui/src/chatUi.ts) | Chat shell — header, log, input, status banner |
| [`webchat-ui/src/csTransport.ts`](../webchat-ui/src/csTransport.ts) | Outbound + inbound activities, conversation lifecycle |
| [`webchat-ui/src/main.ts`](../webchat-ui/src/main.ts) | Boot, wire SSO + transport + UI, route activities to handlers |
| [`webchat-ui/index.html`](../webchat-ui/index.html) | CSS for everything; CSS vars for theme + branding |
| [`webchat-ui/src/branding.ts`](../webchat-ui/src/branding.ts) | Build-time brand vars |
| [`webchat-ui/src/handoff/`](../webchat-ui/src/handoff/) | Live-agent escalation orchestrator |

When you add a feature, the touch points are usually `messageRenderer.ts` (for new attachment types) or `main.ts` (for new event handlers). The chat shell rarely needs changes.
