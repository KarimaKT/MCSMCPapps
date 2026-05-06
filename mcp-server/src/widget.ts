/**
 * Widget HTML loader.
 *
 * Reads the single-file React bundle produced by
 * `webchat-ui/vite.widget-v2.config.ts` and serves it as the body of
 * the `ui://mcsmcpapps/chat` resource (MIME `text/html+skybridge`).
 *
 * # Where the bundle lives
 *
 *   - **App Service (canonical runtime path):** the deploy step copies
 *     the bundle into `mcp-server/dist/assets/widget.html`. The CI
 *     workflow performs the copy.
 *   - **Local dev:** `webchat-ui/dist-widget-v2/index.widget-v2.html`
 *     (built by `npm run build:widget-v2` in webchat-ui).
 *
 * We try a small list of candidate paths in order, log which one
 * matched, and cache the file contents in memory at startup. The file
 * is small (~250 KB) and never changes for a given deployment, so
 * caching is safe.
 *
 * # If no bundle is found
 *
 * The server logs a clear error and returns a minimal fallback HTML
 * explaining the missing-build situation. This makes "I forgot to run
 * `npm run build:widget-v2`" easy to diagnose, instead of an empty
 * card.
 *
 * # Customization workflow for makers
 *
 * v0.6+ customization happens by editing
 * `webchat-ui/src/widget-v2/main.tsx` directly and rebuilding. The
 * MCP server picks up the fresh bundle on next process start. (The
 * v0.5 BotFramework Web Chat `styleOptions` path described in older
 * versions of WIDGET-CUSTOMIZATION.md is no longer used.)
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Candidate locations for the prebuilt widget HTML, in priority order. */
const CANDIDATES = [
  // 1. Co-located with the deployed mcp-server (CI populates this).
  resolve(__dirname, 'assets', 'widget.html'),
  resolve(__dirname, '..', 'assets', 'widget.html'),
  // 2. v0.6 local dev — `npm run build:widget-v2` in webchat-ui.
  resolve(__dirname, '..', '..', 'webchat-ui', 'dist-widget-v2', 'index.widget-v2.html'),
  resolve(__dirname, '..', '..', '..', 'webchat-ui', 'dist-widget-v2', 'index.widget-v2.html')
  // v0.5 fallback paths (dist-widget/index.widget.html) were removed
  // 2026-05-06. The v0.5 chat-in-chat bundle is incompatible with the
  // skybridge sandbox (see ADR 0001) and falling back to it produced
  // worse failure modes than the explicit fallbackHtml below.
];

function loadFromDisk(): { path: string; html: string } | null {
  for (const p of CANDIDATES) {
    if (existsSync(p)) {
      try {
        const html = readFileSync(p, 'utf8');
        return { path: p, html };
      } catch {
        // Try the next candidate.
      }
    }
  }
  return null;
}

function fallbackHtml(reason: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Widget unavailable</title>
<style>body{font-family:Segoe UI,sans-serif;padding:24px;color:#8b0000}</style>
</head><body>
<h2>Widget bundle not found</h2>
<p>${reason}</p>
<p>Build the widget with <code>npm run build:widget-v2</code> in <code>webchat-ui/</code>,
then restart this server.</p>
</body></html>`;
}

/** Cached HTML body. Loaded at module import time. */
const loaded = loadFromDisk();

if (loaded) {
  // eslint-disable-next-line no-console
  console.log(`[widget] loaded bundle from ${loaded.path} (${loaded.html.length} bytes)`);
} else {
  // eslint-disable-next-line no-console
  console.warn(
    `[widget] no bundle found. Tried:\n  ${CANDIDATES.join('\n  ')}`
  );
}

const cachedHtml = loaded?.html ??
  fallbackHtml('No prebuilt widget HTML was found at any expected location.');

/**
 * Get the widget HTML body for the chat-widget resource.
 *
 * The body is fully self-contained (CSS + JS inlined). Callers wrap it in
 * the resource descriptor with MIME `text/html+skybridge`.
 *
 * The `_opts` parameter is kept for API compatibility with the previous
 * dynamic-template version. We no longer interpolate at request time —
 * branding and behavior are baked into the bundle at build time, exactly
 * the way Microsoft's reference samples do it.
 */
export interface WidgetHtmlOptions {
  swaOrigin: string;
  agentName: string;
}

export function renderWidgetHtml(_opts: WidgetHtmlOptions): string {
  return cachedHtml;
}
