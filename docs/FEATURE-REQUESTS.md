# Feature requests for the M365 Copilot extensibility teams

This document captures concrete asks from a maker / customer perspective, gathered while building
this reference implementation. Each request includes:

- **Pain** — what is happening today
- **Repro** — how to see it
- **Ask** — what we want changed
- **Why it matters** — customer / business impact
- **Workaround** — what we do today, if anything

Tag a feature request `URGENT` if it is blocking customer adoption today, `IMPORTANT` if it is a
sharp friction point that we routinely hit, and `NICE` for ergonomic upgrades.

---

## URGENT — DA / app-package update flow

### 1.1 Maker-published updates to a Declarative Agent are not visible in any obvious tenant surface

**Pain.** After running `teamsapp publish --env dev` (or the Agents Toolkit "Publish" button)
on an updated app package (manifest version bumped, e.g. `1.0.4 → 1.0.5`), the new version is
**not discoverable** through any of the usual filters in the tenant catalog UIs:

- Microsoft 365 admin center → Integrated apps → can't find a "pending updates" filter or the new version
- Teams Admin Center → Manage apps → searching by name returns the live record only; no "update available" indicator on the row
- M365 Copilot Agent Store inside m365.cloud.microsoft → still shows the previously approved version with no badge

The maker has no reliable way to confirm "my update is queued and waiting for admin action,"
nor to see what version is currently live vs pending.

**Update 2026-05-03 — partial finding.** The pending-update surface DOES exist, but it is
in **Microsoft 365 admin center → All agents → Requests tab** (URL pattern
`https://admin.cloud.microsoft/?#/agents/all/requested`). This is a brand-new "All agents"
experience that replaces some of the old Integrated Apps pending-update flow. It is **not**
in the Teams Admin Center, **not** in Integrated apps "Requests", and **not** linked from
the Agent Registry side panel for the agent. Discovery cost from a fresh admin: 15+ minutes
of clicking around three different admin centers.

**Repro.**

1. Publish v1.0.X via Agents Toolkit. Approve it. Confirm it is live in M365 Copilot.
2. Bump to v1.0.X+1, edit any field (e.g. instructions), publish again.
3. Open Teams Admin Center → Manage apps. Search the app name.
4. Observe: only one row appears, showing the *old* version. No "Update pending" badge or filter.
5. Open M365 Copilot Agent Store. Observe the Update button is *sometimes* present, *sometimes*
   not, depending on cache state and time since publish. There is no admin-side equivalent.
6. The actual pending-update entry is at `https://admin.cloud.microsoft/?#/agents/all/requested`
   (Microsoft 365 admin center → All agents → Requests). Side panel doesn't link there from
   the agent's Registry entry.

**Ask.**

- Add an explicit **"Pending updates"** filter / view in Teams Admin Center → Manage apps.
- Add a column or badge **"Live version → Pending version"** on each app row.
- Surface a webhook or Microsoft Graph notification (`appCatalog.appUpdatePending`) that
  ISVs and platform teams can subscribe to.
- Make the M365 Copilot Agent Store consistently surface the **Update** button immediately,
  not after a soft cache flip.
- **Cross-link the surfaces.** From the All agents → Registry side panel of an agent that
  has a pending update, show a banner "Pending update v1.X.Y → review in Requests" that
  deep-links to the Requests row. From Teams Admin Center → Manage apps → the agent's row,
  same banner. From the maker's `teamsapp publish` CLI output, print the deep link to the
  Requests tab so the admin and maker have one clickable URL to share.

**Why it matters.** Customer admins cannot give makers timely feedback. Makers can't run a
deployment pipeline that says "publish → wait for admin approval → notify maker → run smoke tests"
because there is no observable signal at any step. This is the single biggest friction in our
reference implementation's customer story.

**Workaround.** Today we have to message the admin manually, ask them to look in two different
admin surfaces, and have them click around. There is no programmatic way to verify "my update
landed" until a user opens the agent in M365 Copilot and we observe the new behavior.

---

### 1.2 Production tenants require manual admin click on every update

**Pain.** In CDX dev tenants, publish auto-approves (good for dev velocity). In customer
production tenants, **every** publish — even a one-character instructions tweak — requires
a tenant admin to manually click "Allow" in Teams Admin Center → Manage apps → app row →
Update available. This blocks any kind of CI/CD pipeline, blocks A/B testing, and blocks
fast iteration on prompt engineering.

