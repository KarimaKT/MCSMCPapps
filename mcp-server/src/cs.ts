/**
 * Copilot Studio Direct Engine call from Node (server-side).
 *
 * This module follows the canonical pattern in Microsoft's official
 * sample: github.com/microsoft/Agents/blob/main/samples/nodejs/
 * copilotstudio-client/src/index.ts
 *
 * Key insights from the sample (we got these wrong on first pass):
 *   - CS Direct Engine streams emit an explicit
 *     `ActivityTypes.EndOfConversation` activity at end of turn.
 *     That's the documented exit signal for a streaming loop, not
 *     "stream closed" and not "idle for N ms."
 *   - The streams end naturally per turn. No artificial timeouts
 *     needed in normal operation.
 *   - `startConversationStreaming(true)` passes `emitStartConversationEvent`.
 *
 * Used by the `openCopilotStudioChat` tool to:
 *   1. Open (or resume) a CS conversation using the OBO'd PP token
 *   2. Send the user's question
 *   3. Iterate the streaming reply until EndOfConversation
 *   4. Collect: full reply text, citations, optional chart payload
 *   5. Return as a synchronous structured response
 *
 * # Why server-side
 *
 * Per ADR 0001, the M365 Copilot widget is a data-display card, not a
 * chat surface. The widget receives `structuredContent` from the tool
 * response and renders it; it does not maintain a CS conversation.
 *
 * # Conversation continuity
 *
 * Each tool call returns the CS `conversationId`. The host echoes it
 * on subsequent tool calls via the tool's `inputSchema.conversationId`,
 * keeping CS topic-state alive without our infra storing anything.
 */

import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import {
  CopilotStudioClient,
  PowerPlatformCloud,
  type ConnectionSettings
} from '@microsoft/agents-copilotstudio-client';

export interface CallCsAgentParams {
  /** Power Platform environment GUID. */
  envId: string;
  /** Agent schema name (e.g. `ksteam_ak001`). */
  schema: string;
  /** OBO'd Power Platform API access token (Bearer). */
  ppToken: string;
  /** User's question, passed verbatim. */
  userQuery: string;
  /**
   * Optional CS conversation id from a prior tool call. Echo this from
   * `structuredContent.conversationId` to keep CS topic-state alive
   * across user turns.
   */
  conversationId?: string;
  /** Power Platform cloud. Defaults to Prod. */
  cloud?: PowerPlatformCloud;
  /**
   * Hard cap on the entire CS interaction (open + send + drain). Backstop
   * only — normal turns end via EndOfConversation in <5s. Default 30s.
   */
  hardTimeoutMs?: number;
}

export interface Citation {
  title: string;
  url: string;
}

export interface ChartData {
  kind: 'stat' | 'compare' | 'trend';
  title?: string;
  primaryValue?: string;
  deltaText?: string;
  series?: Array<{ label?: string; value: number }>;
}

export interface CallCsAgentResult {
  replyText: string;
  citations: Citation[];
  chartData: ChartData | null;
  conversationId: string | null;
  diag: {
    csCallMs: number;
    activityCount: number;
    timedOut: boolean;
    sawEndOfConversation: boolean;
    ok: boolean;
    error?: string;
  };
}

const DEFAULT_HARD_TIMEOUT_MS = 30_000;

/**
 * Wrap an async iterable with a hard total-time timeout. Backstop only.
 * Yields each value until the source ends or the timer fires.
 */
async function* withHardTimeout<T>(
  source: AsyncIterable<T>,
  hardTimeoutMs: number,
  onTimeout: () => void
): AsyncIterable<T> {
  const iter = source[Symbol.asyncIterator]();
  const start = Date.now();
  while (true) {
    const remaining = hardTimeoutMs - (Date.now() - start);
    if (remaining <= 0) {
      onTimeout();
      return;
    }
    const next = iter.next();
    const winner = await Promise.race([
      next,
      new Promise<{ value: undefined; done: true; __timeout: true }>((resolve) =>
        setTimeout(
          () => resolve({ value: undefined, done: true, __timeout: true }),
          remaining
        )
      )
    ]);
    if ((winner as { __timeout?: boolean }).__timeout) {
      onTimeout();
      return;
    }
    if (winner.done) return;
    yield winner.value as T;
  }
}

