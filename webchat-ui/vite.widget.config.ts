/**
 * Vite config for the **widget bundle**.
 *
 * Outputs a single self-contained HTML file at `dist-widget/widget.html`
 * via [vite-plugin-singlefile]. The MCP server reads this file at startup
 * and returns it from `resources/read` with MIME `text/html+skybridge`.
 *
 * # Why singlefile
 *
 * The skybridge sandbox in M365 Copilot does not reliably mount iframes
 * of external origins (see [docs/MCP-APPS-CONTRACT.md] failure modes).
 * Microsoft's reference samples all bundle as a single inlined HTML.
 * `vite-plugin-singlefile` packs JS, CSS, fonts (data URIs) into one
 * file so the MCP `resources/read` response is fully self-contained.
 *
 * # Why a separate config
 *
 * The standalone SWA output (`dist/`) is built by `vite.config.ts`. Two
 * configs lets each output evolve independently — e.g. the SWA can use
 * code splitting + service workers, while the widget MUST be one file.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    // React 16 ships with the classic JSX runtime only — no
    // `react/jsx-runtime` module exists. Pin the plugin to classic.
    react({ jsxRuntime: 'classic' }),
    viteSingleFile()
  ],
  // The `public/` folder is for the SWA only (e.g. staticwebapp.config.json).
  // The widget bundle does NOT need any of that copied into its output.
  publicDir: false,
  build: {
    outDir: 'dist-widget',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'index.widget.html',
      output: {
        // Single chunk; viteSingleFile inlines.
        inlineDynamicImports: true
      }
    }
  },
  // Avoid name collisions between the SPA and widget builds. We always
  // use a fresh build invocation rather than incremental.
  cacheDir: 'node_modules/.vite-widget'
});