**Repro.** Try to push a small fix to instructions to a production tenant. Observe that the
change does not reach end users until an admin clicks Approve, regardless of whether the
change is semantically risky.

**Ask.** At least one of:

1. **Trusted publisher tier** — once a publisher (per-app or per-org) is admin-approved, allow
   subsequent updates of the same app (within the same `developer.websiteUrl` and
   `developer.privacyUrl`) to flow through without re-approval, **unless** the update touches
   sensitive surfaces (new permissions, new validDomains, new actions).
2. **Auto-approve for non-substantive changes** — diff the manifest. If the only changes are
   under `description`, `instructions`, `conversation_starters`, or `version`, auto-approve.
3. **Admin-set policy "auto-approve patch versions for app X"** — let admins opt into
   semver-style auto-approval per app.

**Why it matters.** Without this, **no real CD pipeline is possible** for a CS+DA agent. Every
prompt fix is gated on a human in the admin team, who has more important things to do than
click Approve buttons. This kills experimentation velocity and erodes the value proposition
of declarative agents over hard-coded ones.

**Workaround.** None at the platform level. Customers gate prompt updates on a weekly admin
cadence and accept the 5-day average latency between maker fix and live rollout.

---

### 1.3 No clear "what just happened" signal when an update fails to land

**Pain.** When publish *appears* to succeed (CLI returns 0, validation passes, no error
toast in the toolkit), but the new version doesn't actually appear in the tenant catalog,
there is no diagnostic. The maker sees a green tick and assumes success. The version stays
pinned at the previous one with no error anywhere visible to the maker.

**Ask.**

- Return a structured **publish receipt** from the toolkit / CLI: live version, queued
  version, target tenant id, expected approval surface URL.
