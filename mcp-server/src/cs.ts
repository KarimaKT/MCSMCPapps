/**
 * Copilot Studio Direct Engine call from Node (server-side).
 *
 * Used by the `openCopilotStudioChat` tool to:
 *   1. Open (or resume) a CS conversation using the OBO'd Power Platform
 *      token of the actual user
 *   2. Send the user's question
 *   3. Drain the streaming activity response to completion
 *   4. Collect: full reply text, citations, optional chart payload
 *   5. Return as a synchronous structured response to the tool caller
 *
 * # Why server-side and not browser-side
 *
 * Per ADR 0001, the M365 Copilot widget surface is a data-display card,
 * not a chat surface. The widget receives `structuredContent` from the
 * tool response and renders it; it does not maintain a CS conversation.
 * This keeps the widget bundle tiny and avoids MSAL inside the skybridge
 * sandbox (which can never succeed — see ADR 0001).
 *
 * # Conversation continuity
 *
 * Each tool call returns the CS `conversationId` in `structuredContent`.
 * The host echoes it on subsequent tool calls via the `conversationId`
 * field of the tool's `inputSchema`. That keeps CS topic-state alive
 * across user turns without our infra storing anything.
 *
 * # Drain timeout
 *
 * If CS streams for >10 seconds, we cut off and return what we have.
 * Mark `diag.timedOut = true` so the caller / widget can show a hint.
 */

import {
  CopilotStudioClient,
  PowerPlatformCloud,
  type ConnectionSettings
} from '@microsoft/agents-copilotstudio-client';

/** Activity-shape we care about (a thin slice of the BotFramework Activity). */
interface CsActivity {
  type?: string;
  text?: string;
  attachments?: Array<{
    contentType?: string;
    content?: unknown;
    contentUrl?: string;
    name?: string;
  }>;
  entities?: Array<{
    type?: string;
    [key: string]: unknown;
  }>;
  conversation?: { id?: string };
}

export interface CallCsAgentParams {
  /** Power Platform environment GUID (e.g. `61453fde-...`). */
  envId: string;
  /** Agent schema name (e.g. `ksteam_ak001`). */
  schema: string;
  /** OBO'd Power Platform API access token (Bearer). */
  ppToken: string;
  /** User's question, passed verbatim. */
  userQuery: string;
  /**
   * Optional CS conversation id from a previous tool call.
   * Echo this from `structuredContent.conversationId` of the prior call
   * to keep CS topic-state alive across user turns.
   */
  conversationId?: string;
  /** Power Platform cloud. Defaults to Prod. */
  cloud?: PowerPlatformCloud;
  /** Drain timeout in ms. Default 10_000. */
  timeoutMs?: number;
}

export interface Citation {
  title: string;
  url: string;
}

/**
 * Optional chart payload. CS can emit these via Power Automate as
 * adaptive cards or custom attachments. We extract a normalized shape
 * so the widget renders consistently.
 */
export interface ChartData {
  kind: 'stat' | 'compare' | 'trend';
  title?: string;
  primaryValue?: string;
  deltaText?: string;
  series?: Array<{ label?: string; value: number }>;
}

