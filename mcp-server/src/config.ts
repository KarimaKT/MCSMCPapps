/**
 * MCSMCPapps MCP server configuration.
 *
 * All runtime configuration is loaded from environment variables. Defaults
 * are demo-tenant defaults; production deployments should override them in
 * `infra/main.bicep` (App Service config app settings).
 *
 * # Important parameters (single source of truth for makers)
 *
 * Every value a maker is likely to change has a row in
 * [docs/SPEC.md §8 "Important parameters"]. If you add a new env var here,
 * add it to that table too.
 */

/**
 * Server runtime configuration.
 *
 * Add new fields by:
 *   1. Add to this interface with JSDoc explaining what it does.
 *   2. Read from `process.env` in `loadConfig()` below with a sensible default.
 *   3. Document in [docs/SPEC.md §8].
 *   4. Wire into the App Service config in `infra/main.bicep`.
 */
export interface ServerConfig {
  /**
   * Public origin where the Static Web App that hosts the WebChat lives.
   * Used by:
   *   - Resource CSP (connectDomains / resourceDomains / frameDomains)
   *   - The widget HTML's iframe `src`
   * No trailing slash.
   * @default https://icy-field-07d5bef1e.7.azurestaticapps.net
   */
  swaOrigin: string;

  /**
   * Display name of the CS agent. Surfaced as:
   *   - Tool descriptor `title`
   *   - Resource descriptor `title`
   *   - The host's status text while the tool runs ("Opening X…")
   *   - Widget header (when the widget reads it via the bridge)
   * @default Copilot Studio Agent
   */
  agentName: string;

  /**
   * Short blurb describing the agent. Used in the tool description that
   * the host model sees when deciding whether to call the tool.
   * @default Open the embedded Copilot Studio chat surface.
   */
  agentDescription: string;

  /**
   * HTTP port. Azure App Service injects `PORT` automatically.
   * @default 3000 (local dev)
   */
  port: number;
}

/**
 * Read a required env var. Returns the env value if set, otherwise the
 * fallback. Throws if neither is provided.
 */
function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        `Set it in App Service config or your local .env file.`
    );
  }
  return v;
}

/**
 * Load configuration from environment variables.
 *
 * Called once at process start by `index.ts`.
 */
export function loadConfig(): ServerConfig {
  return {
    swaOrigin: required(
      'SWA_ORIGIN',
      'https://icy-field-07d5bef1e.7.azurestaticapps.net'
    ).replace(/\/+$/, ''),
    agentName: required('AGENT_NAME', 'Copilot Studio Agent'),
    agentDescription: required(
      'AGENT_DESCRIPTION',
      'Open the embedded Copilot Studio chat surface.'
    ),
    port: Number(process.env.PORT ?? 3000)
  };
}
