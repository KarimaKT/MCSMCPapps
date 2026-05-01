/**
 * HandoffOrchestrator — owns the conversation-mode state machine and routes
 * user input + inbound activities between the Copilot Studio agent and a
 * live-agent platform.
 *
 *   States:    cs ─▶ handoff ─▶ live ─▶ returning ─▶ cs
 *
 * Public API surface:
 *
 *   const orchestrator = new HandoffOrchestrator({ provider, cs, hooks });
 *
 *   // Call when CS emits a "handoff" event activity:
 *   await orchestrator.beginHandoff(ctxFromTopic);
 *
 *   // Wire your existing send-message UI through this routing layer.
 *   // It returns true if the orchestrator handled the message (i.e. the
 *   // user is currently in the live tier); false means: deliver to CS as usual.
 *   const handled = await orchestrator.routeUserMessage(text);
 *
 *   // Optionally end the live session from the UI side.
 *   await orchestrator.endLiveSession('user-cancelled');
 *
 *   // Read state for UI badges:
 *   orchestrator.mode      // HandoffMode
 *   orchestrator.agentName // string | undefined
 */

import type {
  HandoffContext,
  HandoffInbound,
  HandoffMode,
  HandoffOrchestratorConfig,
  HandoffProvider,
  HandoffSession,
  CopilotStudioBridge,
  HandoffHooks,
  Unsubscribe
} from './types';

export class HandoffOrchestrator {
  private _mode: HandoffMode = 'cs';
  private _session: HandoffSession | null = null;
  private _unsubscribe: Unsubscribe | null = null;
  private readonly provider: HandoffProvider;
  private readonly cs: CopilotStudioBridge;
  private readonly hooks: HandoffHooks;

  constructor(config: HandoffOrchestratorConfig) {
    this.provider = config.provider;
    this.cs = config.cs;
    this.hooks = config.hooks ?? {};
  }

  /** Current conversation mode. */
  get mode(): HandoffMode {
    return this._mode;
  }

  /** Live agent display name once known. */
  get agentName(): string | undefined {
    return this._session?.agentDisplayName;
  }

  /** True while user input should be sent to the live platform, not CS. */
  get isLive(): boolean {
    return this._mode === 'live';
  }

  /**
   * Start a handoff. Called by your event dispatcher when a CS topic emits
   * an `event` activity with `name === 'handoff'` and a `value` matching
   * `HandoffContext`.
   */
  async beginHandoff(context: HandoffContext): Promise<void> {
    if (this._mode !== 'cs') {
      // Already mid-handoff or live — ignore duplicate triggers.
      return;
    }
    this.setMode('handoff');
    this.hooks.onSystemMessage?.('Connecting you with a live agent…', 'handoff');

    // Best-effort: tell CS we're going dark for a bit.
    try {
      await this.cs.notifyHandoffPending();
    } catch (err) {
      // Don't block the handoff on this.
      // eslint-disable-next-line no-console
      console.warn('[handoff] notifyHandoffPending failed', err);
    }

    let session: HandoffSession;
    try {
      session = await this.provider.startSession(context);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not start a live session.';
      this.hooks.onSystemMessage?.(
        `We couldn't reach a live agent: ${message}. Returning to the assistant.`,
        'cs'
      );
      this.setMode('cs');
      return;
    }

    this._session = session;
    this._unsubscribe = this.provider.subscribe(session.sessionId, (event) =>
      this.onInbound(event)
    );

    this.setMode('live');
    const greeting = session.agentDisplayName
      ? `You're now connected with ${session.agentDisplayName}.`
      : `You're now connected with a live agent.`;
    this.hooks.onSystemMessage?.(greeting, 'live');
  }

  /**
   * Route a user-typed message. Returns true if the message went to the
   * live platform (so the caller should NOT also send it to CS); false if
   * the orchestrator did nothing and the caller should hand the message to
   * CS as usual.
   */
  async routeUserMessage(text: string): Promise<boolean> {
    if (this._mode !== 'live' || !this._session) return false;
    try {
      await this.provider.sendUserMessage(this._session.sessionId, text);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Message could not be delivered.';
      this.hooks.onSystemMessage?.(`Live agent error: ${message}`, 'live');
    }
    return true;
  }

  /** End the live session voluntarily (e.g. user clicks "Return to assistant"). */
  async endLiveSession(reason = 'user-ended'): Promise<void> {
    if (this._mode !== 'live' || !this._session) return;
    try {
      await this.provider.endSession(this._session.sessionId, reason);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[handoff] provider.endSession threw', err);
    }
    await this.finishLive({ reason, summary: undefined });
  }

  /** Stop listening and release any provider resources. */
  dispose(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._session = null;
  }

  // -------------------------------------------------------------------- internal

  private onInbound(event: HandoffInbound): void {
    // Surface to UI first so it can render typing/messages/etc.
    this.hooks.onLiveInbound?.(event);

    if (event.kind === 'sessionEnded') {
      void this.finishLive({ reason: event.reason, summary: event.summary });
    } else if (event.kind === 'agentJoined' && this._session) {
      this._session = { ...this._session, agentDisplayName: event.agentDisplayName };
    }
  }

  private async finishLive(payload: { reason: string; summary?: string }): Promise<void> {
    this._unsubscribe?.();
    this._unsubscribe = null;
    const handledBy = this._session?.agentDisplayName;
    this._session = null;

    this.setMode('returning');
    const tail = payload.summary ? ` (${payload.summary})` : '';
    this.hooks.onSystemMessage?.(
      `Live session ended: ${payload.reason}${tail}. Returning to the assistant.`,
      'returning'
    );

    try {
      await this.cs.resumeFromLive({
        reason: payload.reason,
        summary: payload.summary,
        handledBy
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[handoff] resumeFromLive failed', err);
    }

    this.setMode('cs');
  }

  private setMode(next: HandoffMode): void {
    if (next === this._mode) return;
    const prev = this._mode;
    this._mode = next;
    this.hooks.onModeChange?.(prev, next);
  }
}

export type { HandoffOrchestratorConfig } from './types';
export * from './types';
