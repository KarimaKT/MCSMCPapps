/**
 * Tool: `openCopilotStudioChat`
 *
 * Single tool exposed by this MCP server. The DA's host model calls this
 * tool to mount the Copilot Studio chat widget inside Microsoft 365 Copilot.
 *
 * # Contract
 *
 * Verified against Microsoft's official reference samples at
 * github.com/microsoft/mcp-interactiveUI-samples (oai-apps-sdk path).
 *
 * The `_meta` block on BOTH the descriptor and the response contains the
 * OpenAI Apps SDK keys that M365 Copilot's RemoteMCPServer client reads
 * today, plus the MCP Apps spec keys for forward compatibility:
 *
 *   - `openai/outputTemplate` — URI of the resource to render
 *   - `openai/widgetAccessible: true` — required to mount the widget
 *   - `openai/toolInvocation/invoking` — status while running
 *   - `openai/toolInvocation/invoked` — status when done
 *   - `ui.resourceUri` — MCP Apps spec name (forward compat)
 *
 * # Inputs
 *
 *   - `userQuery` (optional string): the user's verbatim message that
 *     triggered the tool call. The widget reads this off the host bridge
 *     (`window.openai.toolInput`) and auto-sends it as the user's first
 *     CS message, so the user never has to retype.
 *
 * # Adding more tools
 *
 * Create a sibling file under `mcp-server/src/tools/`, register it from
 * `server.ts`. Each tool is independent.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ServerConfig } from '../config.js';
import { UI_RESOURCE_URI } from '../resources/chatWidget.js';

/**
 * Build the `_meta` block shared between the tool descriptor and every
 * tool response. Microsoft's reference uses one helper to keep these in
 * sync; we follow the same pattern.
 */
export function buildToolMeta(
  config: ServerConfig
): Record<string, unknown> {
  return {
    'openai/outputTemplate': UI_RESOURCE_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': `Opening ${config.agentName}\u2026`,
    'openai/toolInvocation/invoked': `${config.agentName} ready.`,
    ui: {
      resourceUri: UI_RESOURCE_URI,
      preferredDisplayMode: 'inline'
    }
  };
}

export function registerOpenCopilotStudioChatTool(
  server: McpServer,
  config: ServerConfig
): void {
  const meta = buildToolMeta(config);

  server.registerTool(
    'openCopilotStudioChat',
    {
      title: config.agentName,
      description:
        `Open the embedded ${config.agentName} chat. ` +
        'IMPORTANT: pass the user\u2019s exact question as `userQuery` ' +
        'so the chat can start answering immediately. The chat surface ' +
        'inside the widget owns the conversation; you must not summarize ' +
        'or paraphrase its output.',
      inputSchema: {
        userQuery: z
          .string()
          .optional()
          .describe(
            'The user\u2019s exact text. Pass verbatim; the embedded ' +
              'chat will treat it as the first user message.'
          )
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        title: config.agentName
      },
      _meta: meta
    },
    async (args) => {
      const userQuery =
        typeof args?.userQuery === 'string' ? args.userQuery : '';
      return {
        content: [
          {
            type: 'text',
            text:
              `Embedded chat opened. The widget will handle: ` +
              `\"${userQuery.slice(0, 200)}\"`
          }
        ],
        // structuredContent surfaces userQuery to the widget via
        // `window.openai.toolOutput` and JSON-RPC `ui/notifications/tool-result`.
        structuredContent: { userQuery },
        // _meta on the response tells the host which template to mount
        // for THIS specific call (Microsoft's reference re-emits the same
        // openai/* keys that appear on the descriptor).
        _meta: {
          ...meta,
          // Project-specific namespace for any extra widget state.
          mcsmcpapps: { userQuery }
        }
      };
    }
  );
}