- Surface failed admin-approval reasons (e.g. "your validDomains entry was rejected
  because…") to the maker, not just to the admin.

**Why it matters.** Today, debugging a "didn't land" is purely guesswork.

**Workaround.** Pester the admin via Teams.

---

## IMPORTANT — Custom UI / MCP Apps surface

### 2.1 The skybridge widget contract is undocumented in M365 Copilot Learn

**Pain.** To make a custom UI render inside M365 Copilot today (RemoteMCPServer + MCP Apps),
the maker must:

- Read the **OpenAI Apps SDK** docs (which target ChatGPT, not M365 Copilot)
- Find Microsoft's **mcp-interactiveUI-samples** repo (not linked from any Learn page we found)
- Reverse-engineer that the MIME type is `text/html+skybridge`, not the spec'd
  `text/html;profile=mcp-app`
- Discover that `_meta["openai/widgetAccessible"]` is required, not just `_meta.ui.resourceUri`
- Realize that *iframing an external origin from inside the widget is functionally blocked*,
  even with `_meta.ui.csp.frameDomains`

None of the above appears in any Microsoft Learn document for declarative agents or M365
Copilot extensibility.

**Ask.**

- Publish a definitive **"M365 Copilot widget contract"** doc on Learn that calls out the
  exact MIME, exact `_meta` keys, accepted bridge messages, what is and is not allowed in CSP.
- Cross-link from the DA + RemoteMCPServer docs to the [mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples) repo as the **canonical reference**, and version that
  reference so makers know which sample matches the M365 Copilot host they're targeting.
- Document the MCP Apps spec / MCP Apps in M365 Copilot timeline so makers know when to
  switch from `text/html+skybridge` to `text/html;profile=mcp-app`.

**Why it matters.** We spent a day chasing the wrong MIME and the wrong `_meta` shape. Every
maker rebuilding this pattern will hit the same wall.

**Workaround.** This document set, the [MCP-APPS-CONTRACT](MCP-APPS-CONTRACT.md) recipe.

---

### 2.2 Iframe-of-external-origin from within a widget is officially "discouraged" but not "rejected" — clarify

**Pain.** OpenAI's docs say `frameDomains` is "discouraged" and apps using it "face stricter
review." Microsoft's M365 Copilot docs say nothing. In practice we observed an iframe-based
widget produce an empty card with no diagnostic, while a single-file bundled widget renders.
A maker today cannot tell "is this not supported, is it broken, or is my CSP wrong?"

**Ask.**

- Publish a **definitive matrix** for M365 Copilot: which widget shapes are supported,
  which are quirky, which are blocked.
- If iframes-of-external-origin are blocked, return a rendering error that the maker can see
  in browser DevTools, not silent failure.

**Why it matters.** We picked the iframe approach because we wanted to reuse our existing
hosted SPA (the WebChat at the SWA URL). It cost us a day and a release cycle to discover
that approach doesn't work.

**Workaround.** Bundle the React app as a single-file HTML resource via
`vite-plugin-singlefile` and inline it into the widget HTML.

---

### 2.3 Provide a maker-friendly skybridge widget scaffold

**Pain.** Today, building a widget from scratch requires:

- Vite + React + TypeScript setup
- `vite-plugin-singlefile` for the inlined output
- Hooks to read tool input/output from `window.openai` AND from JSON-RPC postMessage
- Hooks to call back into tools via `tools/call`
- Theme / layout matching M365 Copilot's chrome
- Branding contract that survives the build

There is no `npm create m365-widget` or equivalent.

**Ask.** Ship a maker scaffold under `aka.ms/copilot-widget-quickstart` that produces a working
"hello world" widget in under 5 minutes, with all the boilerplate (build, MIME, _meta,
postMessage glue, branding hooks, dark/light theme) preconfigured.

**Why it matters.** Lowers barrier to entry from "expert maker spends a day" to "any maker
spends 10 minutes." Productizes the pattern this repo demonstrates.

---

### 2.4 Allow the widget to call the parent CS agent's tools / topics directly

**Pain.** Once the widget is rendered, it can `tools/call` other tools on the same MCP server,
but it cannot easily *trigger a CS topic* or *send a CS user message that bypasses the LLM*
("user clicked this Adaptive Card button → please run the OnPurchaseConfirmed topic").

**Ask.** Standardize an `app/topic/trigger` JSON-RPC method that the widget can post to
its host, which the host translates into a CS topic invocation with conversation context
preserved.

**Why it matters.** Makers want widgets that act as control surfaces for the CS agent
behind them, not just passive renderers.

---

### 2.5 Document the **silent** sandbox failure modes for widget bundles

**Pain.** A correctly-shaped widget bundle (right MIME, right `_meta`, right CSP) can
**silently fail to execute** in the skybridge sandbox for two undocumented reasons. Each
takes a day or more to diagnose because there is no error surfaced anywhere — just a blank
card with a 5 MB body downloaded.

**Failure mode A — `crossorigin` attribute on inline `<script>` tags.** Vite (and most
modern bundlers) emit `<script type="module" crossorigin>...</script>` by default. The
sandboxed iframe has a null origin; the browser performs a CORS check on the inline script,
sees null, refuses to execute it. No console error. No diagnostic. The script body is in
the document but never runs.

**Failure mode B — dev-mode bundling artifacts.** If the bundler is not explicitly in
production mode, it leaks HMR / dev-only code that uses `eval()` or `new Function()`. The
sandbox CSP blocks both. With CSP violations browsers DO log to console, but the message
("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source
of script") is so generic that makers chase it as "my framework needs unsafe-eval" instead
of "I forgot to set production mode."

**Repro.**

1. Create a Vite + React project.
2. Run `vite build` (default config).
3. Inline the output as a skybridge widget body.
4. See: blank card. No error. No clue.

**Ask.**

- **Document both failure modes** prominently on the M365 Copilot widget Learn page with
  the exact symptoms ("blank card despite a non-zero body size in `resources/read`").
- Provide a small **`stripCrossorigin`** Vite plugin in the official samples (Microsoft's
  `mcp-interactiveUI-samples` already has it; surface it on Learn).
- Better yet: **make the sandbox tolerant** of `crossorigin` on inline scripts with a null
  origin. This is a one-line change in the sandbox loader; it would unblock 100% of
  default Vite/Next/Astro/Remix builds without any maker action.
- Surface a **diagnostic event** when the sandbox refuses to execute the bundled script —
  e.g. a `postMessage` from the host to the inert iframe with a meaningful error code.

**Why it matters.** Every maker reaching for this pattern with default tooling will hit
this. We did. The blast radius for "blank card with no diagnostic" is hundreds of
maker-hours across the ecosystem.

**Workaround.** Copy Microsoft's `stripCrossorigin` Vite plugin from
[oai-apps-sdk/trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts).
Set `mode: 'production'` and `define: { 'process.env.NODE_ENV': '"production"' }` in your
Vite config. Documented in [docs/MCP-APPS-CONTRACT.md §6](MCP-APPS-CONTRACT.md).

---

### 2.6 Make M365 Copilot model routing more reliable for tool-only declarative agents

**Pain.** When a DA's only purpose is to render a custom UI widget (the pattern this repo
demonstrates), the host model in M365 Copilot **frequently answers from its own knowledge
instead of calling the tool** — even when the DA instructions say "the only way to answer
is to call this tool."

We observed this on the same agent within seconds:

- Prompt 1: *"what's the GDP of France?"* — model answers in markdown, no tool call.
- Prompt 2: *"Show GDP growth trends for France"* — model invokes the tool with a confirm
  card.

Both prompts target identical CS agent capability. Routing is sensitive to prompt phrasing
in non-obvious ways.

**Ask.**

- Add a tool-level metadata flag (e.g. `_meta["openai/forceInvoke"]: true` or
  `_meta["m365copilot/exclusive"]: true`) that makes the host model **always** call the
  tool when the DA is the active agent, regardless of the model's confidence in answering
  directly.
- Alternatively: at the DA level, a `behavior: "exclusive-tool"` field that says "this
  agent has no native answers; always route to the tool."
- Document the prompt-engineering levers that DO move routing today (tool description
  specificity, DA instruction wording) so makers can deliberately tune routing without
  trial and error.

**Why it matters.** Custom-UI DAs are inherently "the agent IS the UI" — the model
answering from its own knowledge defeats the entire pattern. It's also confusing to users:
the same agent with the same prompt sometimes opens a custom UI and sometimes answers in
plain markdown, with no way to predict which.

**Workaround.** Make tool descriptions long, specific, and exhaustive (full list of
capabilities). Make DA instructions naturally state "This agent's only knowledge is what
the [tool name] tool returns." Even with both, routing is ~70-80% reliable, not 100%.

---

### 2.7 No "silent dispatcher" toggle: host model always narrates after a tool call

**Pain.** Copilot Studio gives the maker a per-tool/per-topic toggle: "Should the agent
respond after this tool runs?" That control is **missing** for declarative agents. After a
tool call returns, M365 Copilot's host model **always** generates a follow-up text
response, even when the tool's `structuredContent` is the entire intended answer (e.g. a
data-widget that already shows the chart, the table, the citations).

