# Widget customization

> Goal: a maker who has forked this repo and wants to make the inline data card look like *their* product, or add a new visualization, should not need to read TypeScript end-to-end. This page is the path.
>
> This doc was rewritten 2026-05-11 to match the v0.7 data-widget pattern. The v0.5 "edit `Widget.tsx` with `<Composer>` + `<BasicWebChat>`" path is gone — that whole approach was retired per [ADR 0001](decisions/0001-chat-in-chat-was-wrong.md). Previous version preserved as [`WIDGET-CUSTOMIZATION.v0.5.md`](WIDGET-CUSTOMIZATION.v0.5.md).

## TL;DR

Three layers, ordered easiest → most flexible:

1. **Change colors / fonts / agent name:** edit env vars in `webchat-ui/.env`. No code.
2. **Add a new layout / chart / panel:** edit [`webchat-ui/src/widget-v2/main.tsx`](../webchat-ui/src/widget-v2/main.tsx). React 16 + inline CSS, ~250 KB bundle budget.
3. **Render a new content type from CS:** extend `structuredContent` in [`mcp-server/src/cs.ts`](../mcp-server/src/cs.ts) (extractor) and [`mcp-server/src/tools/openCopilotStudioChat.ts`](../mcp-server/src/tools/openCopilotStudioChat.ts) (passthrough), then render it in `main.tsx`.

After any change:

```pwsh
cd webchat-ui
npm run build:widget-v2
```

The MCP server picks up the new bundle from `dist-widget-v2/index.widget-v2.html` at start. The CI workflow does the same copy on deploy.

---

## Layer 1 — env vars (the 60-second rebrand)

Copy `webchat-ui/.env.example` to `webchat-ui/.env` and set any of:

| Variable | Effect | Example |
|---|---|---|
| `VITE_BRAND_AGENT_NAME` | Display name on widget header | `Acme Analyst` |
| `VITE_BRAND_AGENT_SUBTITLE` | Tagline shown under the agent name | `AI economic briefings` |
| `VITE_BRAND_COMPANY_NAME` | Company name in the header chrome | `Contoso` |
| `VITE_BRAND_ACCENT_COLOR` | Primary color (links, buttons, accent borders) | `#003399` |
| `VITE_BRAND_ACCENT_FOREGROUND` | Text color on the accent (button text, etc.) | `#ffd200` |
| `VITE_BRAND_FONT_FAMILY` | CSS font stack | `"Segoe UI", system-ui, sans-serif` |
| `VITE_BRAND_LOGO` | Single emoji / character / data: URL — small mark in the header | `€` |
| `VITE_BRAND_PAGE_TITLE` | `<title>` for the standalone SWA channel | `Acme Analyst` |

```pwsh
cd webchat-ui
npm run build:widget-v2
```

The values are baked into the bundle at build time. The CI workflow reads the same names from **GitHub Actions Variables** (Repository settings → Secrets and variables → Actions → Variables). Anything not set falls back to a sensible default in the source.

For batch-renaming across all the spots a maker touches (server config, manifest, widget env), use the brand-swap helper:

```pwsh
./scripts/swap-brand.ps1 `
  -CsEnvId "<env guid>" `
  -CsSchema "<schema name>" `
  -TenantId "<m365 tenant guid>" `
  -AgentName "Acme Analyst" `
  -AccentColor "#003399" `
  -LogoText "A"
```

The script is idempotent and only edits the four files a maker should change. Source: [`scripts/swap-brand.ps1`](../scripts/swap-brand.ps1).

---

## Layer 2 — React component (the unbounded path)

Open [`webchat-ui/src/widget-v2/main.tsx`](../webchat-ui/src/widget-v2/main.tsx). It's one file, ~830 lines, single React tree. The shape:

```
function Widget() {
  const payload = readPayload();          // window.openai.toolOutput.structuredContent
  if (!payload) return <Pending />;
  if (payload.diag && !payload.diag.ok) return <ErrorState payload={payload} />;
  return (
    <div className="mcs-card">
      <ReplyText markdown={payload.replyText} />
      <AdaptiveCardHost cards={payload.adaptiveCards} convId={payload.conversationId} />
      <Citations items={payload.citations} />
      <SuggestedActions actions={payload.suggestedActions} convId={payload.conversationId} />
    </div>
  );
}
```

