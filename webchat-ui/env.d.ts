/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Schema name of the Copilot Studio agent (e.g. ksteam_ak001). */
  readonly VITE_CS_SCHEMA_NAME: string;
  /** GUID of the Power Platform environment where the agent lives. */
  readonly VITE_CS_ENVIRONMENT_ID: string;
  /**
   * Optional override for the CS direct-connect URL. Leave empty to let the
   * SDK compute it from environmentId + schemaName.
   */
  readonly VITE_CS_DIRECT_CONNECT_URL?: string;
  /** Microsoft Entra app registration client ID (in the CS tenant). */
  readonly VITE_AAD_CLIENT_ID: string;
  /** Authority — typically https://login.microsoftonline.com/<tenantId>. */
  readonly VITE_AAD_AUTHORITY: string;
  /**
   * MSAL scope to acquire. For CS Wave-2 the SDK expects a Power Platform
   * audience; the default is https://api.powerplatform.com/.default.
   */
  readonly VITE_AAD_SCOPE: string;

  // ---------- Branding (all optional) ----------
  /** Display name in the chat header. */
  readonly VITE_BRAND_AGENT_NAME?: string;
  /** Subtitle line below agent name. */
  readonly VITE_BRAND_AGENT_SUBTITLE?: string;
  /** Logo: emoji, short text, https URL, or data: URL. */
  readonly VITE_BRAND_LOGO?: string;
  /** Company name shown in a smaller line. */
  readonly VITE_BRAND_COMPANY_NAME?: string;
  /** Primary accent color (any CSS color). */
  readonly VITE_BRAND_ACCENT_COLOR?: string;
  /** Foreground color on the accent (e.g. text on user bubbles). */
  readonly VITE_BRAND_ACCENT_FOREGROUND?: string;
  /** Font family stack. */
  readonly VITE_BRAND_FONT_FAMILY?: string;
  /** HTML <title>. */
  readonly VITE_BRAND_PAGE_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Bot Framework Web Chat is no longer used — the CS Wave-2 SDK handles transport.
// Empty global augmentation kept so the file is a module.
export {};
