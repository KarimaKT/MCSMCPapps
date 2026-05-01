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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Bot Framework Web Chat is no longer used — the CS Wave-2 SDK handles transport.
// Empty global augmentation kept so the file is a module.
export {};