To add a new visualization, write a new component, drop it into the render tree. Examples already in the file:

- `<Sparkline series={...} />` — pure SVG, no deps, ~10 lines.
- `<CompareBars series={...} />` — CSS grid + accent-colored bars.
- `<StatBlock title primaryValue deltaText />` — large-number callout.

Use the existing inline CSS classes (`.mcs-card`, `.mcs-stat`, `.mcs-compare`, `.mcs-citations`, `.mcs-error`) — they already respond to the brand env vars.

The widget intentionally does **not** depend on Fluent UI, MUI, or any other component library. The bundle budget is ~250 KB gzipped; adding a heavy framework breaks that (and would compete with the Adaptive Cards renderer which is already 120 KB). If you need shared visual primitives, copy them inline.

### What you can NOT do in the widget (skybridge sandbox constraints)

- ❌ No `eval()`, `new Function()`, dynamic imports of non-bundled modules — CSP blocks all of them.
- ❌ No `fetch()` to non-allowlisted origins — extend `_meta.ui.csp.connectDomains` in [`mcp-server/src/resources/chatWidget.ts`](../mcp-server/src/resources/chatWidget.ts) first.
- ❌ No `<iframe>` to other origins — `frameDomains` is empty by design.
- ❌ No top-level navigation, no popups, no `window.open()` — use `window.openai.openExternal({ href })` for links.
- ❌ No internal chat input — the M365 Copilot host owns the chat input. [MS UX guidance](https://learn.microsoft.com/microsoft-365/copilot/extensibility) is explicit.
- ❌ No internal scroll — fit in a single response scroll. For richer flows, request fullscreen mode via `window.openai.requestDisplayMode({ mode: 'fullscreen' })`.

### What's available in the widget

- `window.openai.toolOutput.structuredContent` — what the server sent.
- `window.openai.toolInput` — what the host LLM called the tool with.
- `window.openai.theme` — `'light'` | `'dark'` from host theme.
- `window.openai.displayMode` — `'inline'` | `'fullscreen'`.
- `window.openai.notifyIntrinsicHeight(h)` — tell the host how tall to render the inline card.
- `window.openai.requestDisplayMode({ mode })` — go fullscreen for analyst-style reading.
- `window.openai.openExternal({ href })` — open a link in a new tab.
- `window.openai.callTool(name, args)` — fire a follow-up tool call (used by Submit and suggested actions).
- `window.openai.sendFollowUpMessage({ prompt })` — inject a prompt into the host chat as if the user typed it.

Full bridge inventory in [`docs/MCP-APPS-CONTRACT.md`](MCP-APPS-CONTRACT.md).

---

## Layer 3 — Adding a new content type from CS

Three coordinated edits:

### 1. Extract from CS in `cs.ts`

CS replies are Bot Framework activities. To surface a new content type — say a chart payload your CS topic emits as a custom Adaptive Card data field — add an extractor in [`mcp-server/src/cs.ts`](../mcp-server/src/cs.ts). Look for the existing `chartData` extraction as a template: it inspects `activity.attachments` for the private `application/vnd.mcsmcpapps.chart+json` content type and pulls the JSON out.

Add your new extractor next to it. Add the field to `CallCsAgentResult`:

```ts
export interface CallCsAgentResult {
  // ...existing fields
  myNewThing: MyNewThingPayload | null;
}
```

### 2. Pass through in the tool

In [`mcp-server/src/tools/openCopilotStudioChat.ts`](../mcp-server/src/tools/openCopilotStudioChat.ts), the handler builds `structuredContent` from the `callCsAgent` result. Add your new field to the object. **This is additive — older widgets ignore the new field.** No manifest bump required.

Same edit in [`submitAdaptiveCardAction.ts`](../mcp-server/src/tools/submitAdaptiveCardAction.ts) if the AC submit path should also carry it.

### 3. Render in the widget

In `main.tsx`, extend the `ToolPayload` interface with the new field, then render it conditionally:

```tsx
{payload.myNewThing && <MyNewThingComponent data={payload.myNewThing} />}
```

Build the widget, run the local smoke, ship.

---

## Critical: don't break the skybridge bundle

If you change [`webchat-ui/vite.widget-v2.config.ts`](../webchat-ui/vite.widget-v2.config.ts), keep these two settings — they are load-bearing for the widget to actually render in M365 Copilot:

### `stripCrossorigin()` plugin

Vite emits `<script type="module" crossorigin>...</script>` by default. The skybridge sandbox iframe has a **null origin**; the browser's CORS check on the inline script sees null, silently refuses to execute, and you get a blank card with no diagnostic.

This repo includes a tiny post-transform Vite plugin that strips the attribute. **Do not remove it.** Verify after every build:

```pwsh
[regex]::Match((Get-Content webchat-ui/dist-widget-v2/index.widget-v2.html -Raw), '<script[^>]*>').Value
# Expected: <script type="module">         (no crossorigin attribute)
```

Microsoft's reference samples include the same plugin
([oai-apps-sdk/trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts)).

### `mode: 'production'` + `define NODE_ENV`

Without these, Vite leaks dev-only code that uses `eval()` and `new Function()`. The sandbox CSP blocks both. Symptoms: blank card OR a console error about `unsafe-eval`. **Do not remove these settings.**

If you fork this and change frameworks (e.g. swap React for Solid), apply the same two rules to your new bundler:

| Bundler | "Strip crossorigin" equivalent | "Production mode" equivalent |
|---|---|---|
| Vite + React | `stripCrossorigin()` plugin (this repo) | `mode: 'production'` + `define NODE_ENV` |
| esbuild | post-process the output HTML | `--define:process.env.NODE_ENV='"production"'` |
| webpack | `HtmlWebpackPlugin` config | `mode: 'production'` |
| Rollup | `@rollup/plugin-html` config | `process.env.NODE_ENV` define |
| Next.js (static export) | needs custom post-build step | `NODE_ENV=production npm run build` |

The full skybridge contract is in [`docs/MCP-APPS-CONTRACT.md`](MCP-APPS-CONTRACT.md).

---

## Verifying your changes locally

```pwsh
# 1. Build the widget
cd webchat-ui
npm run build:widget-v2

# 2. Stage it for the MCP server (CI does this on deploy)
cd ..\mcp-server
New-Item -ItemType Directory dist\assets -Force | Out-Null
Copy-Item ..\webchat-ui\dist-widget-v2\index.widget-v2.html dist\assets\widget.html -Force

# 3. Build + run the MCP server with placeholder env vars
npm run build
$env:CS_ENV_ID = "00000000-0000-0000-0000-000000000000"
$env:CS_SCHEMA = "smoke_test"
$env:AGENT_NAME = "Local"
$env:AGENT_DESCRIPTION = "local"
$env:SWA_ORIGIN = "https://example.invalid"
$env:PORT = "3000"
node dist\index.js
```

Then in another terminal:

```pwsh
cd mcp-server
node scripts/smoke-mcp.mjs http://localhost:3000/mcp --manifest ../declarative-agent/appPackage/ai-plugin.json
```

If the smoke passes, the contract is intact. Open [MCP Inspector](https://inspector.modelcontextprotocol.io) against `http://localhost:3000/mcp` to preview the rendered widget; if it renders in Inspector, it will render in M365 Copilot (same skybridge contract).

---

## Adding a new MCP tool

Different file. Each tool is a one-file addition in [`mcp-server/src/tools/`](../mcp-server/src/tools/):

```ts
// mcp-server/src/tools/myNewTool.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerMyNewTool(server: McpServer): void {
  server.registerTool('myNewTool', {
    title: 'My New Tool',
    description: 'One sentence describing when to call it.',
    inputSchema: { foo: z.string() },
    annotations: { readOnlyHint: true }
  }, async ({ foo }) => ({
    content: [{ type: 'text', text: `Did the thing with ${foo}` }],
    structuredContent: { result: foo }
  }));
}
```

Then call `registerMyNewTool(server)` from [`mcp-server/src/server.ts`](../mcp-server/src/server.ts). **Then update the manifest** — both `functions[]`, `run_for_functions[]`, and `x-mcp_tool_description.tools[]` in [`declarative-agent/appPackage/ai-plugin.json`](../declarative-agent/appPackage/ai-plugin.json), bump `manifest.json` version, and re-approve in the tenant admin. The locked-contract rules in [ADR 0005](decisions/0005-arg-optionality-is-locked.md) apply.

The pre-deploy smoke ([`mcp-server/scripts/smoke-mcp.mjs`](../mcp-server/scripts/smoke-mcp.mjs)) will fail in CI if the manifest and server disagree.