function extractCitations(activity: Activity, into: Citation[]): void {
  const ents = (activity as unknown as {
    entities?: Array<Record<string, unknown>>;
  }).entities;
  if (!Array.isArray(ents)) return;
  for (const e of ents) {
    if (!e || typeof e !== 'object') continue;
    // Accept both `https://schema.org/Claim` and shorter `Claim`.
    const t = e['@type'] ?? e['type'];
    if (typeof t !== 'string' || !t.toLowerCase().includes('claim')) continue;
    const url = e.url ?? e.appearance;
    const name = e.name ?? 'Source';
    if (typeof url === 'string') {
      into.push({
        title: typeof name === 'string' ? name : 'Source',
        url
      });
    }
  }
}

function extractChart(activity: Activity): ChartData | null {
  const atts = (activity as unknown as {
    attachments?: Array<{
      contentType?: string;
      content?: Partial<ChartData>;
    }>;
  }).attachments;
  if (!Array.isArray(atts)) return null;
  for (const a of atts) {
    if (
      a?.contentType === 'application/vnd.mcsmcpapps.chart+json' &&
      a.content
    ) {
      const c = a.content;
      if (c.kind === 'stat' || c.kind === 'compare' || c.kind === 'trend') {
        return {
          kind: c.kind,
          title: typeof c.title === 'string' ? c.title : undefined,
          primaryValue:
            typeof c.primaryValue === 'string' ? c.primaryValue : undefined,
          deltaText:
            typeof c.deltaText === 'string' ? c.deltaText : undefined,
          series: Array.isArray(c.series) ? c.series : undefined
        };
      }
    }
  }
  return null;
}

/** What we collect per turn. */
interface TurnState {
  replyParts: string[];
  citations: Citation[];
  chart: ChartData | null;
  conversationId: string | null;
  activityCount: number;
  sawEndOfConversation: boolean;
}

/**
 * Iterate a CS streaming reply; collect text + citations + chart and
 * exit on `EndOfConversation`. Per the MS sample, this is the canonical
 * end-of-turn signal.
 */
async function consumeTurn(
  source: AsyncIterable<Activity>,
  state: TurnState,
  hardTimeoutMs: number,
  onTimeout: () => void
): Promise<void> {
  for await (const activity of withHardTimeout(source, hardTimeoutMs, onTimeout)) {
    state.activityCount += 1;
    const a = activity as unknown as {
      type?: string;
      text?: string;
      conversation?: { id?: string };
    };
    // eslint-disable-next-line no-console
    console.log(
      `[cs] activity #${state.activityCount} type=${a.type ?? '?'} textLen=${typeof a.text === 'string' ? a.text.length : 0}${a.conversation?.id ? ' conv=' + String(a.conversation.id).slice(0, 8) : ''}`
    );
    if (a.conversation?.id) state.conversationId = a.conversation.id;

    if (a.type === ActivityTypes.EndOfConversation) {
      state.sawEndOfConversation = true;
      // EndOfConversation activities sometimes carry a final summary
      // text; capture it if so.
      if (typeof a.text === 'string' && a.text.trim()) {
        state.replyParts.push(a.text);
      }
      return; // exit the loop
    }

    if (a.type === ActivityTypes.Message && typeof a.text === 'string' && a.text.trim()) {
      state.replyParts.push(a.text);
    }

    extractCitations(activity, state.citations);
    const chart = extractChart(activity);
    if (chart) state.chart = chart;
  }
}

