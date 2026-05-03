/**
 * Vite config for the **widget bundle**.
 *
 * Outputs a single self-contained HTML file at `dist-widget/index.widget.html`
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
 * # Why we strip the `crossorigin` attribute
 *
 * Vite's default output emits `<script type="module" crossorigin>...`.
 * Sandboxed iframes (M365 Copilot skybridge, ChatGPT Apps) have a NULL
 * origin, so the `crossorigin` attribute triggers a CORS check on inline
 * scripts and the script silently fails to execute. Microsoft's
 * `mcp-interactiveUI-samples` reference (oai-apps-sdk/trey-research)
 * strips this attribute via a tiny post-transform plugin. We do the same.
 *
 * Without this plugin: bundle loads as bytes, but the React app never
 * mounts and the user sees an empty card. WITH it: the React app boots
 * normally inside the sandbox.
 *
 * # Why a separate config
 *
 * The standalone SWA output (`dist/`) is built by `vite.config.ts`. Two
 * configs lets each output evolve independently — e.g. the SWA can use
 * code splitting + service workers, while the widget MUST be one file.
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Strip `crossorigin` from inline `<script>` tags.
 *
 * Verified against Microsoft's mcp-interactiveUI-samples
 * (oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts).
 */
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<script([^>]*)\s+crossorigin(?:="[^"]*")?/g,
        '<script$1'
      );
    }
  };
}

export default defineConfig({
  plugins: [
    // React 16 ships with the classic JSX runtime only — no
    // `react/jsx-runtime` module exists. Pin the plugin to classic.
    react({ jsxRuntime: 'classic' }),
    // MUST run before viteSingleFile so the post-transform sees the
    // crossorigin attribute on the original <script> tags.
    stripCrossorigin(),
    viteSingleFile()
  ],
  // Force production mode: eliminates HMR eval / new Function() that
  // would otherwise be flagged by the sandbox CSP.
  mode: 'production',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  // The `public/` folder is for the SWA only (e.g. staticwebapp.config.json).
  // The widget bundle does NOT need any of that copied into its output.
  publicDir: false,
  build: {
    outDir: 'dist-widget',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    minify: 'esbuild',
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'index.widget.html',
      output: {
        // Single chunk; viteSingleFile inlines.
        inlineDynamicImports: true
      }
    }
  },
  cacheDir: 'node_modules/.vite-widget'
});
