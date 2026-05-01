/**
 * MCSMCPapps — embedded WebChat bootstrap.
 *
 * Boot order:
 *   1. Mount the chat UI shell.
 *   2. Acquire a Power Platform API access token (Teams JS → MSAL silent).
 *   3. Open a CS Wave-2 conversation via the SDK.
 *   4. Send an outbound `userContext` event so the topic can greet the user.
 *   5. Wire user input ↔ rich-rendered inbound activities.
 */

import type { Activity } from '@microsoft/agents-activity';
import { acquireToken } from './auth';
import { openConversation, type CsConversation } from './directLine';
import { mountChatUi, type ChatUi } from './chatUi';
import { renderActivity, type SuggestedActionEvent } from './messageRenderer';

const root = document.getElementById('app') ?? document.body;
const AGENT_TITLE = 'Eurozone Analyst'; // TODO: pull from CS metadata when available

let ui: ChatUi | null = null;
let conversation: CsConversation | null = null;

function handleActivity(activity: Activity): void {
  if (!ui) return;

  // Verbose log so we can inspect bot output shape during dev.
  // eslint-disable-next-line no-console
  console.debug('[cs:activity]', activity.type, activity);

  if (activity.type === 'typing') {
    ui.setTyping(true);
    return;
  }
  if (activity.type === 'message') {
    ui.setTyping(false);
    const host = ui.appendBotContainer();
    renderActivity(activity, host, {
      onSuggestedAction: handleSuggestedAction,
      onAdaptiveSubmit: handleAdaptiveSubmit
    });
    return;
  }
  if (activity.type === 'event') {
    // eslint-disable-next-line no-console
    console.debug('[cs:event]', activity.name, activity.value);
    return;
  }
  if (activity.type === 'conversationUpdate') {
    return;
  }
  // Unknown — already logged above.
}

function handleSuggestedAction(action: SuggestedActionEvent): void {
  if (!conversation || !ui) return;
  // Show the user's selection as if they typed it.
  ui.appendUserMessage(action.title || action.value);
  ui.setTyping(true);
  void conversation
    .sendUserMessage(action.value)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      ui?.appendSystemMessage(`Error: ${message}`);
    })
    .finally(() => {
      ui?.setTyping(false);
      ui?.focusInput();
    });
}

function handleAdaptiveSubmit(data: unknown): void {
  if (!conversation || !ui) return;
  ui.appendSystemMessage('(form submitted)');
  ui.setTyping(true);
  void conversation
    .sendActivity({
      type: 'message',
      // Per Bot Framework convention, Action.Submit data goes in `value` and
      // CS topics read it from there.
      value: data,
      text: ''
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      ui?.appendSystemMessage(`Error: ${message}`);
    })
    .finally(() => {
      ui?.setTyping(false);
      ui?.focusInput();
    });
}

async function sendUserContext(): Promise<void> {
  if (!conversation) return;
  try {
    const account = (await acquireToken()).account;
    await conversation.sendActivity({
      type: 'event',
      name: 'userContext',
      value: {
        name: account?.name,
        upn: account?.username,
        oid: account?.localAccountId,
        locale: navigator.language,
        theme:
          window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light',
        host: window.location.hostname
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[userContext] failed to send', err);
  }
}

async function bootstrap(): Promise<void> {
  ui = mountChatUi(root, {
    onSend: async (text) => {
      ui?.appendUserMessage(text);
      ui?.setTyping(true);
      try {
        await conversation?.sendUserMessage(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ui?.appendSystemMessage(`Error sending: ${message}`);
      } finally {
        ui?.setTyping(false);
        ui?.focusInput();
      }
    }
  });

  ui.setTitle(AGENT_TITLE);
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
        ui?.appendSystemMessage(`Transport error: ${err.message}`);
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

  // Send the one demo event hook: tell the topic who's signed in + locale.
  void sendUserContext();

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
