# Widget customization

> Goal: customizing this widget is **at least as easy** as the
> Copilot Studio Kit Webchat Playground. Read this if you forked the repo
> and want to make the chat surface look like *your* product.

## TL;DR

Three layers, ordered easiest → most flexible:

1. **Change colors / fonts / agent name:** edit env vars (8 of them). No code.
2. **Full visual rebrand:** drop a `styleOptions.json` exported from
   [Copilot Studio Kit Webchat Playground](https://aka.ms/CopilotStudioKit).
   No code.
3. **Add UI features (charts, panels, cards):** edit `Widget.tsx`. React.

After any change: `npm run build:widget` in `webchat-ui/`. The MCP server
picks up the new bundle on next process start.

---

## Layer 1 — env vars (the 60-second rebrand)

Edit `webchat-ui/.env` (copy from `.env.example` first). Set any of:

| Variable | Effect |
|---|---|
| `VITE_BRAND_AGENT_NAME` | Display name on widget header |
| `VITE_BRAND_COMPANY_NAME` | Company name shown above the agent name |
| `VITE_BRAND_ACCENT_COLOR` | Primary color (user bubble, send button, links) |
| `VITE_BRAND_ACCENT_FOREGROUND` | Text color on the accent (user bubble text) |
| `VITE_BRAND_FONT_FAMILY` | CSS font stack |
| `VITE_BRAND_BOT_AVATAR_INITIALS` | 1–2 characters in the bot avatar |
| `VITE_BRAND_LOGO` | Single emoji / initials displayed in standalone-SWA header |
| `VITE_BRAND_PAGE_TITLE` | `<title>` in the standalone-SWA bundle |

Then:

```pwsh
cd webchat-ui
npm run build:widget   # for the M365 Copilot widget
npm run build          # for the standalone SWA
```

These env values **override** anything in `style-options.json` for the
keys they touch. So if you only want to swap the accent color, you edit
one env var, rebuild, ship.

CI: set the same names as **GitHub Actions Variables** (Settings →
Secrets and variables → Actions → Variables). The
`azure-mcp-server.yml` workflow reads them and passes them to the build.

---

## Layer 2 — `style-options.json` (the CS Kit-compatible visual edit)

This is the productized layer. It works like Copilot Studio Kit's
Webchat Playground:

1. Open the [Copilot Studio Kit Webchat Playground](https://aka.ms/CopilotStudioKit)
   (or any BotFramework Web Chat theming tool).
2. Tweak visuals interactively — bubbles, fonts, suggested actions,
   sendbox, anything.
3. Export the `styleOptions` JSON from the playground.
4. Paste it over `webchat-ui/src/widget/style-options.json`.
5. `npm run build:widget` and you're done.

Every key is documented in
[BotFramework Web Chat StyleOptions](https://github.com/microsoft/BotFramework-WebChat/blob/main/packages/api/src/StyleOptions.ts).
The most useful keys for branding:

| Key | What it controls |
|---|---|
| `accent` | Send button, links, focus rings |
| `bubbleBackground` / `bubbleTextColor` | Bot message bubble |
| `bubbleFromUserBackground` / `bubbleFromUserTextColor` | User message bubble |
| `bubbleBorderRadius` / `bubbleFromUserBorderRadius` | Bubble corner roundness |
| `botAvatarInitials` / `botAvatarBackgroundColor` / `botAvatarTextColor` | Bot avatar |
| `userAvatarInitials` | Set to empty to hide |
| `suggestedActionLayout` | `"stacked"` or `"flow"` |
| `suggestedActionBorderColor` / `suggestedActionTextColor` | "Try…" buttons |
| `sendBoxBackground` / `sendBoxTextColor` / `sendBoxBorderTop` | Bottom input |
| `primaryFont` / `monospaceFont` | Font stacks |
| `hideUploadButton` | Hide attachment paperclip |
| `rootHeight` / `rootWidth` | Override container sizing |

The shipped `style-options.json` in this repo is a Eurozone Analyst
preset — feel free to delete and start from CS Kit Playground export.

---

## Layer 3 — React component (the unbounded path)

When env vars and `styleOptions` aren't enough — you want a chart panel,
a side rail, a custom Adaptive Card renderer, follow-up tool buttons —
edit the React tree.

Files of interest:

- [`webchat-ui/src/widget/Widget.tsx`](../webchat-ui/src/widget/Widget.tsx)
  — main React component. Mounts `<Composer>` + `<BasicWebChat>`.
  Replace `<BasicWebChat />` with custom layouts. Wrap in panels.
- [`webchat-ui/src/widget/main.tsx`](../webchat-ui/src/widget/main.tsx)
  — entry. Acquires the token and renders `<Widget>`.
- [`webchat-ui/src/widget/cs-connection.ts`](../webchat-ui/src/widget/cs-connection.ts)
  — wraps `CopilotStudioWebChat.createConnection()`. Touch only if you
  need to override Direct Engine settings.
- [`webchat-ui/src/widget/host-bridge.ts`](../webchat-ui/src/widget/host-bridge.ts)
  — reads tool input from `window.openai` + JSON-RPC postMessage.
  Touch only if you need to react to host events beyond the first message.

`botframework-webchat` exposes hooks at
[`botframework-webchat/hook`](https://github.com/microsoft/BotFramework-WebChat/tree/main/packages/component/src/hooks)
that let you build any custom layout against the same activity stream.

After changes: `npm run build:widget`, then redeploy the MCP server (or
copy the bundle into `mcp-server/dist/assets/widget.html` for local
testing).

---

## What about adding a new MCP tool?

Different file. See
[`mcp-server/src/tools/openCopilotStudioChat.ts`](../mcp-server/src/tools/openCopilotStudioChat.ts)
for the pattern. Each tool is a one-file addition:

```ts
// mcp-server/src/tools/myNewTool.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerMyNewTool(server: McpServer) {
  server.registerTool('myNewTool', {
    title: 'My New Tool',
    description: '...',
    inputSchema: { foo: z.string() },
    annotations: { readOnlyHint: true }
  }, async ({ foo }) => ({
    content: [{ type: 'text', text: `Did the thing with ${foo}` }]
  }));
}
```

Then call `registerMyNewTool(server)` from
[`mcp-server/src/server.ts`](../mcp-server/src/server.ts). Build, redeploy.

---

## Productization

If Microsoft were to productize this pattern, the simplest GA shape is:

1. **CS Kit Webchat Playground export → drop into our repo** is already
   the maker workflow. That's the same surface the CS Kit team
   maintains; there's a clean handoff.
2. **The single-file widget HTML is the productizable unit.** Microsoft
   could ship a CLI (`npm create @microsoft/copilot-widget`) that
   produces this exact file shape from a CS env id + brand vars in one
   command.
3. **CSP and `_meta` shape** are already verified against
   [microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples).

If we don't productize this, the CS Kit team is the natural home — see
[FEATURE-REQUESTS.md §2.3](FEATURE-REQUESTS.md) for the explicit ask.

---

## Critical: don't break the skybridge bundle

If you change the Vite config (`vite.widget.config.ts`), keep these two settings — they are
load-bearing for the widget to actually render in M365 Copilot:

### `stripCrossorigin()` plugin

Vite emits `<script type="module" crossorigin>...</script>` by default. The skybridge sandbox
iframe has a **null origin**; the browser's CORS check on the inline script sees null,
silently refuses to execute, and you get a blank card with no diagnostic.

This repo includes a tiny post-transform Vite plugin that strips the attribute. **Do not
remove it.** Verify after every build:

```pwsh
[regex]::Match((Get-Content webchat-ui/dist-widget/index.widget.html -Raw), '<script[^>]*>').Value
# Expected: <script type="module">         (no crossorigin attribute)
```

Microsoft's reference samples include the same plugin
([oai-apps-sdk/trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts)).

### `mode: 'production'` + `define NODE_ENV`

Without these, Vite leaks dev-only code that uses `eval()` and `new Function()`. The sandbox
CSP blocks both. Symptoms: blank card OR a console error about `unsafe-eval`. **Do not
remove these settings.**

If you fork this and change frameworks (e.g. swap React for Solid), apply the same two rules
to your new bundler:

| Bundler | "Strip crossorigin" equivalent | "Production mode" equivalent |
|---|---|---|
| Vite + React | `stripCrossorigin()` plugin (this repo) | `mode: 'production'` + `define NODE_ENV` |
| esbuild | post-process the output HTML | `--define:process.env.NODE_ENV='"production"'` |
| webpack | `HtmlWebpackPlugin` config | `mode: 'production'` |
| Rollup | `@rollup/plugin-html` config | `process.env.NODE_ENV` define |
| Next.js (static export) | needs custom post-build step | `NODE_ENV=production npm run build` |

The full list of skybridge contract requirements is in
[MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md) §6.

---

## Verifying your changes locally

```pwsh
# 1. Build the widget
cd webchat-ui
npm run build:widget

# 2. Stage it for the MCP server
cd ..\mcp-server
mkdir dist\assets -ErrorAction SilentlyContinue
copy ..\webchat-ui\dist-widget\index.widget.html dist\assets\widget.html

# 3. Run the MCP server
node dist\index.js

# 4. Inspect with MCP Inspector at https://inspector.modelcontextprotocol.io
#    against http://localhost:3000/mcp — call openCopilotStudioChat,
#    open the resource preview, see your customized widget render.
```

If the widget renders correctly in MCP Inspector, it will render
correctly in M365 Copilot — they implement the same skybridge contract.
