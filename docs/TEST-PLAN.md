# MCSMCPapps — Test plan

> Tests live close to the behavior they verify: contract tests at the MCP server boundary,
> render tests in the widget, manual demo scripts for the M365 Copilot end-to-end. This doc
> is the index.

## 1. Test pyramid (from cheap to expensive)

```
                       Manual demo
                     ────────────────
                    Live M365 Copilot
                   ──────────────────────
                  Smoke (production HTTP)
                 ────────────────────────────
                Integration (local server)
              ────────────────────────────────────
            Contract (MCP shape, branding contract)
          ────────────────────────────────────────────
         Unit (functions, schemas, parsers)
```

Run the full pyramid before any release. Run contract + smoke before any deploy.

## 2. Test matrix

| ID | Layer | What | Where | Run when |
|---|---|---|---|---|
| U1 | Unit | tool input schema (Zod) accepts/rejects | `mcp-server/test/tools.test.ts` | every commit |
| U2 | Unit | branding env reader merges defaults | `webchat-ui/test/branding.test.ts` | every commit |
| U3 | Unit | host detect picks the right host | `webchat-ui/test/host.test.ts` | every commit |
| U4 | Unit | skybridge.readToolInput parses 3 known shapes | `webchat-ui/test/skybridge.test.ts` | every commit |
| C1 | Contract | resources/read returns `text/html+skybridge` MIME | `mcp-server/test/contract.test.ts` | every commit |
| C2 | Contract | tools/list emits `openai/outputTemplate` + `widgetAccessible` | same | every commit |
| C3 | Contract | tools/call response re-emits the openai/* keys | same | every commit |
| C4 | Contract | resource _meta has `domain`, `prefersBorder`, `csp.{connect,resource,frame}Domains` | same | every commit |
| C5 | Contract | manifest scope CI guard rejects bots/staticTabs/etc. | `.github/workflows/manifest-scope-check.yml` | every push |
| I1 | Integration | initialize → notifications/initialized → tools/list (session-keyed) | `mcp-server/test/integration.test.ts` | every commit |
| I2 | Integration | session eviction returns 404 with `error.code:-32001` | same | every commit |
| I3 | Integration | DELETE /mcp closes a session cleanly | same | every commit |
| I4 | Integration | widget bundle is present in `mcp-server/dist/` after build | build script | every build |
| S1 | Smoke (prod) | initialize → tools/call → 200 with valid contract | `scripts/smoke-mcp.ps1` | post-deploy |
| S2 | Smoke (prod) | resources/read returns non-empty HTML body with `<html` | same | post-deploy |
| S3 | Smoke (prod) | SWA returns 200 with `<div id="root"` | `scripts/smoke-swa.ps1` | post-deploy |
| M1 | Manual M365 Copilot | "what's the GDP of France?" → widget renders | [§4.1](#41-m1-first-render-happy-path) | every release |
| M2 | Manual M365 Copilot | follow-up question stays in same CS conversation | [§4.2](#42-m2-multi-turn) | every release |
| M3 | Manual M365 Copilot | mid-session container restart → next message recovers | [§4.3](#43-m3-restart-recovery) | every release |
| M4 | Manual M365 Copilot | escalation phrase → Omnichannel agent picks up with full transcript | [§4.4](#44-m4-escalation) | every release |
| M5 | Manual SWA | standalone WebChat at SWA URL works the same | [§4.5](#45-m5-standalone) | every release |
| M6 | Manual maker | fork repo, change brand vars, rebuild, see new brand | [§4.6](#46-m6-rebrand) | every release |
| P1 | Perf | first-token p50 ≤ 4 s warm | `scripts/perf.mjs` | weekly |

## 3. Detailed acceptance criteria

### 3.1 Contract tests (the most important suite)

These tests will catch the bug class that cost us a day in May 2026 (wrong MIME, wrong
`_meta` key, etc.). Every contract change must come with a contract test update.

```ts
// mcp-server/test/contract.test.ts (sketch)
describe("MCP Apps / OpenAI Apps SDK contract", () => {
  it("resources/read returns the verified MIME", async () => {
    const r = await readResource("ui://mcsmcpapps/chat");
    expect(r.contents[0].mimeType).toBe("text/html+skybridge");
  });

  it("tool descriptor has openai/outputTemplate AND widgetAccessible", async () => {
    const tools = await listTools();
    const t = tools.find(x => x.name === "openCopilotStudioChat")!;
    expect(t._meta["openai/outputTemplate"]).toBe("ui://mcsmcpapps/chat");
    expect(t._meta["openai/widgetAccessible"]).toBe(true);
  });

  it("tools/call response re-emits the descriptor _meta", async () => {
    const r = await callTool("openCopilotStudioChat", { userQuery: "x" });
    expect(r._meta["openai/outputTemplate"]).toBe("ui://mcsmcpapps/chat");
    expect(r._meta["openai/widgetAccessible"]).toBe(true);
  });

  it("resource _meta has frame-domain for the SWA origin", async () => {
    const r = await readResource("ui://mcsmcpapps/chat");
    const csp = r.contents[0]._meta.ui.csp;
    // Note: in v0.5 we use single-file widget so frameDomains may be absent;
    // assert the contract you actually intend to ship.
    expect(csp.connectDomains).toContain("https://*.api.powerplatform.com");
  });
});
```

### 3.2 Manifest scope guard

The repo invariant: `manifest.json` contains **only** `copilotAgents.declarativeAgents`. No
bots, no tabs, no compose extensions. CI fails if violated.

```yaml
# .github/workflows/manifest-scope-check.yml — already in place; do not weaken
- run: |
    if grep -E '"(bots|staticTabs|configurableTabs|composeExtensions|meetingExtensionDefinition|extensions|connectors|webApplicationInfo)"' \
       declarative-agent/appPackage/manifest.json; then
      echo "::error ::Manifest contains forbidden surface. M365 Copilot only."
      exit 1
    fi
```

## 4. Manual M365 Copilot scenarios

Run these in the CDX tenant the day of every release. Every step must pass; a failure
gates the release.

### 4.1 M1 First-render happy path

**Pre:** v0.X published to CDX, admin approved, agent visible in M365 Copilot agent picker.

**Steps:**
1. Open https://m365.cloud.microsoft/chat in fresh InPrivate window.
2. **+ New chat.**
3. Sidebar → Agents → Eurozone Analyst. Confirm chat header shows the **€** logo on
   blue + the agent display name.
4. Type: "what's the GDP of France?"
5. Observe: status text "Opening Eurozone Analyst…" briefly. Then a card mounts.
6. Card body should be the React widget — branded header, message stream, input field.
7. The user's question should appear automatically as the first user message (no retype).
8. Within ~4 s, CS reply streams in: text + (if topic returns one) chart image.

**Pass:** every step. **Fail:** anything missing, any "Something went wrong," any blank card.

### 4.2 M2 Multi-turn

**Pre:** M1 passed.

**Steps:**
1. In the widget, type follow-up: "show inflation by member state."
2. Observe: reply streams in same widget (no new card mounts).
3. Repeat 5 more turns of varying questions.
4. Open browser DevTools → Network → filter `mcp`. Confirm: **zero** new POST /mcp calls
   after the initial tools/call. Chat traffic is widget → CS direct.

**Pass:** all turns reply, no new MCP calls, conversation id stable.

### 4.3 M3 Restart recovery

**Pre:** M2 passed.

**Steps:**
1. From a separate terminal: `az webapp restart -g rg-mcsmcpapps -n app-mcsmcpapps-mcp`.
2. Wait 10 s.
3. **+ New chat** in M365 Copilot. Open Eurozone Analyst again.
4. Type a question.
5. Observe: widget mounts, conversation works.

**Pass:** new chat works after restart with no user-visible error.

### 4.4 M4 Escalation

**Pre:** D365 Omnichannel for Customer Service connected via Settings → Agent transfers
→ Omnichannel in the CS agent. At least one queue with one agent online.

**Steps:**
1. In the widget, type: "I want to talk to a person."
2. Observe: CS topic responds with a confirmation Adaptive Card.
3. Click "Connect."
4. Observe: widget shows "Connecting you to an agent…" message.
5. As the live agent, in Omnichannel agent dashboard: accept the conversation.
6. Verify the agent sees the **full transcript** of the bot conversation.
7. From the agent side: send a message.
8. Back in the widget: observe the agent's message appears.
9. Two-way chat for 3 turns.
10. Agent ends conversation.
11. Widget shows the post-escalation flow defined by the CS topic.

**Pass:** all of the above with no MCP server logs touched (verify via App Insights — zero
calls during escalation).

### 4.5 M5 Standalone

**Pre:** v0.X SWA deployed.

**Steps:**
1. Browse to https://icy-field-07d5bef1e.7.azurestaticapps.net (or current SWA hostname).
2. MSAL silent SSO → user signed in.
3. Same React app, same brand.
4. Same questions M1–M2.

**Pass:** identical functional behavior to M1–M2.

### 4.6 M6 Rebrand

**Pre:** local dev environment with this repo.

**Steps:**
1. `git clone` repo to a fresh dir.
2. Copy `.env.dev.sample` → `.env.dev` in `webchat-ui/`. Set: `VITE_BRAND_AGENT_NAME="Test"`,
   `VITE_BRAND_LOGO_TEXT="🚀"`, `VITE_BRAND_ACCENT="#ff0066"`. Set CS env id and schema.
3. `npm run build` in `webchat-ui/`.
4. `npm run build` in `mcp-server/` (which imports the widget bundle).
5. Run MCP server locally: `node dist/index.js`.
6. Open MCP Inspector at https://inspector.modelcontextprotocol.io against
   `http://localhost:3001/mcp`.
7. Call openCopilotStudioChat. Inspect the resource.
8. Render the resource in Inspector.
9. Confirm: header reads "Test", logo is rocket emoji, accent is hot pink.

**Pass:** brand changes visible without touching any non-env file. Maker time ≤ 10 min.

## 5. Performance

P1 — first-token latency on a warm B1.

```ts
// scripts/perf.mjs (sketch)
// 100 sessions, sequential, each: initialize -> tools/call -> measure ms to first content
// report p50, p95, p99
```

Target: p50 ≤ 4 s, p95 ≤ 10 s. If we miss, escalate to App Service Premium tier in
[CAPABILITIES.md](CAPABILITIES.md).

## 6. Smoke test scripts (must exist; run on every deploy)

```pwsh
# scripts/smoke-mcp.ps1
# - initialize
# - notifications/initialized
# - tools/list — verify openai/outputTemplate + widgetAccessible
# - resources/read — verify text/html+skybridge MIME and non-empty body
# - tools/call openCopilotStudioChat({userQuery:"smoke"}) — verify _meta.openai/outputTemplate

# scripts/smoke-swa.ps1
# - GET https://<swa> — verify 200 + <div id="root"
# - GET https://<swa>/index.html — verify branding env vars present in inlined script (or compiled chunk)
```

Already exist in this repo as inline test commands. Will be promoted to `scripts/` in v0.6.

## 7. Test data and accounts

- CDX tenant: `301759bc-5be1-40f1-8a44-822e286f5a9d` (see [IDs.md](IDs.md) for full list)
- CS environment: `61453fde-f312-e19f-b879-a2dfa518e914`
- CS agent schema: `ksteam_ak001`
- Test user: `karima@M365x05526665.onmicrosoft.com`
- Test prompts: see [§4.1–4.4](#4-manual-m365-copilot-scenarios) — keep stable across releases
  for repeatability

## 8. Release checklist (gate before pushing publish)

- [ ] All U/C/I tests green
- [ ] Build artifacts present (mcp-server/dist/, webchat-ui/dist/, webchat-ui/dist-widget/)
- [ ] App package zip rebuilt and validated
- [ ] PROGRESS.md updated with phase notes
- [ ] Manifest version bumped
- [ ] Git tag set
- [ ] Smoke test script ran and passed against staging or against prod after deploy
- [ ] M1–M6 manual scenarios passed in CDX
- [ ] No new TODOs added without GitHub issue links

## 9. Test ownership

Engineering owns U/C/I/S. PM owns M (manual demo scripts) and signs off before release. Any
new feature ships only with new tests at all relevant layers — no exceptions.
