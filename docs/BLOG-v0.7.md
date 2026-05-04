# Your Copilot Studio agent, properly inside Microsoft 365 Copilot

> *Markdown that renders. Adaptive Cards with images, tables, and forms. Submit buttons that actually post back. A "fullscreen analyst canvas" with Copy and Print to PDF. All from your existing CS agent — no rewrites.*

If you've tried to surface a Copilot Studio agent inside Microsoft 365 Copilot, you know the shape of the problem:

- The native CS channel renders plain text. No branding. No real custom UI.
- Building a custom widget via Declarative Agent + RemoteMCPServer + MCP Apps is the right answer — but the path is long, undocumented in places, and littered with subtle traps. (Wrong MIME types, sandbox CSP gotchas, conversation-id discipline.)
- And once you do get a widget rendering, basic things like "show an Adaptive Card from the topic", "render markdown tables", or "run a multi-step form" don't work out of the box.

We've spent a few weeks taking that path end-to-end on behalf of every CS maker who would otherwise hit the same walls. The result is a fork-ready reference implementation that delivers the parity I think most teams actually need:

✅ Markdown reply rendering (proper headings, lists, **tables**, code, links — no more raw markdown bleeding through)
✅ Adaptive Cards from any CS topic, rendered natively
✅ Adaptive Card forms with `Input.Text`, `ChoiceSet`, `Date`, `Number`, `Toggle` + `Action.Submit`
✅ Suggested actions / quick replies as buttons under the reply
✅ A "fullscreen analyst canvas" with sticky header, conversation chip, Copy / Print / Save-as-PDF, keyboard shortcuts
✅ Conversation continuity that maps to the M365 Copilot chat thread (not "all of your CS conversations glued together")
✅ Entra SSO + OBO so the user is never prompted to sign in
✅ A 32-row capability matrix tracking what works vs. what's blocked at the platform layer

The repo is [github.com/microsoft/MCSMCPapps](https://github.com/microsoft/MCSMCPapps) (or wherever you've forked it). Quickstart in [docs/QUICK-START.md](https://github.com/microsoft/MCSMCPapps/blob/main/docs/QUICK-START.md): six maker variables, one `azd up`, one `teamsapp publish`, fork-to-running in under an hour.

## What you give up

We're honest about the gaps in [docs/CS-PARITY.md](https://github.com/microsoft/MCSMCPapps/blob/main/docs/CS-PARITY.md). The big ones, all platform issues we've filed as feature requests:

- **No file upload** from the widget. The skybridge sandbox doesn't expose a host file picker primitive yet. Claim-intake style scenarios where the user uploads a photo currently stay in standalone CS surfaces.
- **No streaming partial replies.** The MCP `tools/call` is a single round-trip; the host LLM holds the user while the widget waits. Long generative answers feel slower than in standalone CS.
- **The host LLM still narrates after every tool call.** Declarative agents lack the per-tool "respond after" toggle that CS makers take for granted. We mitigate with empty `content[0].text` + tightened DA instructions; you'll see ~70-80% silence, not 100%.
- **Two LLM passes per turn.** Pre-tool routing + post-tool narration. Both are unnecessary for an "app mode" agent. We've filed FR 2.8 ("let an MCP App run as an actual app, not as a tool the LLM may call") with concrete API shape proposals.

These aren't reasons to not ship. They're reasons to know what you're choosing.

## What this means for customers

The same CS agent that powers your contact center webchat or your Power Apps embed now appears in M365 Copilot with the rendering and the chrome you actually want. Topics, knowledge, agent flow, Dataverse logging — all unchanged. Hand-off to D365 Omnichannel (next milestone) — same pattern as everywhere else.

Customers can adopt M365 Copilot as a delivery channel for CS-built agents *now*, without:
- Rewriting the agent
- Fighting the host LLM into silence with prompt magic
- Building each rich UI feature from scratch

## What this means for Microsoft

Each gap in the parity matrix is one less thing partners can ship to enterprise customers. We've documented every one as a concrete feature request with API shape proposals. The high-leverage asks are FR 2.7 (silent dispatcher), FR 2.8 (app mode), and FR 6.2 (file upload primitive). Each unblocks multiple matrix rows; together they'd close ~80% of the workaround surface this repo currently carries.

## Try it

```pwsh
gh repo fork microsoft/MCSMCPapps --clone
cd MCSMCPapps
./scripts/swap-brand.ps1 -CsEnvId <yours> -CsSchema <yours> -TenantId <yours> -AgentName "Your Analyst" -AccentColor "#003399" -LogoText "Y"
azd up
cd declarative-agent
npx -y -p '@microsoft/teamsapp-cli@3.1.1' teamsapp publish --env dev
```

Then approve the agent in Microsoft 365 admin center → All agents → Requests, and you're live.

## Status & next

- ✅ v0.7.0 — Adaptive Cards static + Markdown + fullscreen canvas
- ✅ v0.7.1 — Adaptive Card Submit + form inputs (slot filling works)
- ✅ v0.7.2 — Suggested actions / quick replies
- 🔄 v0.7.3 — Hand-off to live agent (D365 Omnichannel)
- 🔜 v0.8 — File downloads, voice gaps documented

The roadmap and the platform asks are public. PRs and issues welcome.