The host's follow-up commentary frequently:

- **Repeats** content the widget already shows ("Italy's CPI is 1.2%, here is the table…")
- **Hedges** unnecessarily ("I can't reliably chart this from the numbers shown…")
- **Hallucinates** caveats not in the tool output ("This data may be outdated, but…")
- **Truncates or misquotes** the widget's authoritative payload

The MS UX guidelines for widgets explicitly say "don't duplicate content between widget and
model text." But the platform forces makers to fight the host model into silence via
prompt-engineered DA instructions, which is unreliable.

The closest existing knob is the plugin-manifest 2.4 `states.responding.instructions` field
on a function. That tunes the model's response style but does NOT let the maker disable
the response. Plugin manifest 2.4 also has `states.responding.instructions: ""` (empty
string), but the model still narrates — empty instructions falls back to default behavior.

**Repro.**

1. Build a DA with one MCP-server-backed tool that returns rich `structuredContent`
   suitable for a widget.
2. DA `instructions` say "Always call the tool. Never answer from your own knowledge.
   Never narrate."
3. User asks a question. Tool returns. Widget renders.
4. **Observe**: a paragraph of host-model text appears next to the widget commenting on
   the data, sometimes contradicting it, sometimes hedging.

**Ask.** At least one of:

1. **DA-level field** `behavior_overrides.suppress_post_tool_response: true` — when set,
   the host model emits zero tokens after a successful tool call; the widget's
   `structuredContent` IS the entire turn.
2. **Per-function field** `capabilities.response_semantics.mode: "widget_only"` (or
   similar) — same effect, scoped to a single tool. Lets makers mix narrating tools and
   silent-dispatcher tools in one DA.
3. **Per-call signal in the tool response** `_meta["openai/suppressResponse"]: true` —
   highest fidelity; the server decides per call whether the host should narrate.
4. Mirror the Copilot Studio UI toggle 1:1: DA designers pick "Respond after tool" /
   "Don't respond" per action, like CS makers can today.