export interface CallCsAgentResult {
  /** Full reply text (markdown supported). */
  replyText: string;
  /** Citations extracted from activity entities + attachments. */
  citations: Citation[];
  /** Normalized chart payload, if CS sent one. */
  chartData: ChartData | null;
  /** CS conversation id. Echo to next tool call to maintain context. */
  conversationId: string | null;
  /** Diagnostic counters. Surfaced in tool response for in-widget debug. */
  diag: {
    /** Wall-clock duration of the CS call in ms. */
    csCallMs: number;
    /** Number of activities received from CS. */
    activityCount: number;
    /** True if we cut off the stream at `timeoutMs`. */
    timedOut: boolean;
    /** True if CS responded successfully. */
    ok: boolean;
    /** Error message if `ok` is false. */
    error?: string;
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Drain an async iterable while a `keepGoing()` predicate returns true,
 * with an overall hard timeout. Yields each value until either:
 *   - the iterable ends naturally
 *   - `keepGoing()` returns false after at least one value
 *   - the hard timeout fires
 *
 * The hard timeout is a backstop. The expected exit is `keepGoing` going
 * false (e.g. "we have what we need").
 */
async function* drainWhile<T>(
  source: AsyncIterable<T>,
  hardTimeoutMs: number,
  keepGoing: () => boolean,
  onTimeout: () => void
): AsyncIterable<T> {
  const iter = source[Symbol.asyncIterator]();
  const start = Date.now();
  while (true) {
    if (!keepGoing()) return;
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

/**
 * Extract citations from an activity. Looks at:
 *   - `entities[*]` of type `https://schema.org/Claim`
 *   - `attachments[*]` with content URLs (best-effort)
 */
function extractCitations(activity: CsActivity, into: Citation[]): void {
  const ents = activity.entities ?? [];
  for (const e of ents) {
    if (
      e &&
      typeof e === 'object' &&
      typeof (e as Record<string, unknown>)['@type'] === 'string' &&
      ((e as Record<string, unknown>)['@type'] as string).includes('Claim')
    ) {
      const url = (e as Record<string, unknown>).url ?? (e as Record<string, unknown>).appearance;
      const title = (e as Record<string, unknown>).name ?? 'Source';
      if (typeof url === 'string') {
        into.push({ title: typeof title === 'string' ? title : 'Source', url });
      }
    }
  }
  const atts = activity.attachments ?? [];
  for (const a of atts) {
    if (a?.contentUrl && typeof a.contentUrl === 'string' && a.contentUrl.startsWith('http')) {
      into.push({ title: a.name ?? 'Attachment', url: a.contentUrl });
    }
  }
}

/**
 * Extract a chart payload if CS sent one.
 *
 * Convention: CS emits an attachment with
 * `contentType: 'application/vnd.mcsmcpapps.chart+json'` containing a
 * `ChartData` object. CS makers wire this from a Power Automate flow
 * that calls Eurostat / their data source and packages the result.
 */
function extractChart(activity: CsActivity): ChartData | null {
  const atts = activity.attachments ?? [];
  for (const a of atts) {
    if (a?.contentType === 'application/vnd.mcsmcpapps.chart+json' && a.content) {
      const c = a.content as Partial<ChartData>;
      if (c.kind === 'stat' || c.kind === 'compare' || c.kind === 'trend') {
        return {
          kind: c.kind,
          title: typeof c.title === 'string' ? c.title : undefined,
          primaryValue: typeof c.primaryValue === 'string' ? c.primaryValue : undefined,
          deltaText: typeof c.deltaText === 'string' ? c.deltaText : undefined,
          series: Array.isArray(c.series) ? c.series : undefined
        };
      }
    }
  }
  return null;
}

/**
 * Call the CS agent and return a structured result. Never throws — all
 * errors are captured in `diag.error` and `diag.ok = false` so the
 * caller can surface them in the widget.
 */
export async function callCsAgent(
  params: CallCsAgentParams
): Promise<CallCsAgentResult> {
  const start = Date.now();
  const result: CallCsAgentResult = {
    replyText: '',
    citations: [],
    chartData: null,
    conversationId: params.conversationId ?? null,
    diag: { csCallMs: 0, activityCount: 0, timedOut: false, ok: false }
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

    const replyParts: string[] = [];
    let lastBotMessageAt = 0;
    const handleActivity = (a: CsActivity): void => {
      result.diag.activityCount += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[cs] activity #${result.diag.activityCount} type=${a.type ?? '?'} textLen=${typeof a.text === 'string' ? a.text.length : 0}${a.conversation?.id ? ' convId=' + String(a.conversation.id).slice(0, 8) : ''}`
      );
      if (a.conversation?.id) result.conversationId = a.conversation.id;
      if (a.type === 'message' && typeof a.text === 'string' && a.text.trim()) {
        replyParts.push(a.text);
        lastBotMessageAt = Date.now();
      }
      extractCitations(a, result.citations);
      const chart = extractChart(a);
      if (chart) result.chartData = chart;
    };

    const hardTimeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startConversationCapMs = 3000; // we only need the conversation id
    const idleAfterReplyMs = 800; // wait this long for follow-on chunks

    let opened = false;
    if (!params.conversationId) {
      // Brand-new conversation: drain the start stream just long enough
      // to get the conversation id. Bot greeting (if any) is captured
      // but we don't wait for it — that's not the user's question yet.
      const startedAt = Date.now();
      const stream = client.startConversationStreaming() as AsyncIterable<CsActivity>;
      for await (const activity of drainWhile(
        stream,
        startConversationCapMs,
        () => !result.conversationId, // exit as soon as we have a conv id
        () => {
          // start-stream timeout is informational only; not fatal here
          // eslint-disable-next-line no-console
          console.log('[cs] startConversationStreaming cap hit (informational)');
        }
      )) {
        handleActivity(activity);
      }
      // eslint-disable-next-line no-console
      console.log(
        `[cs] start stream done in ${Date.now() - startedAt}ms; convId=${result.conversationId ? String(result.conversationId).slice(0, 12) + '...' : 'none'}`
      );
      opened = true;
      if (!result.conversationId) {
        result.diag.csCallMs = Date.now() - start;
        result.diag.ok = false;
        result.diag.error = 'CS did not return a conversation id';
        return result;
      }
    }

    // Send the user's activity and drain until we have a bot reply
    // (type=message with text) and then wait `idleAfterReplyMs` for any
    // follow-on chunks. Hard timeout backstops at hardTimeoutMs total.
    const sendStartedAt = Date.now();
    const userActivity = {
      type: 'message',
      from: { id: 'user', role: 'user' },
      text: params.userQuery,
      ...(result.conversationId
        ? { conversation: { id: result.conversationId } }
        : {})
    };
    const sendStream = client.sendActivityStreaming(
      userActivity as never,
      result.conversationId ?? undefined
    ) as AsyncIterable<CsActivity>;
    for await (const activity of drainWhile(
      sendStream,
      Math.max(2000, hardTimeoutMs - (Date.now() - start)),
      () => {
        // Keep going if we haven't seen any bot reply yet, OR if we've
        // seen one within the last idle window (more chunks may stream).
        if (lastBotMessageAt === 0) return true;
        return Date.now() - lastBotMessageAt < idleAfterReplyMs;
      },
      () => {
        result.diag.timedOut = true;
      }
    )) {
      handleActivity(activity);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[cs] send stream done in ${Date.now() - sendStartedAt}ms; replyChunks=${replyParts.length} timedOut=${result.diag.timedOut}`
    );

    result.replyText = replyParts.join('\n').trim();
    result.diag.csCallMs = Date.now() - start;
    result.diag.ok = result.replyText.length > 0;
    if (!result.diag.ok && !result.diag.error) {
      result.diag.error = result.diag.timedOut
        ? 'CS stream timed out before any bot reply'
        : opened
          ? 'CS returned no reply text'
          : 'CS sendActivity returned no reply text';
    }
    return result;
  } catch (err) {
    result.diag.csCallMs = Date.now() - start;
    result.diag.ok = false;
    result.diag.error = (err as Error)?.message ?? String(err);
    return result;
  }
}
