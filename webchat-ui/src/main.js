/**
 * MCSMCPapps — embedded WebChat bootstrap.
 *
 * Boot order:
 *   1. Try to acquire an Entra access token (Teams JS → MSAL silent fallback).
 *   2. Exchange it at the CS agent's token endpoint for a Direct Line token.
 *   3. Render Bot Framework Web Chat against that Direct Line connection.
 *
 * If any step fails, render an error banner with actionable text rather than
 * silently going blank.
 */
import { acquireToken } from './auth';
import { createDirectLine } from './directLine';
const statusEl = document.getElementById('status');
const webchatEl = document.getElementById('webchat');
function setStatus(text, state = 'info') {
    if (!statusEl)
        return;
    statusEl.textContent = text;
    statusEl.dataset.state = state;
}
async function bootstrap() {
    setStatus('Acquiring identity…');
    const sso = await acquireToken();
    if (sso.source === 'none') {
        setStatus('No Entra credentials configured — using anonymous Direct Line. Configure VITE_AAD_* to enable SSO.', 'info');
    }
    else {
        setStatus(`Signed in via ${sso.source}. Connecting to Copilot Studio…`);
    }
    setStatus(`${statusEl.textContent} Opening Direct Line…`);
    const directLine = await createDirectLine({
        tokenEndpoint: import.meta.env.VITE_CS_TOKEN_ENDPOINT,
        accessToken: sso.token
    });
    if (!window.WebChat || typeof window.WebChat.renderWebChat !== 'function') {
        throw new Error('Bot Framework Web Chat CDN script not loaded.');
    }
    window.WebChat.renderWebChat({
        directLine,
        styleOptions: {
            hideUploadButton: true,
            botAvatarInitials: 'AG',
            userAvatarInitials: 'You',
            bubbleBackground: '#f3f2f1',
            bubbleFromUserBackground: '#0078d4',
            bubbleFromUserTextColor: '#ffffff'
        }
    }, webchatEl);
    setStatus('Connected.', 'ok');
    // Hide the status banner after a short delay once chat is live.
    setTimeout(() => {
        if (statusEl.dataset.state === 'ok')
            statusEl.style.display = 'none';
    }, 2000);
}
bootstrap().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[MCSMCPapps] bootstrap failed', err);
    setStatus(`Failed to start chat: ${message}`, 'error');
});
