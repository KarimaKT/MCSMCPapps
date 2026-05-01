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

export interface DirectLineParams {
  /** The CS token endpoint, e.g. https://<region>.api.powerplatform.com/... */
  tokenEndpoint: string;
  /** Optional Entra access token to forward (Bearer). */
  accessToken: string | null;
}

interface TokenResponse {
  token: string;
  conversationId?: string;
  expires_in?: number;
}

async function fetchDirectLineToken(params: DirectLineParams): Promise<TokenResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (params.accessToken) {
    headers['authorization'] = `Bearer ${params.accessToken}`;
  }
  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({})
  });
  if (!res.ok) {
    throw new Error(
      `Token endpoint returned ${res.status} ${res.statusText}. Verify VITE_CS_TOKEN_ENDPOINT and that the CS agent's auth mode matches.`
    );
  }
  return (await res.json()) as TokenResponse;
}

export async function createDirectLine(params: DirectLineParams): Promise<unknown> {
  if (!window.WebChat || typeof window.WebChat.createDirectLine !== 'function') {
    throw new Error(
      'Bot Framework Web Chat CDN script did not load. Check the <script src="https://cdn.botframework.com/..."> tag in index.html.'
    );
  }
  if (!params.tokenEndpoint) {
    throw new Error(
      'VITE_CS_TOKEN_ENDPOINT is empty. Set it in webchat-ui/.env (Copilot Studio → Settings → Channels → Direct Line → conversation token URL).'
    );
  }
  const { token } = await fetchDirectLineToken(params);
  return window.WebChat.createDirectLine({ token });
}