**Why it matters.** This is the single largest source of "weird two-headed reply" UX in
M365 Copilot data widgets. Without it, every widget-style DA either has a verbose host
narration that competes with the widget, or relies on prompt-magic in DA `instructions`
that breaks with model updates. The toggle exists in CS — declarative agents need parity.

**Workaround.** None reliable. We make the tool's `content[0].text` empty or whitespace
to give the host nothing to riff on, but the host LLM often invents commentary anyway
based on `structuredContent`. We tighten DA `instructions` to "be silent after tool
calls" — works ~60% of the time. CS Copilot Studio doesn't have this gap.

---

### 2.8 Let an MCP App run as an actual app, not as a tool the LLM may call

**Pain.** The current MCP App contract treats every user turn as "host LLM looks at the
DA instructions, decides whether to invoke a tool, calls it, then narrates." That model
is right for *augmenting* the host with knowledge, but it's the wrong model for
*launching an app*. When a user picks the "Eurozone Analyst" agent from the agent
picker, they have already chosen the app — the host shouldn't be re-deciding whether
to route to it on every turn.

Concretely, the LLM-in-the-loop costs are paid on every single user message:

- **Latency.** Pre-tool LLM pass (0.3–1 s) + post-tool narrate pass (0.5–2 s) added to
  every turn, on top of the actual tool work.
- **Cost.** Two LLM passes per turn that the maker is implicitly billed for, even when
  the maker just wants the tool's `structuredContent` rendered.
- **Reliability.** The host can choose *not* to call the tool (FR 2.6), can lose the
  `conversationId` between turns (drives the need for FR 2.8a below), and can narrate
  unwanted commentary (FR 2.7).
- **UX confusion.** Users see "an agent" in the picker, expect it to behave like an app
  (predictable, branded, fast), and instead get a chat surface where the agent
  occasionally answers from the host LLM's general knowledge.

**Ask.** Add an "app mode" / "deterministic mode" for declarative agents:

1. **DA-level field** `behavior_overrides.app_mode: true` — when set, the host
   short-circuits the LLM passes:
   - For each user turn, the host calls the agent's single declared "primary action"
     (or first action if only one exists) with `userQuery` set to the user's exact
     text and `conversationId` set to the **host-managed thread id** (see 2 below).
   - The widget that the tool returns IS the entire turn. No pre-LLM tool selection,
     no post-LLM narration.
   - Latency drops by ~1–3 s/turn; cost drops to one MCP call + widget mount.
2. **Host-managed conversation continuity.** When app mode is on, the host MUST pass
   a stable per-thread id (e.g. `_meta["m365copilot/threadId"]` or as the first arg
   of the action) to the tool. This eliminates the "host LLM forgot to echo
   `conversationId`" failure mode that today forces servers to keep a side cache
   keyed by user `oid`.

**Repro.**

1. Build a DA whose only purpose is to dispatch every user message to one MCP tool that
   renders a widget (the data-widget pattern from this repo).
2. Time end-to-end latency for 5 consecutive turns. Inspect server logs for tool-call
   payloads.
3. **Observe:** every turn pays ~1.5 s in LLM passes that contributed nothing. The
   `conversationId` argument is missing on ~30% of follow-up calls, so the server has
   to maintain a side cache to keep CS topic state alive.

**Why it matters.** Without app mode, MCP Apps will always be a degraded version of
"a real app embedded in M365 Copilot" — slower, less reliable, more expensive than the
underlying backend can be. Declarative agents that wrap a single backend (Copilot
Studio agent, internal API, custom analyst) are the most common pattern partners are
asking us about; they should not have to fight the host LLM to make that pattern work.

**Adjacent precedent.** This is the same architectural distinction Power Apps and Power
BI embeds make against Copilot summaries: the embed is the answer; the LLM doesn't
re-paraphrase it on every interaction. MCP Apps need the same bifurcation.

