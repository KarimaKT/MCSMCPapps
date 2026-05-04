/**
 * Tool: `submitAdaptiveCardAction`
 *
 * Posts an Adaptive Card form submit back to the live CS conversation,
 * so CS topics that wait on a card response can resume slot-filling.
 *
 * # Why a separate tool
 *
 * `openCopilotStudioChat` accepts `userQuery` (a string) and treats every
 * call as a typed message. CS topics that emit a card with `Input.Text`,
 * `Input.ChoiceSet`, etc., expect the user's response on
 * `activity.value` (a structured object), NOT on `activity.text`. A
 * separate tool keeps the contracts unambiguous: the host LLM picks
 * `openCopilotStudioChat` for free-form messages, the widget calls
 * `submitAdaptiveCardAction` directly when the user clicks a Submit
 * button.
 *
 * # Inputs
 *
 *   - `conversationId` (required): the live CS conversation that emitted
 *     the card. Must be the value from the prior tool response's
 *     `structuredContent.conversationId`. Wrong / stale id ⇒ CS opens
 *     a fresh conversation, slot-filling state is lost, the form does
 *     nothing useful (we surface that as an error in `diag`).
 *   - `value` (required): the form input map collected by the
 *     Adaptive Cards renderer's `getAllInputs()`. Verbatim.
 *   - `actionTitle` (optional): the Submit button's title. Used only
 *     for transcript readability (`activity.text = actionTitle`).
 *   - `actionData` (optional): the Submit action's `data` field, merged
 *     into `value` before posting (CS topics commonly check `data.id`).
 *
 * # Output
 *
 * Same shape as `openCopilotStudioChat`. The widget re-renders with
 * the `structuredContent` from CS's reply.
 *
 * # Auth
 *
 * Same as `openCopilotStudioChat`: Entra SSO + OBO. Uses the same
 * server-side PP token cache.
 *
 * # FR linkage
 *
 *   - Closes [docs/CS-PARITY.md](../../../docs/CS-PARITY.md) rows
 *     10, 11, 12, 13 (AC Submit + form inputs).
 *   - Workaround for [FR 2.10](../../../docs/FEATURE-REQUESTS.md):
 *     ideally the host would expose a direct widget→agent activity
 *     channel that bypasses LLM passes; until then, every form click
 *     pays ~1.5–3s of host LLM overhead.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exchangeForPowerPlatformToken, getAuthContext, loadEntraConfig } from '../auth.js';
import { callCsAgent } from '../cs.js';
import type { ServerConfig } from '../config.js';
import { UI_RESOURCE_URI } from '../resources/chatWidget.js';
import { getCachedPpToken, setCachedPpToken } from '../caches.js';

function meta(config: ServerConfig): Record<string, unknown> {
  return {
    'openai/outputTemplate': UI_RESOURCE_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': `Submitting to ${config.agentName}\u2026`,
    'openai/toolInvocation/invoked': `${config.agentName} replied.`,
    ui: {
      resourceUri: UI_RESOURCE_URI,
      preferredDisplayMode: 'inline'
    }
  };
}

export function registerSubmitAdaptiveCardActionTool(
  server: McpServer,
  config: ServerConfig
): void {
  const m = meta(config);

  server.registerTool(
    'submitAdaptiveCardAction',
    {
      title: `${config.agentName} card submit`,
      description:
        'Posts an Adaptive Card form submit back to the live ' +
        `${config.agentName} conversation. Call this when the widget ` +
        'reports the user clicked an Action.Submit button on a card. ' +
        'Always include `conversationId` from the prior tool response, ' +
        'and `value` from the renderer\u2019s collected input map. The ' +
        'agent\u2019s reply is rendered by the same widget.',
      inputSchema: {
        conversationId: z
          .string()
          .min(1)
          .describe(
            'REQUIRED. The CS conversation id that emitted the card. ' +
              'Must match `structuredContent.conversationId` from the ' +
              'prior response. Mismatched id discards topic state.'
          ),
        value: z
          .record(z.unknown())
          .describe(
            'Form input values, keyed by Adaptive Card input id. ' +
              'Verbatim from the renderer\u2019s getAllInputs().'
          ),
        actionTitle: z
          .string()
          .optional()
          .describe(
            'The clicked Submit action\u2019s title. Recorded in the ' +
              'CS transcript as `activity.text`; not used for routing.'
          ),
        actionData: z
          .record(z.unknown())
          .optional()
          .describe(
            'Optional Action.Submit `data` payload. Merged into `value` ' +
              'before posting (some CS topics check `data.id` to route).'
          )
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        title: `${config.agentName} card submit`
      },
      _meta: m
    },
    async (args) => {
      const conversationId =
        typeof args?.conversationId === 'string' ? args.conversationId : '';
      const value =
        args?.value && typeof args.value === 'object'
          ? (args.value as Record<string, unknown>)
          : {};
      const actionTitle =
        typeof args?.actionTitle === 'string' ? args.actionTitle : '';
      const actionData =
        args?.actionData && typeof args.actionData === 'object'
          ? (args.actionData as Record<string, unknown>)
          : {};

      const entra = loadEntraConfig();
      const ctx = getAuthContext();
      const t0 = Date.now();
      const oid =
        ctx && typeof ctx.claims.oid === 'string' ? ctx.claims.oid : null;

      // eslint-disable-next-line no-console
      console.log(
        `[tool] submitAdaptiveCardAction invoked: ssoEnabled=${Boolean(entra)} hasCtx=${Boolean(ctx)} convId=${conversationId.slice(0, 8) || 'none'} valueKeys=${Object.keys(value).length}`
      );

      if (!entra || !ctx) {
        return {
          content: [{ type: 'text', text: '' }],
          structuredContent: {
            replyText: '',
            citations: [],
            chartData: null,
            adaptiveCards: [],
            suggestedActions: [],
            conversationId: conversationId || null,
            agentDisplayName: config.agentName,
            diag: {
              ok: false,
              step: 'preflight',
              message: !entra
                ? 'Server is in anonymous mode (Entra SSO not configured).'
                : 'No verified user context on this request.'
            }
          },
          _meta: m
        };
      }

      if (!conversationId) {
        return {
          content: [{ type: 'text', text: '' }],
          structuredContent: {
            replyText: '',
            citations: [],
            chartData: null,
            adaptiveCards: [],
            suggestedActions: [],
            conversationId: null,
            agentDisplayName: config.agentName,
            diag: {
              ok: false,
              step: 'preflight',
              message:
                'submitAdaptiveCardAction requires conversationId. Open a conversation first via openCopilotStudioChat.'
            }
          },
          _meta: m
        };
      }

      // PP token via cache (same as openCopilotStudioChat).
      let ppToken: string;
      let oboCacheHit = false;
      const oboT0 = Date.now();
      const cached = oid ? getCachedPpToken(oid) : null;
      if (cached) {
        ppToken = cached.token;
        oboCacheHit = true;
      } else {
        const obo = await exchangeForPowerPlatformToken(entra);
        if (!obo) {
          return {
            content: [{ type: 'text', text: '' }],
            structuredContent: {
              replyText: '',
              citations: [],
              chartData: null,
              adaptiveCards: [],
              conversationId,
              agentDisplayName: config.agentName,
              diag: {
                ok: false,
                step: 'obo',
                oboMs: Date.now() - t0,
                message: 'OBO exchange failed.'
              }
            },
            _meta: m
          };
        }
        ppToken = obo.token;
        if (oid) setCachedPpToken(oid, obo.token, obo.expiresInSec);
      }
      const oboMs = Date.now() - oboT0;

      const cs = await callCsAgent({
        envId: config.csEnvId,
        schema: config.csSchema,
        ppToken,
        userQuery: actionTitle, // recorded as transcript text
        conversationId,
        submitValue: { ...value, ...actionData }
      });

      // eslint-disable-next-line no-console
      console.log(
        `[tool] submitAdaptiveCardAction CS done: ok=${cs.diag.ok} ms=${cs.diag.csCallMs} acCount=${cs.diag.adaptiveCardCount} replyLen=${cs.replyText.length}${cs.diag.error ? ' error=' + cs.diag.error : ''}`
      );

      return {
        content: [{ type: 'text', text: '' }],
        structuredContent: {
          replyText: cs.replyText,
          citations: cs.citations,
          chartData: cs.chartData,
          adaptiveCards: cs.adaptiveCards,
          suggestedActions: cs.suggestedActions,
          escalation: cs.escalation,
          conversationId: cs.conversationId,
          agentDisplayName: config.agentName,
          submittedAction: { title: actionTitle, value, data: actionData },
          diag: {
            ...cs.diag,
            oboMs,
            oboCacheHit,
            totalMs: Date.now() - t0
          }
        },
        _meta: m
      };
    }
  );
}
