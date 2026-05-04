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
import { getCachedPpToken, setCachedPpToken } from '../caches.js';

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
        `Sends the user\u2019s message to the ${config.agentName} ` +
        'Copilot Studio agent and returns the agent\u2019s reply as a ' +
        'rendered widget. Call this for every user turn including the ' +
        'first. **CRITICAL multi-turn rule:** every tool response\u2019s ' +
        '`structuredContent.conversationId` MUST be passed back as the ' +
        '`conversationId` argument on the very next tool call (and on ' +
        'every subsequent call) so the agent keeps topic state, ' +
        'memory, and follow-up context. Do NOT omit `conversationId` ' +
        'on follow-ups \u2014 omitting it starts a brand-new conversation ' +
        'and loses all prior context. Pass `userQuery` exactly as the ' +
        'user typed it, with no summarization, paraphrase, or ' +
        'translation.',
      inputSchema: {
        userQuery: z
          .string()
          .min(1)
          .describe(
            'The user\u2019s exact text. Passed verbatim to the ' +
              'Copilot Studio agent. Do not paraphrase or translate.'
          ),
        conversationId: z
          .string()
          .optional()
          .describe(
            'REQUIRED on every turn after the first. Echo the value ' +
              'of `structuredContent.conversationId` from the prior ' +
              'tool response. Omit only on the very first call of a ' +
              'fresh conversation. Omitting it on follow-ups discards ' +
              'topic state and is almost always wrong.'
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
      // Use the user's Entra `oid` for the PP token cache only. The
      // CS conversation id is NOT cached server-side: we deliberately
      // rely on the host echoing structuredContent.conversationId back
      // as the conversationId argument. That gives us the right
      // session semantics:
      //   - Same M365 Copilot chat thread, follow-up turn:
      //     host has the prior tool output in context → echoes
      //     conversationId → CS conversation continues.
      //   - User starts a NEW chat thread in M365 Copilot:
      //     host has nothing to echo → no conversationId → we open a
      //     fresh CS conversation. This matches user intent: "MCS
      //     sessions should restart whenever the M365 Copilot DA
      //     session restarts."
      // The downside is that if the host model forgets to echo within
      // a single thread (model drift, context truncation), CS topic
      // state is lost mid-thread. The DA instructions hammer this
      // rule hard, but ultimate fix is FR 2.8 (host-managed threadId).
      const oid =
        ctx && typeof ctx.claims.oid === 'string' ? ctx.claims.oid : null;

      const effectiveConvId = inboundConversationId;

      // eslint-disable-next-line no-console
      console.log(
        `[tool] openCopilotStudioChat invoked: ssoEnabled=${Boolean(entra)} hasCtx=${Boolean(ctx)} userQueryLen=${userQuery.length} hostEchoedConv=${Boolean(inboundConversationId)} resume=${Boolean(effectiveConvId)}`
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
      // we can use server-side to talk to CS as that user. Cached per
      // `oid` for the token's lifetime so subsequent turns skip the
      // 100-500ms exchange.
      let ppToken: string;
      let oboCacheHit = false;
      const oboT0 = Date.now();
      const cached = oid ? getCachedPpToken(oid) : null;
      if (cached) {
        ppToken = cached.token;
        oboCacheHit = true;
        // eslint-disable-next-line no-console
        console.log(
          `[tool] PP token cache hit (remaining=${Math.round(cached.remainingMs / 1000)}s)`
        );
      } else {
        const obo = await exchangeForPowerPlatformToken(entra);
        if (!obo) {
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
        ppToken = obo.token;
        if (oid) setCachedPpToken(oid, obo.token, obo.expiresInSec);
      }
      const oboMs = Date.now() - oboT0;
      // eslint-disable-next-line no-console
      console.log(
        `[tool] auth ready in ${oboMs}ms (cacheHit=${oboCacheHit}); calling CS Direct Engine`
      );

      // Call CS Direct Engine with the OBO'd user token.
      const cs = await callCsAgent({
        envId: config.csEnvId,
        schema: config.csSchema,
        ppToken,
        userQuery,
        conversationId: effectiveConvId
      });
      // eslint-disable-next-line no-console
      console.log(
        `[tool] CS call done: ok=${cs.diag.ok} ms=${cs.diag.csCallMs} activities=${cs.diag.activityCount} replyLen=${cs.replyText.length}${cs.diag.error ? ' error=' + cs.diag.error : ''}`
      );

      // No conversation-cache write: see the comment above
      // `effectiveConvId` for why we deliberately do not persist
      // CS conversation ids server-side.

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
          diag: {
            ...cs.diag,
            oboMs,
            oboCacheHit,
            hostEchoedConv: Boolean(inboundConversationId),
            totalMs: Date.now() - t0
          }
        },
        _meta: meta
      };
    }
  );
}
