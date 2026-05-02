/**
 * MCSMCPapps — embedded WebChat bootstrap.
 *
 * Boot order:
 *   1. Apply branding (CSS vars + page title) BEFORE mounting UI to avoid FOUC.
 *   2. Mount the chat UI shell with branded header.
 *   3. Acquire a Power Platform API access token (Teams JS \u2192 MSAL silent).
 *   4. Open a CS Wave-2 conversation via the SDK.
 *   5. Send an outbound `userContext` event so the topic can greet the user.
 *   6. Wire user input \u2194 rich-rendered inbound activities.
 *
 * The maker workflow for rebranding is in docs/MAKER-CONFIG.md \u2014 it should
 * never require touching this file.
 */

import type { Activity } from '@microsoft/agents-activity';
import { acquireToken } from './auth';
import { openConversation, type CsConversation } from './csTransport';
import { mountChatUi, type ChatUi } from './chatUi';
import { renderActivity, type SuggestedActionEvent } from './messageRenderer';
import { applyBranding, getBranding } from './branding';

const root = document.getElementById('app') ?? document.body;

let ui: ChatUi | null = null;
let conversation: CsConversation | null = null;
const branding = getBranding();

function handleActivity(activity: Activity): void {
  if (!ui) return;

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
    // We log inbound events for diagnostics. Branding is intentionally NOT
    // mutated at runtime — it is a build-time concern owned by the maker.
    // eslint-disable-next-line no-console
    console.debug('[cs:event]', activity.name, activity.value);
    return;
  }
  if (activity.type === 'conversationUpdate') {
    return;
  }
}

function handleSuggestedAction(action: SuggestedActionEvent): void {
  if (!conversation || !ui) return;
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
        host: window.location.hostname,
        brand: {
          agentName: branding.agentName,
          companyName: branding.companyName
        }
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[userContext] failed to send', err);
  }
}

async function bootstrap(): Promise<void> {
  // Apply branding before any pixels paint so the user never sees the
  // default colors on first load.
  applyBranding(branding);

  ui = mountChatUi(
    root,
    {
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
    },
    branding
  );

  ui.enableInput(false);
  ui.setStatus('Acquiring identity\u2026', 'info');

  const sso = await acquireToken();
  if (!sso.token) {
    ui.setStatus(
      `Authentication failed. ${sso.error ?? 'No access token.'}`,
      'error'
    );
    return;
  }
  const who = sso.account?.name ?? sso.account?.username ?? 'user';
  ui.setStatus(`Signed in as ${who} via ${sso.source}. Connecting\u2026`, 'info');

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
