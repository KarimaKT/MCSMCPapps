# WebChat UI

Vite + Bot Framework Web Chat surface that connects to your Copilot Studio agent. Hosted on Azure Static Web Apps; loaded by the MCP App tool inside Microsoft 365 Copilot.

✅ **Phase 3 — scaffolded.** Run locally with `npm install && npm run dev`. Configure `.env` first (copy from `.env.example`).

## Files

| Path | Purpose |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts` | Build tooling. |
| `index.html` | Static entry point. Loads Bot Framework Web Chat from the official CDN. |
| `env.d.ts` | TypeScript types for the `VITE_*` env vars. |
| `.env.example` | Template for local config. **`.env` itself is gitignored.** |
| `src/auth.ts` | 3-tier SSO chain — Teams JS → MSAL silent → anonymous fallback. |
| `src/directLine.ts` | Direct Line token exchange. **Never holds the secret.** |
| `src/main.ts` | Bootstrap — wires SSO + Direct Line + WebChat render. |

## Local development

```powershell
cd webchat-ui
Copy-Item .env.example .env
# Edit .env — fill in VITE_CS_TOKEN_ENDPOINT at minimum.
npm install
npm run dev
```

Open <http://localhost:5173>. The status banner at the top of the page tells you exactly which step failed if anything goes wrong.

## Build

```powershell
npm run typecheck   # strict TS
npm run build       # outputs to dist/
npm run preview     # preview the production build
```

Production values come from SWA Configuration (set in Phase 4).
