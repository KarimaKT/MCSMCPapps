/**
 * Direct Line connection helper.
 *
 * The browser MUST NOT hold the Direct Line secret. Instead it calls a
 * server-side token endpoint (your Copilot Studio agent's token URL) which
 * exchanges either:
 *   - the user's Entra access token (preferred), or
 *   - nothing (anonymous, dev only)
 * for a short-lived Direct Line token scoped to a single conversation.
 *
 * We rely on `window.WebChat.createDirectLine` shipped by the Bot Framework
 * Web Chat CDN bundle.
 */
async function fetchDirectLineToken(params) {
    const headers = { 'content-type': 'application/json' };
    if (params.accessToken) {
        headers['authorization'] = `Bearer ${params.accessToken}`;
    }
    const res = await fetch(params.tokenEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
    });
    if (!res.ok) {
        throw new Error(`Token endpoint returned ${res.status} ${res.statusText}. Verify VITE_CS_TOKEN_ENDPOINT and that the CS agent's auth mode matches.`);
    }
    return (await res.json());
}
export async function createDirectLine(params) {
    if (!window.WebChat || typeof window.WebChat.createDirectLine !== 'function') {
        throw new Error('Bot Framework Web Chat CDN script did not load. Check the <script src="https://cdn.botframework.com/..."> tag in index.html.');
    }
    if (!params.tokenEndpoint) {
        throw new Error('VITE_CS_TOKEN_ENDPOINT is empty. Set it in webchat-ui/.env (Copilot Studio → Settings → Channels → Direct Line → conversation token URL).');
    }
    const { token } = await fetchDirectLineToken(params);
    return window.WebChat.createDirectLine({ token });
}
