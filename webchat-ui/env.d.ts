/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Schema name of the Copilot Studio agent (e.g. cr12345_myAgent). */
  readonly VITE_CS_SCHEMA_NAME: string;
  /** GUID of the Copilot Studio bot. */
  readonly VITE_CS_BOT_ID: string;
  /** GUID of the Power Platform environment. */
  readonly VITE_CS_ENVIRONMENT_ID: string;
  /** Direct Line / token endpoint URL exposed by the CS agent. */
  readonly VITE_CS_TOKEN_ENDPOINT: string;
  /** Microsoft Entra app registration client ID. */
  readonly VITE_AAD_CLIENT_ID: string;
  /** Authority — typically https://login.microsoftonline.com/<tenantId>. */
  readonly VITE_AAD_AUTHORITY: string;
  /** Custom scope, e.g. api://<client-id>/access_as_user. */
  readonly VITE_AAD_SCOPE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Bot Framework Web Chat is loaded as a CDN script and exposes window.WebChat.
declare global {
  interface Window {
    WebChat: {
      renderWebChat: (options: unknown, target: HTMLElement) => void;
      createDirectLine: (config: { token?: string; secret?: string; domain?: string }) => unknown;
    };
  }
}

export {};