export async function callCsAgent(
  params: CallCsAgentParams
): Promise<CallCsAgentResult> {
  const start = Date.now();
  const hardTimeoutMs = params.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;

  const result: CallCsAgentResult = {
    replyText: '',
    citations: [],
    chartData: null,
    conversationId: params.conversationId ?? null,
    diag: {
      csCallMs: 0,
      activityCount: 0,
      timedOut: false,
      sawEndOfConversation: false,
      ok: false
    }
  };

  try {
    const settings: ConnectionSettings = {
      environmentId: params.envId,
      schemaName: params.schema,
      cloud: params.cloud ?? PowerPlatformCloud.Prod,
      agentIdentifier: '',
      directConnectUrl: ''
    };
    const client = new CopilotStudioClient(settings, params.ppToken);

    const state: TurnState = {
      replyParts: [],
      citations: result.citations,
      chart: null,
      conversationId: result.conversationId,
      activityCount: 0,
      sawEndOfConversation: false
    };

    // Step 1 — open the CS conversation if we don't already have one.
    //
    // v0.6.3 attempt to skip this entirely failed: the SDK's
    // `sendActivityStreaming` does NOT create a conversation on the
    // fly. Without a prior `startConversationStreaming` call the
    // server returns one ack activity (no bot reply, no
    // EndOfConversation, ~450ms), and `state.replyParts` stays empty.
    //
    // What we DO skip in v0.6.4: we no longer drain step 1 to
    // EndOfConversation. As soon as we capture `conversation.id` from
    // any activity in the start stream, we break out and move on to
    // step 2. The greeting / "On Conversation Start" topic output
    // gets discarded — that's the desired behavior anyway since the
    // user is asking a question, not opening a new chat.
    if (!state.conversationId) {
      const startStartedAt = Date.now();
      // eslint-disable-next-line no-console
      console.log('[cs] startConversationStreaming(true)');
      try {
        const startStream = client.startConversationStreaming(
          true
        ) as AsyncIterable<Activity>;
        const startBudgetMs = Math.max(
          1500,
          Math.min(8000, hardTimeoutMs - (Date.now() - start) - 4000)
        );
        const startDeadline = Date.now() + startBudgetMs;
        for await (const a of startStream) {
          state.activityCount++;
          // eslint-disable-next-line no-console
          console.log(
            `[cs] start activity #${state.activityCount} type=${a?.type} textLen=${a?.text?.length ?? 0} conv=${a?.conversation?.id ? String(a.conversation.id).slice(0, 8) : 'none'}`
          );
          if (a?.conversation?.id && !state.conversationId) {
            state.conversationId = a.conversation.id;
          }
          // Exit as soon as we have a conversation id — we don't
          // need the greeting.
          if (state.conversationId) break;
          if (Date.now() > startDeadline) break;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cs] startConversationStreaming threw', e);
      }
      // eslint-disable-next-line no-console
      console.log(
        `[cs] start done in ${Date.now() - startStartedAt}ms; conv=${state.conversationId ? String(state.conversationId).slice(0, 8) : 'none'}`
      );
    }

    // Step 2 — send the user's activity and consume the streaming
    // reply until EndOfConversation.
    const sendStartedAt = Date.now();
    // eslint-disable-next-line no-console
    console.log(
      `[cs] sendActivityStreaming text="${params.userQuery.slice(0, 80)}${params.userQuery.length > 80 ? '\u2026' : ''}" conv=${state.conversationId ? String(state.conversationId).slice(0, 8) : 'new'}`
    );
    const userActivity = new Activity(ActivityTypes.Message);
    userActivity.text = params.userQuery;
    if (state.conversationId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (userActivity as any).conversation = { id: state.conversationId };
    }

    const sendStream = client.sendActivityStreaming(
      userActivity
    ) as AsyncIterable<Activity>;
    await consumeTurn(
      sendStream,
      state,
      Math.max(2000, hardTimeoutMs - (Date.now() - start)),
      () => {
        result.diag.timedOut = true;
      }
    );
    // eslint-disable-next-line no-console
    console.log(
      `[cs] sendActivity done in ${Date.now() - sendStartedAt}ms; replyChunks=${state.replyParts.length} eoc=${state.sawEndOfConversation} timedOut=${result.diag.timedOut}`
    );

    result.replyText = state.replyParts.join('\n').trim();
    result.chartData = state.chart;
    result.conversationId = state.conversationId;
    result.diag.activityCount = state.activityCount;
    result.diag.sawEndOfConversation = state.sawEndOfConversation;
    result.diag.csCallMs = Date.now() - start;
    result.diag.ok = result.replyText.length > 0;
    if (!result.diag.ok && !result.diag.error) {
      result.diag.error = result.diag.timedOut
        ? 'CS stream timed out before reply'
        : 'CS returned no reply text';
    }
    return result;
  } catch (err) {
    result.diag.csCallMs = Date.now() - start;
    result.diag.ok = false;
    result.diag.error = (err as Error)?.message ?? String(err);
    return result;
  }
}
