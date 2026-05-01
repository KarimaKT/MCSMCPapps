/**
 * MCSMCPapps — embedded WebChat bootstrap.
 *
 * Boot order:
 *   1. Mount the minimal chat UI shell.
 *   2. Acquire a Power Platform API access token (Teams JS → MSAL silent).
 *   3. Open a CS Wave-2 conversation via the SDK.
 *   4. Wire user input ↔ inbound activities.
 *
 * If any step fails, the status banner shows actionable text. We never
 * silently go blank.
 */

import type { Activity } from '@microsoft/agents-activity';
import { acquireToken } from './auth';
import { openConversation, type CsConversation } from './directLine';
import { mountChatUi, type ChatUi } from './chatUi';

const root = document.getElementById('app') ?? document.body;

let ui: ChatUi | null = null;
let conversation: CsConversation | null = null;

function describeActivity(a: Activity): string {
  // Best-effort plain-text rendering. Phase 7 Chunk B replaces this with
  // markdown + Adaptive Cards + suggested actions.
  if (a.text && a.text.trim()) return a.text;
  if (a.type === 'event') return `[event: ${a.name ?? 'unnamed'}]`;
  if (a.type === 'typing') return '';
  if (a.type === 'conversationUpdate') return '';
  if (a.attachments && a.attachments.length > 0) {
    return `[attachment: ${a.attachments.map((x) => x.contentType).join(', ')}]`;
  }
  return `[${a.type}]`;
}

function handleActivity(activity: Activity): void {
  if (!ui) return;

  if (activity.type === 'typing') {
    ui.setTyping(true);
    return;
  }
  if (activity.type === 'message') {
    ui.setTyping(false);
    const text = describeActivity(activity);
    if (text) ui.appendMessage('bot', text);
    return;
  }
  if (activity.type === 'event') {
    // For Chunk A we just log events. Chunk B will route specific names
    // (handoff, progress, etc.) to handlers.
    // eslint-disable-next-line no-console
    console.debug('[cs:event]', activity.name, activity.value);
    return;
  }
  if (activity.type === 'conversationUpdate') {
    // No-op for Chunk A.
    return;
  }
  // Unknown / not yet handled
  // eslint-disable-next-line no-console
  console.debug('[cs:activity]', activity.type, activity);
}

async function bootstrap(): Promise<void> {
  ui = mountChatUi(root, {
    onSend: async (text) => {
      ui?.appendMessage('user', text);
      ui?.setTyping(true);
      try {
        await conversation?.sendUserMessage(text);
      } catch (err) {
        ui?.setTyping(false);
        const message = err instanceof Error ? err.message : String(err);
        ui?.appendMessage('system', `Error sending: ${message}`);
      } finally {
        ui?.setTyping(false);
        ui?.focusInput();
      }
    }
  });

  ui.enableInput(false);
  ui.setStatus('Acquiring identity…', 'info');

  const sso = await acquireToken();
  if (!sso.token) {
    ui.setStatus(
      `Authentication failed. ${sso.error ?? 'No access token.'}`,
      'error'
    );
    return;
  }
  const who = sso.account?.name ?? sso.account?.username ?? 'user';
  ui.setStatus(`Signed in as ${who} via ${sso.source}. Connecting…`, 'info');

  try {
    conversation = await openConversation({
      environmentId: import.meta.env.VITE_CS_ENVIRONMENT_ID,
      schemaName: import.meta.env.VITE_CS_SCHEMA_NAME,
      accessToken: sso.token,
      onActivity: handleActivity,
      onError: (err) => {
        ui?.setTyping(false);
        ui?.appendMessage('system', `Transport error: ${err.message}`);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ui.setStatus(`Could not open conversation: ${message}`, 'error');
    return;
  }

  ui.setStatus('Connected.', 'ok');
  ui.enableInput(true);
  ui.focusInput();
  setTimeout(() => ui?.hideStatus(), 1500);
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[MCSMCPapps] bootstrap failed', err);
  if (ui) {
    ui.setStatus(`Failed to start chat: ${message}`, 'error');
  } else {
    root.textContent = `Failed to start chat: ${message}`;
  }
});
