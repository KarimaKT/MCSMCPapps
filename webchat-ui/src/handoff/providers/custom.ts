/**
 * Generic webhook-based provider — talks to YOUR token broker, which in turn
 * fronts the live-agent platform.
 *
 * Customer wiring: deploy a small server (Azure Function, App Service, or
 * SWA managed function) exposing 3 endpoints and 1 webhook:
 *
 *   POST /api/handoff/start    — receives HandoffContext, returns HandoffSession
 *   POST /api/handoff/message  — receives { sessionId, text }, returns 204
 *   POST /api/handoff/end      — receives { sessionId, reason }, returns 204
 *   GET  /api/handoff/stream?sessionId=...  — Server-Sent Events stream of inbound activities
 *
 * The broker is responsible for:
 *   - Holding live-platform credentials (NEVER in the browser)
 *   - Translating between live-platform schema and HandoffInbound shape
 *   - Routing the live platform's outbound webhooks into the SSE stream for
 *     the right session
 *
 * Replace this provider with a customer-specific one if your live platform
 * exposes a richer client SDK you want to use directly. The orchestrator
 * doesn't care which provider you plug in.
 */

import type {
  HandoffContext,
  HandoffInbound,
  HandoffListener,
  HandoffProvider,
  HandoffSession,
  Unsubscribe
} from '../types';

export interface CustomWebhookProviderConfig {
  /** Base URL of your broker, e.g. https://my-broker.azurewebsites.net (no trailing slash). */
  brokerBaseUrl: string;
  /**
   * Returns a fresh access token for the broker. Typically the same MSAL
   * token your WebChat already acquires for CS — depends on whether your
   * broker accepts the same audience.
   */
  getAccessToken: () => Promise<string>;
  /** Identifier used in diagnostics. Default 'custom-webhook'. */
  id?: string;
  /** Optional override for fetch (testing). */
  fetchImpl?: typeof fetch;
}

export class CustomWebhookProvider implements HandoffProvider {
  readonly id: string;
  private readonly base: string;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CustomWebhookProviderConfig) {
    this.id = config.id ?? 'custom-webhook';
    this.base = config.brokerBaseUrl.replace(/\/+$/, '');
    this.getToken = config.getAccessToken;
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
  }

  async startSession(ctx: HandoffContext): Promise<HandoffSession> {
    const res = await this.post('/api/handoff/start', ctx);
    if (!res.ok) {
      throw new Error(
        `Broker /handoff/start failed: ${res.status} ${res.statusText}`
      );
    }
    const session = (await res.json()) as HandoffSession;
    if (!session?.sessionId) {
      throw new Error('Broker /handoff/start did not return a sessionId.');
    }
    return session;
  }

  async sendUserMessage(sessionId: string, text: string): Promise<void> {
    const res = await this.post('/api/handoff/message', { sessionId, text });
    if (!res.ok && res.status !== 204) {
      throw new Error(
        `Broker /handoff/message failed: ${res.status} ${res.statusText}`
      );
    }
  }

  async endSession(sessionId: string, reason?: string): Promise<void> {
    const res = await this.post('/api/handoff/end', { sessionId, reason });
    if (!res.ok && res.status !== 204) {
      throw new Error(
        `Broker /handoff/end failed: ${res.status} ${res.statusText}`
      );
    }
  }

  subscribe(sessionId: string, listener: HandoffListener): Unsubscribe {
    // Build URL with ?sessionId. The broker uses the bearer token to authorize
    // the SSE; EventSource doesn't support custom headers natively, so most
    // brokers accept a short-lived token via query string AND validate it.
    let unsubscribed = false;
    let source: EventSource | null = null;

    void this.getToken().then((token) => {
      if (unsubscribed) return;
      const url = `${this.base}/api/handoff/stream?sessionId=${encodeURIComponent(
        sessionId
      )}&access_token=${encodeURIComponent(token)}`;
      source = new EventSource(url);
      source.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as HandoffInbound;
          listener(event);
        } catch {
          listener({ kind: 'error', message: 'Bad inbound payload from broker.' });
        }
      };
      source.onerror = () => {
        listener({
          kind: 'error',
          message: 'Live channel disconnected. The broker may be unreachable.'
        });
      };
    });

    return () => {
      unsubscribed = true;
      source?.close();
      source = null;
    };
  }

  // ----------------------------------------------------------------- internals

  private async post(path: string, body: unknown): Promise<Response> {
    const token = await this.getToken();
    return this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  }
}
