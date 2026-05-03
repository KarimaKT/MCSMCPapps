/**
 * Build the Copilot Studio Wave-2 connection used by BotFramework Web Chat.
 *
 * Uses the OOB SDK helper `CopilotStudioWebChat.createConnection()` which
 * adapts a `CopilotStudioClient` (Direct Engine API client) to the
 * Direct Line shape that `<Composer directLine={...} />` expects.
 *
 * # Conversation id discipline
 *
 * The connection itself opens a fresh CS conversation when the user sends
 * their first message. CS allocates `conversation.id`. Every subsequent
 * activity on this connection carries it. We never mint a parallel id —
 * see [docs/ARCHITECTURE.md §2].
 *
 * # Auth
 *
 * We require the caller to pass an already-acquired Power Platform API
 * access token. Token acquisition is the caller's job (see `auth.ts`),
 * because in the skybridge sandbox the strategies are different from
 * the standalone SWA host. Keeping this module token-strategy-free keeps
 * it portable.
 */

import {
  CopilotStudioClient,
  CopilotStudioWebChat,
  PowerPlatformCloud,
  type ConnectionSettings
} from '@microsoft/agents-copilotstudio-client';

export interface CsConnectionParams {
  /** Power Platform environment GUID. */
  environmentId: string;
  /** Agent schema name (e.g. `ksteam_ak001`). */
  schemaName: string;
  /** Power Platform API access token (Bearer). Required. */
  accessToken: string;
  /**
   * Optional Power Platform cloud override. Defaults to Prod, which is
   * what 99% of customer tenants use.
   */
  cloud?: PowerPlatformCloud;
  /**
   * BotFramework Web Chat options forwarded to `createConnection`. The
   * defaults (typing indicator on) are usually right.
   */
  webChatOptions?: { typingIndicator?: boolean; showTyping?: boolean };
  /**
   * Optional `agentIdentifier` if the SDK needs it to disambiguate. Not
   * required for environments hosting one CS agent per schema.
   */
  agentIdentifier?: string;
  /**
   * Optional pre-built direct-connect URL. Most customers leave this
   * blank; the SDK derives the URL from envId + schema.
   */
  directConnectUrl?: string;
}

/**
 * Returns a Direct Line-compatible connection ready to plug into
 * `<Composer directLine={connection}>`. The connection is "lazy" — it
 * does not open the CS conversation until the user sends a message.
 */
export function buildCsConnection(params: CsConnectionParams) {
  const settings: ConnectionSettings = {
    environmentId: params.environmentId,
    schemaName: params.schemaName,
    cloud: params.cloud ?? PowerPlatformCloud.Prod,
    agentIdentifier: params.agentIdentifier ?? '',
    directConnectUrl: params.directConnectUrl ?? ''
  };

  const client = new CopilotStudioClient(settings, params.accessToken);
  return CopilotStudioWebChat.createConnection(
    client,
    params.webChatOptions ?? { showTyping: true }
  );
}
