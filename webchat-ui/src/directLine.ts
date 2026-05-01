/**
 * Copilot Studio transport — Wave-2 Direct Engine protocol.
 *
 * Uses `@microsoft/agents-copilotstudio-client` to:
 *   - Open a streaming conversation against the CS Direct Engine endpoint
 *     (env id + schema name from .env)
 *   - Forward incoming Activities (messages, typing, events, suggested
 *     actions) via the `onActivity` callback
 *   - Send user messages back via `sendUserMessage(text)`
 *
 * Auth is via a Power Platform API access token acquired by `auth.ts`.
 * The CS service validates the bearer token's audience server-side.
 */

import {
  CopilotStudioClient,
  ConnectionSettings,
  PowerPlatformCloud
} from '@microsoft/agents-copilotstudio-client';
import type { Activity } from '@microsoft/agents-activity';

export interface OpenConversationParams {
  /** Power Platform environment GUID. */
  environmentId: string;
  /** Agent schema name (e.g. ksteam_ak001). */
  schemaName: string;
  /** Bearer access token for the Power Platform API. */
  accessToken: string;
  /** Called for every inbound activity. */
  onActivity: (activity: Activity) => void;
  /** Called when the underlying transport throws. */
  onError: (err: Error) => void;
  /** Power Platform cloud. Default = Prod. */
  cloud?: PowerPlatformCloud;
}

export interface CsConversation {
  /** Send a user message into the conversation. Resolves once the bot's
   *  responses for this turn have been streamed. */
  sendUserMessage(text: string): Promise<void>;
  /** Conversation ID once known. */
  readonly conversationId: string | undefined;
  /** Stop streaming and release resources. */
  close(): void;
}

export async function openConversation(
  params: OpenConversationParams
): Promise<CsConversation> {
  const settings = new ConnectionSettings({
    environmentId: params.environmentId,
    schemaName: params.schemaName,
    cloud: params.cloud ?? PowerPlatformCloud.Prod
  });

  const client = new CopilotStudioClient(settings, params.accessToken);
  let closed = false;
  let convId: string | undefined;

  async function pump(stream: AsyncGenerator<Activity>): Promise<void> {
    try {
      for await (const activity of stream) {
        if (closed) break;
        if (!convId && activity.conversation?.id) {
          convId = activity.conversation.id;
        }
        params.onActivity(activity);
      }
    } catch (err) {
      if (!closed) {
        params.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  // Kick off the conversation. CS emits conversationUpdate + any greeting
  // topic activities via this stream.
  void pump(client.startConversationStreaming(true));

  return {
    get conversationId() {
      return convId;
    },
    async sendUserMessage(text: string) {
      if (closed) throw new Error('Conversation already closed.');
      const activity = {
        type: 'message',
        text,
        from: { id: 'user', role: 'user' }
      } as unknown as Activity;
      await pump(client.sendActivityStreaming(activity));
    },
    close() {
      closed = true;
    }
  };
}
