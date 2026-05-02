/**
 * Build configuration baked at runtime via env vars.
 *
 * The MCP server is intentionally thin: the single `openCopilotStudioChat`
 * tool returns a UI widget descriptor whose HTML iframes the Static Web App
 * (the WebChat). Any maker can rebrand or repoint by editing only env vars.
 */

export interface ServerConfig {
  /** Public origin where the Static Web App that hosts the WebChat lives. */
  swaOrigin: string;
  /** Display title shown by the host before the widget renders. */
  agentName: string;
  /** Subtitle shown by the host. */
  agentDescription: string;
  /** HTTP port. */
  port: number;
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

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
