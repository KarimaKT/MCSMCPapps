# MCP App tool

The MCP server tool that returns the `mcp_app` payload pointing at the hosted WebChat UI. The Declarative Agent's only job is to call this tool.

🚧 **Phase 5 — not yet scaffolded.** See [../docs/BUILD-GUIDE.md §6](../docs/BUILD-GUIDE.md#6-build-the-declarative-agent--mcp-app).

Will contain:

- `openCopilotStudioChat.json` — tool definition / payload template
- `server/index.ts` — minimal `@modelcontextprotocol/sdk` server registering the single tool
- `server/package.json`
