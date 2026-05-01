/**
 * Handoff types — the public surface for live-agent escalation.
 *
 * Customer integrators implement `HandoffProvider` for their live-agent
 * platform (Genesys, D365 Customer Service, Salesforce, ServiceNow, etc.)
 * and pass an instance to `HandoffOrchestrator`. The orchestrator owns the
 * state machine and routes user input + agent replies between the
 * Copilot Studio agent and the live platform.
 *
 * No platform-specific code lives in this folder beyond the example
 * providers in `./providers/`; treat those as starting points and replace
 * with the customer's real implementation.
 */

/** Conversation modes the orchestrator can be in. */
export type HandoffMode =
  | 'cs'          // Talking to the Copilot Studio agent (default)
  | 'handoff'     // Transitioning from CS to a live agent (system messages only)
  | 'live'        // Connected to a live human agent
  | 'returning';  // Live session ended, back to CS but not yet exchanged a turn

/** Context passed by CS when it triggers a handoff. Topic-defined. */
export interface HandoffContext {
  /** Human-readable destination, e.g. "billing-tier-2". Provider decides what it means. */
  destination?: string;
  /** Free-form structured payload from the topic (issue, amount, ticket, etc.). */
  metadata?: Record<string, unknown>;
  /** Recent transcript to seed the live agent's view (caller decides how many turns). */
  transcript?: HandoffTranscriptEntry[];
  /** End-user identity (subset of MSAL claims). */
  user?: HandoffUser;
}

/** A single past message included in the transcript snapshot. */
export interface HandoffTranscriptEntry {
  from: 'user' | 'bot';
  text: string;
  /** ISO 8601 timestamp. */
  at: string;
}

/** Subset of authenticated user info safe to forward to the live platform. */
export interface HandoffUser {
  /** Object ID (Entra `oid` claim). */
  oid?: string;
  /** Display name. */
  name?: string;
  /** UPN / email. */
  upn?: string;
  /** Locale (BCP-47, e.g. de-DE). */
  locale?: string;
}

/** A live-agent session, returned by the provider on start. */
export interface HandoffSession {
  /** Provider-specific session/conversation ID. */
  sessionId: string;
  /** Human-readable agent name to show in the UI when known. */
  agentDisplayName?: string;
  /** Optional metadata the provider wants the orchestrator to keep. */
  meta?: Record<string, unknown>;
}

/** Inbound activity from the live platform, normalized for the orchestrator. */
export type HandoffInbound =
  | { kind: 'message'; text: string; from: 'agent' | 'system'; at: string }
  | { kind: 'typing'; from: 'agent' }
  | { kind: 'agentJoined'; agentDisplayName: string }
  | { kind: 'agentLeft' }
  | { kind: 'sessionEnded'; reason: string; summary?: string }
  | { kind: 'error'; message: string };

/** Listener for inbound activities from a live session. */
export type HandoffListener = (event: HandoffInbound) => void;

/** Returned by `subscribe` so callers can clean up. */
export type Unsubscribe = () => void;

/**
 * Provider contract — implement for each live-agent platform.
 *
 * IMPORTANT: providers MUST NOT hold long-lived secrets in the browser.
 * All credential-bearing calls go through your token broker (Azure
 * Function / App Service). The provider talks to your broker, never
 * directly to the live platform's authenticated endpoints.
 */
export interface HandoffProvider {
  /** A short identifier for diagnostics, e.g. 'genesys', 'd365', 'custom'. */
  readonly id: string;

  /** Start a new live session. Returns when the session is ready to exchange messages. */
  startSession(ctx: HandoffContext): Promise<HandoffSession>;

  /** Send the user's message to the live agent. */
  sendUserMessage(sessionId: string, text: string): Promise<void>;

  /** Subscribe to inbound activities for the session. Implementations typically
   *  open a Server-Sent Events / WebSocket connection to the broker. */
  subscribe(sessionId: string, listener: HandoffListener): Unsubscribe;

  /** Gracefully end the session. */
  endSession(sessionId: string, reason?: string): Promise<void>;
}

/** Hooks the orchestrator calls when transitioning state. */
export interface HandoffHooks {
  /** Show a system message in the UI (e.g. "Connecting you with a live agent…"). */
  onSystemMessage?(text: string, mode: HandoffMode): void;
  /** Render an inbound activity from the live platform. */
  onLiveInbound?(event: HandoffInbound): void;
  /** Notified when mode changes (UI may want to re-render avatars / badges). */
  onModeChange?(prev: HandoffMode, next: HandoffMode): void;
}

/** Bridge to send things back to the Copilot Studio agent. The orchestrator
 *  uses this to (a) tell CS that a handoff is starting and (b) resume CS
 *  after a live session ends. */
export interface CopilotStudioBridge {
  /** Notify CS that handoff is in flight. CS topic typically pauses. */
  notifyHandoffPending(): Promise<void>;
  /** Notify CS that the live session ended with a summary. CS topic resumes. */
  resumeFromLive(payload: {
    summary?: string;
    reason: string;
    handledBy?: string;
  }): Promise<void>;
}

/** Configuration for the orchestrator. */
export interface HandoffOrchestratorConfig {
  provider: HandoffProvider;
  cs: CopilotStudioBridge;
  hooks?: HandoffHooks;
}
