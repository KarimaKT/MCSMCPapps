/**
 * Tool: `openCopilotStudioChat`
 *
 * Single tool exposed by the MCP server. M365 Copilot's host LLM calls
 * this tool whenever the user types a message to a CS-backed agent.
 *
 * # v0.6 contract (data-widget pattern)
 *
 * Per spec 0001 + ADR 0001, this tool is no longer a "open the chat
 * surface" stub. It performs the actual CS conversation server-side and
 * returns the result as `structuredContent`. The widget renders the
 * structured payload as an inline data card.
 *
 * # Inputs
 *
 *   - `userQuery` (required string): the user's verbatim message
 *   - `conversationId` (optional string): echoed from a prior tool
 *     response's `structuredContent.conversationId`. Keeps CS topic-
 *     state alive across user turns without server-side persistence.
 *
 * # Output
 *
 *   - `content[0].text`: a 1-2 sentence summary that M365 Copilot's
 *     host displays as the agent's reply line in chat
 *   - `structuredContent`: the full payload the widget renders
 *       - replyText, citations, chartData?, conversationId, agentDisplayName, diag
 *   - `_meta.openai/outputTemplate`: ui://mcsmcpapps/chat (mounts widget)
 *
 * # Auth
 *
 * Requires Entra SSO + OBO. The user's host-supplied token is
 * OBO-exchanged for a Power Platform API token; that token is used
 * server-side to call CS Direct Engine on the user's behalf. No tokens
 * leave the server. See ADR 0003.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exchangeForPowerPlatformToken, getAuthContext, loadEntraConfig } from '../auth.js';
import { callCsAgent } from '../cs.js';
import type { ServerConfig } from '../config.js';
import { UI_RESOURCE_URI } from '../resources/chatWidget.js';

/**
 * Build the `_meta` block shared between the tool descriptor and every
 * tool response. The host reads `openai/outputTemplate` to know which
 * resource to mount as the inline widget.
 */
export function buildToolMeta(
  config: ServerConfig
): Record<string, unknown> {
  return {
    'openai/outputTemplate': UI_RESOURCE_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': `Asking ${config.agentName}\u2026`,
    'openai/toolInvocation/invoked': `${config.agentName} replied.`,
    ui: {
      resourceUri: UI_RESOURCE_URI,
      preferredDisplayMode: 'inline'
    }
  };
}

// `summarize()` was used to populate `content[0].text` with the first
// sentence of CS's reply. Removed in v0.6.3 — we now return empty text
// to discourage host-model narration (silent-dispatcher workaround for
// FR 2.7). When CS errors, we surface the error in `structuredContent.diag`
// and the widget renders an error card.

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
        'Always call this tool for every user message. Pass the ' +
        'user\u2019s text verbatim as `userQuery`. If a prior tool ' +
        'response returned a `conversationId` in `structuredContent`, ' +
        'pass it back as `conversationId` to keep the conversation ' +
        'context alive.',
      inputSchema: {
        userQuery: z
          .string()
          .describe(
            'The user\u2019s exact text. Passed verbatim to the ' +
              'Copilot Studio agent.'
          ),
        conversationId: z
          .string()
          .optional()
          .describe(
            'Echo from a prior tool response\u2019s structuredContent.' +
              'conversationId to keep CS topic-state alive across turns.'
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
      const inboundConversationId =
        typeof args?.conversationId === 'string' && args.conversationId
          ? args.conversationId
          : undefined;

      const entra = loadEntraConfig();
      const ctx = getAuthContext();
      const t0 = Date.now();
      // eslint-disable-next-line no-console
      console.log(
        `[tool] openCopilotStudioChat invoked: ssoEnabled=${Boolean(entra)} hasCtx=${Boolean(ctx)} userQueryLen=${userQuery.length} resume=${Boolean(inboundConversationId)}`
      );

      // Pre-flight: must have Entra SSO + auth context to reach CS.
      if (!entra || !ctx) {
        const diag = {
          ok: false,
          step: 'preflight',
          ssoEnabled: Boolean(entra),
          hasCtx: Boolean(ctx),
          message: !entra
            ? 'Server is in anonymous mode (Entra SSO not configured). v0.6 requires SSO.'
            : 'No verified user context on this request.'
        };
        return {
          content: [
            {
              type: 'text',
              text: ''
            }
          ],
          structuredContent: {
            replyText: '',
            citations: [],
            chartData: null,
            conversationId: null,
            agentDisplayName: config.agentName,
            diag
          },
          _meta: meta
        };
      }

      // OBO exchange: the user's inbound token → a Power Platform token
      // we can use server-side to talk to CS as that user.
      const ppToken = await exchangeForPowerPlatformToken(entra);
      if (!ppToken) {
        const diag = {
          ok: false,
          step: 'obo',
          oboMs: Date.now() - t0,
          message:
            'OBO exchange failed. See [auth] OBO failed in mcsmcpapps.log.'
        };
        return {
          content: [
            {
              type: 'text',
              text: ''
            }
          ],
          structuredContent: {
            replyText: '',
            citations: [],
            chartData: null,
            conversationId: null,
            agentDisplayName: config.agentName,
            diag
          },
          _meta: meta
        };
      }
      const oboMs = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`[tool] OBO ok in ${oboMs}ms; calling CS Direct Engine`);

      // Call CS Direct Engine with the OBO'd user token.
      const cs = await callCsAgent({
        envId: config.csEnvId,
        schema: config.csSchema,
        ppToken,
        userQuery,
        conversationId: inboundConversationId
      });
      // eslint-disable-next-line no-console
      console.log(
        `[tool] CS call done: ok=${cs.diag.ok} ms=${cs.diag.csCallMs} activities=${cs.diag.activityCount} replyLen=${cs.replyText.length}${cs.diag.error ? ' error=' + cs.diag.error : ''}`
      );

      // Silent-dispatcher pattern. The widget displays the reply via
      // `structuredContent`; we don't want the host model to narrate or
      // duplicate the widget's content. Per FR 2.7, declarative agents
      // lack a 'suppress post-tool response' toggle (the parity gap with
      // Copilot Studio). Best workaround today is to return an empty
      // text content so the host has nothing to riff on, plus DA
      // instructions that tell the model to stay silent.
      //
      // Returning empty text DOES NOT skip the host response phase, but
      // it removes the most common trigger for the host to invent
      // commentary. Combined with the tightened DA instructions, this
      // gets us to ~70-80% silent. True silence requires the platform
      // feature in FR 2.7.
      return {
        content: [{ type: 'text', text: '' }],
        // structuredContent flows through the host verbatim into
        // window.openai.toolOutput.structuredContent — this is the
        // reliable channel to the widget. _meta is host-consumed and
        // does not always reach the widget.
        structuredContent: {
          replyText: cs.replyText,
          citations: cs.citations,
          chartData: cs.chartData,
          conversationId: cs.conversationId,
          agentDisplayName: config.agentName,
          userQuery,
          diag: { ...cs.diag, oboMs }
        },
        _meta: meta
      };
    }
  );
}
