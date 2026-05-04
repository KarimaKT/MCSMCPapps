/**
 * Vite config for the v2 (data-widget) bundle.
 *
 * Per spec 0001 + ADR 0001, the v2 widget is a small inline data card,
 * not a chat surface. It uses React 16 (already pinned for the existing
 * `webchat-ui` project), no botframework-webchat, no Fluent UI v9 (yet),
 * and hand-rolled CSS. Bundle target: < 250 KB gzipped.
 *
 * Outputs to `dist-widget-v2/index.widget-v2.html`.
 *
 * # Skybridge sandbox compatibility (carried over from v1)
 *
 *   - `stripCrossorigin` post-transform plugin: skybridge iframes have a
 *     null origin; the default `<script type="module" crossorigin>` tag
 *     triggers a CORS check on the inline script and silently fails.
 *   - `mode: 'production'` and `define NODE_ENV` to eliminate HMR eval
 *     code that would be blocked by sandbox CSP.
 *   - `vite-plugin-singlefile` packs JS, CSS, fonts (data URIs) into
 *     one HTML file. The MCP server reads it at startup and serves it
 *     from `resources/read` with MIME `text/html+skybridge`.
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

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
    react({ jsxRuntime: 'classic' }),
    stripCrossorigin(),
    viteSingleFile()
  ],
  mode: 'production',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  publicDir: false,
  build: {
    outDir: 'dist-widget-v2',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    minify: 'esbuild',
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'index.widget-v2.html',
      output: { inlineDynamicImports: true }
    }
  },
  cacheDir: 'node_modules/.vite-widget-v2'
});
