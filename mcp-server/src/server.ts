/**
 * `McpServer` factory.
 *
 * Builds a fresh `McpServer` per session and wires up the tools and
 * resources. Adding a new tool / resource = add a registration call here
 * plus a sibling file under `tools/` or `resources/`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from './config.js';
import { registerChatWidgetResource } from './resources/chatWidget.js';
import { registerOpenCopilotStudioChatTool } from './tools/openCopilotStudioChat.js';
import { registerSubmitAdaptiveCardActionTool } from './tools/submitAdaptiveCardAction.js';

/** Server name + version advertised in `initialize` responses. */
export const SERVER_NAME = 'mcsmcpapps';
export const SERVER_VERSION = '0.3.0';

/** Server-level instructions surfaced to the host model on `initialize`. */
const SERVER_INSTRUCTIONS =
  'Single-purpose MCP server. Call openCopilotStudioChat to render the ' +
  'embedded Copilot Studio chat surface. Always pass userQuery so the chat ' +
  'can answer immediately without waiting for the user to retype.';

/**
 * Create an `McpServer` configured for a single session.
 *
 * The server has no shared state — each session builds its own. This keeps
 * sessions isolated and lets the HTTP host close them independently.
 */
export function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS
    }
  );

  registerOpenCopilotStudioChatTool(server, config);
  registerSubmitAdaptiveCardActionTool(server, config);
  registerChatWidgetResource(server, config);

  return server;
}
