/**
 * Branding configuration — readable at build time via VITE_BRAND_* env vars.
 *
 * Maker workflow:
 *   1. Edit `.env` (local dev) — copy from `.env.example`.
 *   2. Set the same values as GitHub Actions secrets (production builds).
 *   3. Done. Nothing in TypeScript needs to change to rebrand.
 *
 * Branding is **build-time only**. The runtime intentionally has no path
 * for the bot or any other source to change brand at runtime; that would
 * couple the WebChat surface to topic content and undermine the
 * single-source-of-truth that makers expect.
 *
 * All values have sensible defaults so the WebChat works even if a maker
 * sets only the CS agent IDs and skips branding entirely.
 */

export interface Branding {
  /** Display name in the chat header. e.g. "Eurozone Analyst". */
  agentName: string;
  /** Optional subtitle below the agent name. */
  agentSubtitle: string;
  /**
   * Logo. One of:
   *   - an emoji or short string ("📊", "AG")
   *   - an `https://` URL to an SVG/PNG
   *   - a `data:` URL with inline image
   *   - empty string to omit the logo
   */
  logo: string;
  /** Company name shown in a smaller line above the agent name. */
  companyName: string;
  /** Primary accent color (CSS color string, e.g. "#0078d4"). */
  accentColor: string;
  /** Foreground color used on the accent (text on user-bubble + send button). */
  accentForeground: string;
  /** Font family stack. */
  fontFamily: string;
  /** HTML <title>. Falls back to agentName. */
  pageTitle: string;
}

const DEFAULT_BRANDING: Branding = {
  agentName: 'Copilot Studio Agent',
  agentSubtitle: '',
  logo: '💬',
  companyName: '',
  accentColor: '#0078d4',
  accentForeground: '#ffffff',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  pageTitle: ''
};

/** Read branding from VITE_BRAND_* env vars; fall back to defaults. */
export function getBranding(): Branding {
  const env = import.meta.env;
  const merged: Branding = {
    agentName: env.VITE_BRAND_AGENT_NAME || DEFAULT_BRANDING.agentName,
    agentSubtitle:
      env.VITE_BRAND_AGENT_SUBTITLE || DEFAULT_BRANDING.agentSubtitle,
    logo: env.VITE_BRAND_LOGO ?? DEFAULT_BRANDING.logo,
    companyName: env.VITE_BRAND_COMPANY_NAME || DEFAULT_BRANDING.companyName,
    accentColor: env.VITE_BRAND_ACCENT_COLOR || DEFAULT_BRANDING.accentColor,
    accentForeground:
      env.VITE_BRAND_ACCENT_FOREGROUND || DEFAULT_BRANDING.accentForeground,
    fontFamily: env.VITE_BRAND_FONT_FAMILY || DEFAULT_BRANDING.fontFamily,
    pageTitle: env.VITE_BRAND_PAGE_TITLE || ''
  };
  return Object.freeze(merged);
}

/**
 * Apply a Branding object to the DOM. Sets CSS variables and the document
 * title. Called once during boot; not exposed for runtime rebrand.
 */
export function applyBranding(b: Branding): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', b.accentColor);
  root.style.setProperty('--accent-fg', b.accentForeground);
  root.style.setProperty('--bubble-user', b.accentColor);
  root.style.setProperty('--bubble-user-fg', b.accentForeground);
  root.style.setProperty('--font-family', b.fontFamily);

  document.title = b.pageTitle || b.agentName;
}