**Workaround today.** Tightened DA instructions ("you are a silent dispatcher, call the
tool, emit zero tokens") + empty `content[0].text` + server-side `oid → conversationId`
cache. Combined effect is acceptable but not great: ~70–80% silent, follow-ups
sometimes start a fresh conversation, every turn still pays 1–2 LLM passes.

---

## IMPORTANT — Conversation, state, observability

### 3.1 Expose the CS conversation id to the widget natively

**Pain.** The widget needs the CS conversation id to (a) correlate logs, (b) call escalation
tools that pass it on, (c) stay in sync with CS's own state machine. Today the widget has
to either acquire its own token + start a new CS conversation (parallel id, bad), or extract
the id from the M365 Copilot host bridge in undocumented ways.

**Ask.** Add `_meta["m365copilot/conversationId"]` (or equivalent) to every `tools/call`
payload delivered to the widget, sourced from the M365 Copilot host's own conversation context.

**Why it matters.** Conversation-id discipline is the single most important state principle
for resilient agents. Today's surface forces makers to fight it.

---

### 3.2 Dataverse logging / transcript export is OOB for CS but not surfaced for DA-fronted CS

**Pain.** CS logs every turn to Dataverse — which is one of the best reasons to use CS as
the brain. But when the agent is fronted by a DA + MCP widget, the maker can't easily
verify "yes, this turn made it to Dataverse" or browse the transcript without leaving the
widget context.

**Ask.**

- Document a default Dataverse query / link that surfaces the transcript for "this user's
  recent conversations with this agent."
- Optionally embed a transcript-viewer Adaptive Card that the widget can render.

**Why it matters.** Dataverse logging is a compliance + observability pillar customers buy
this stack for. Surface it.

---

### 3.3 Proactive messages (server → user) for declarative-agent-fronted CS

**Pain.** When a long-running task finishes (e.g. "your report is ready"), there is no clean
way to push a message into the user's M365 Copilot conversation **with the original CS
agent context**. CS has proactive APIs, but the M365 Copilot channel doesn't always honor
them for DA-fronted agents.

**Ask.** Confirm the proactive-message contract for DA-fronted CS, document it, and provide
a sample.

---

### 2.9 Static Adaptive Cards from a tool's `structuredContent` should render natively

**Pain.** Copilot Studio agents routinely attach Adaptive Cards
(`application/vnd.microsoft.card.adaptive`) to bot replies — info cards,
image cards, citation cards, columns, fact lists. When that same agent
is fronted by a DA + MCP App, the card payload is in `activity.attachments`
on the CS Direct Engine response, but the M365 Copilot widget host has
no native rendering primitive for "render this Adaptive Card". The
widget maker has to bundle an Adaptive Cards renderer (~120 KB) into
their widget, route the JSON through `structuredContent.adaptiveCards[]`,
and re-implement theming.

**Repro.**

1. CS topic outputs an Adaptive Card via "Send a message" → "Add
   message attachment" → Adaptive Card.
2. Surface the agent through a DA + MCP App data-widget.
3. Observe: card never renders. Either it's stripped from the activity
   the SDK exposes, or it lands in `attachments` with no widget host
   primitive to render it.

**Ask.**

1. Add a host-rendered surface for Adaptive Cards in `structuredContent`,
   e.g. `_meta["m365copilot/adaptiveCards"]: [...]` — host renders these
   above/below/inside the widget body.
2. Or, document a canonical `structuredContent` shape the host
   recognizes and renders without the widget needing its own
   Adaptive Cards bundle.

**Why it matters.** Adaptive Cards are the lingua franca for rich CS
responses. Forcing every widget to re-bundle the renderer + re-theme
to match host chrome is wasted effort and a 120 KB tax per widget.

**Workaround.** Bundle `adaptivecards` into the widget; extract from
`activity.attachments` server-side; theme manually. Documented in
spec 0002.

---

### 2.10 Adaptive Card form submit needs a low-overhead postback path

**Pain.** When a user fills an Adaptive Card form and clicks `Action.Submit`,
the result needs to flow back to CS as an Activity with `value: <formData>`,
not as a typed user message with `text: <stringified-form>`. CS topics
that wait on a card response check `activity.value.<field>` for slot
filling; if the data arrives as `text` it doesn't trigger the topic
correctly and slot filling breaks.

Today the only path from widget to CS is `window.openai.callTool('mySubmitTool', ...)`
which then triggers a fresh tool call → host LLM pre-pass → MCP server →
CS Direct Engine `sendActivityStreaming` → host LLM post-pass. The host
LLM passes alone cost ~1.5 s per click; for a 4-step wizard, that's 6 s
of pure LLM overhead the user pays for.

**Repro.**

1. CS topic: "What's your name?" → wait for card submit (4 fields).
2. Surface through DA + MCP App.
3. Build widget with Adaptive Cards renderer + form rendering +
   `Action.Submit` handler that calls a `submitCardAction` tool.
4. Time the click → next-card latency: ~3-5 s.

**Ask.**

1. **Direct widget-to-agent activity channel** (the strong fix). A new
   `window.openai.postActivity({ value, text?, conversationId? })` API
   that bypasses the host LLM and posts directly to the agent's
   conversation. Host returns the agent's reply (next card / next text)
   as a callback / promise. Latency drops to: serverless hop + CS
   inference. No LLM tax.
2. **App-mode bypass for postback** (combines with FR 2.8). When the
   DA is in app-mode, all `tools/call` from the widget skip both
   LLM passes and just do the round trip.

**Why it matters.** Forms are the principal way CS topics gather
structured input from users. Without low-overhead postback, every form
field interaction is a 3-second wait, which makes multi-step wizards
unusable.

**Workaround.** Live with the latency. Pretend the submit button is "thinking."
Documented in spec 0003.

---

## URGENT — Streaming and progressive disclosure

### 5.1 Streaming partial replies don't reach the widget

**Pain.** CS Direct Engine streams reply activities as they're produced
(typing indicators, partial text chunks). In standalone CS that gives
the user a "feels like ChatGPT" perception. In MCPApp, the tool
response is a single `tools/call` JSON-RPC reply that has to wait for
the full CS turn (drain to `EndOfConversation`) before returning. The
widget mounts only after everything is collected. User sees no progress
indicator beyond the M365 Copilot host's "Asking Eurozone Analyst…"
spinner.

**Repro.**

1. CS topic that replies with 2 KB of generative answer.
2. Standalone CS Test Pane: text streams in over ~3 s.
3. MCPApp: spinner for ~3 s, then full text appears at once.

**Ask.**

- Streaming `tools/call` responses on the MCP wire (server → host →
  widget). MCP supports server-sent partial results today; host needs to
  forward them.
- Or a `_meta["m365copilot/progressUpdate"]` postMessage channel
  the widget can subscribe to.

**Why it matters.** Streaming makes long replies bearable. Without it,
any CS agent that produces >500 chars of generative content feels slow
in MCPApp even when the underlying generation rate is the same.

**Workaround.** None today. Documented in spec 0006.

---

## IMPORTANT — File handling

### 6.1 No host primitive for "user clicks a download link in the widget"

**Pain.** When CS returns an attachment (PDF, XLSX, image) with a
`contentUrl`, the widget can render a button, but actually downloading
the file from the widget context has friction:
- `window.open(url)` is sandbox-blocked for non-`openExternal` schemes.
- `<a download>` works for cross-origin URLs only with CORS headers
  the file host might not send.
- `openExternal(url)` opens a new browser tab (good for HTML viewers,
  awkward for "save the PDF").

**Ask.** Add `window.openai.downloadFile({ url, suggestedName, mimeType })`
that the host honors as a real file download (browser save dialog).

**Why it matters.** Many CS agents are explicitly designed to deliver
documents (claim summaries, reports, contracts). Without a clean
download primitive, the widget UX is worse than standalone CS.

**Workaround.** Render `<a target="_blank" rel="noopener">` and hope
the user knows to right-click → Save As. Documented in spec 0007.

---

### 6.2 No host primitive for "user uploads a file to the agent"

**Pain.** Standalone CS surfaces support file upload (the input bar has
an attachment button; CS receives the file as `attachments[]` on the
incoming activity). The skybridge sandbox exposes nothing similar. A
maker who needs "user uploads invoice → agent extracts line items" has
no path.

**Ask.** `window.openai.requestFileUpload({ accept: "image/*,application/pdf", maxBytes })`
that returns a `Promise<{ blob, name, mimeType }>` after the host
shows a native file picker. Widget can then base64-encode and pass
the file via `tools/call`, or the host can stream it directly.

**Why it matters.** Upload is the #1 missing capability for "claims",
"expense", "support ticket" agents. Without it, MCPApp is permanently
unsuitable for those scenarios.

**Workaround.** Document the gap. Tell customers: file-upload
scenarios stay in standalone CS (Power Apps embed, Teams app, custom
website webchat) until this lands.

---

## NICE — Voice

### 7.1 Voice input from M365 Copilot reaches the widget as text only

**Pain.** When the user speaks into M365 Copilot, the host transcribes
to text and that text becomes `userQuery` on the tool call. The widget
sees no voice metadata (confidence, language, raw audio). Some CS
agents are explicitly tuned for voice prosody (telephony bots).

**Ask.** Optionally pass `_meta["m365copilot/inputMode"]: "voice"`
and `_meta["m365copilot/recognizedLanguage"]: "en-US"` so the widget
+ CS can branch on voice-vs-text.

**Why it matters.** Useful for accessibility, telephony parity. Low
priority but cheap to add.

---

### 7.2 No TTS for the widget's response text

**Pain.** Standalone CS / Bot Framework Web Chat support TTS for bot
responses. MCPApp widgets have no TTS hook. Voice users get text
output via the host's screen-reader at best.

**Ask.** `window.openai.speak({ text, voice?, lang? })` host primitive
that uses M365 Copilot's voice synthesizer.

**Why it matters.** Accessibility + voice-first scenarios. Low priority.

---

## NICE — Maker ergonomics

### 4.1 Teams Admin Center UX for declarative agents is obscure

**Pain.** Approving a published agent requires drilling: Teams admin center → Manage apps →
search → click row → click "Allow" or "Update available." There is no agent-specific view.
On mobile / smaller screens the row is truncated and approvals are easy to miss.

**Ask.** A dedicated **"Declarative Agents"** subview under Manage apps with explicit
columns for: maker, version, status, pending updates, last published, validDomains.

---

### 4.2 Manifest schema validators silently re-emit confusing errors

**Pain.** When the plugin manifest schema version is wrong (e.g. v2.3 instead of v2.4), the
validator emits two unrelated-looking errors: "unrecognized member" + "required member missing."
The maker has to know that this combination means "wrong schema version."

**Ask.** Validator should detect this pair and emit a single message:
*"Looks like you used schema vX, but field `Y` requires schema vZ. Bump your `schema_version`."*

---

### 4.3 Toolkit CLI: `teamsapp` deprecated → `m365agentstoolkit-cli` migration is rough

**Pain.** The legacy `teamsapp` CLI prints a deprecation warning but still works on Node 20.
The new `@microsoft/m365agentstoolkit-cli` requires different file naming
(`teamsapp.yml` vs `m365agents.yml`), and not all commands have feature parity.

**Ask.** Either keep the legacy CLI working until full feature parity, or ship a one-shot
`teamsapp migrate-to-m365agents` command that handles file renames + flag remapping.

**Workaround.** This repo keeps both `teamsapp.yml` (shim) and `m365agents.yml` so either CLI
works. Friction documented in [PROGRESS.md](PROGRESS.md).

---

### 4.4 Environment variable naming for CS connection settings is inconsistent

**Pain.** Different docs and samples use different variable names for the same CS connection:

- `VITE_CS_ENVIRONMENT_ID` vs `MCS_ENVIRONMENT_ID` vs `environmentId` (camelCase) in JS
- `appClientId` (sample) vs `VITE_ENTRA_CLIENT_ID` (this repo) vs `AAD_APP_ID` (some Learn docs)

**Ask.** Standardize on a documented env var contract for CS Direct Engine clients across
all official samples and docs.

---

## Bundling these as a roadmap

If you're a PM on the M365 Copilot extensibility / DA / Apps SDK / CS team and want to pick
the highest-leverage items:

| Priority | Items | Why |
|---|---|---|
| 1. Unblock CD | 1.1, 1.2, 1.3 | No real customer can ship updates without these |
| 2. Lower barrier | 2.1, 2.3, **2.5** | Productize the pattern; 10x more customers can adopt |
| 3. Make routing reliable | **2.6** | Custom-UI DAs only work if the model actually calls the tool |
| 4. Resilience | 3.1, 3.3 | Prevents bad architectures; makes proactive scenarios work |
| 5. Polish | 4.x | Quality of life |

If only one thing gets fixed in the next release, **make it 1.1 + 1.2** — without those,
custom CS+DA+widget agents are unshippable in production tenants. **The next release after
that should be 2.5** — silent sandbox failures cost every new maker a day.

---

## How to use this doc

- Forking customers: drop your additional asks into this list with the same `Pain / Repro /
  Ask / Why / Workaround` shape, then send to the relevant Microsoft team.
- Microsoft PMs: each section is independent and self-contained; you can excise one and
  send it to your specific team without losing context.
- This doc is intentionally not a vague wish list. Every entry is something we hit while
  building [this reference implementation](../README.md) and observed costs measurable maker time.
