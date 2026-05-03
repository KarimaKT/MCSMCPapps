/**
 * Eurozone Analyst widget — React entry point for the M365 Copilot
 * skybridge embedding.
 *
 * # What this is
 *
 * A small React app rendered by `<Composer directLine={cs} styleOptions={...}>`
 * + `<BasicWebChat />` from [botframework-webchat]. The OOB BotFramework
 * Web Chat does the heavy lifting: streaming, typing, Adaptive Cards,
 * suggested actions, attachments, accessibility.
 *
 * # Customization paths (in priority order)
 *
 *   1. **Drop a styleOptions JSON** at `webchat-ui/src/widget/style-options.json`.
 *      Export from CS Kit Webchat Playground (https://aka.ms/CopilotStudioKit)
 *      or hand-edit. Field reference:
 *      https://github.com/microsoft/BotFramework-WebChat/blob/main/packages/api/src/StyleOptions.ts
 *
 *   2. **Override colors / fonts via env vars** (`VITE_BRAND_*`). For the
 *      "I just want to change the accent color" case, no JSON edit needed.
 *
 *   3. **Replace this React component** to add custom panels, charts,
 *      ribbons, etc. The hooks `useDirectLine`, `useSendMessage`, etc.
 *      from `botframework-webchat-hook` give you the activity stream.
 *
 * # Maker UX bar
 *
 * Match the Copilot Studio Kit Webchat Playground:
 *
 *   - Visual edit → JSON export → drop in our repo → rebuild → done.
 *   - The same JSON works on customer's website (standalone SWA channel)
 *     and inside M365 Copilot (skybridge channel).
 *
 * # CS conversation id discipline
 *
 * `<Composer>` opens the CS conversation through the OOB SDK; CS owns the
 * id. We do not mint our own. See [docs/ARCHITECTURE.md §2].
 */

import * as React from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Components } from 'botframework-webchat';
import { FluentThemeProvider } from 'botframework-webchat-fluent-theme';
import { buildCsConnection } from './cs-connection';
import { subscribeFirstQuery } from './host-bridge';
import styleOptionsJson from './style-options.json';

const { BasicWebChat, Composer } = Components;

/** Boot trace bridge (set by inline shim in index.widget.html). */
function trace(phase: string, extra?: unknown): void {
  try {
    (window as unknown as { __mcsmcpappsTrace?: (p: string, e?: unknown) => void })
      .__mcsmcpappsTrace?.(phase, extra);
  } catch {
    // ignore
  }
}

// Brand env vars override styleOptions where they overlap. This gives a
// maker the choice: full JSON theme (CS Kit export), or just tweak 1-2
// env vars for a quick rebrand. Both work.
function applyBrandOverrides(base: Record<string, unknown>): Record<string, unknown> {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const merged = { ...base };
  if (env.VITE_BRAND_ACCENT_COLOR) {
    merged.accent = env.VITE_BRAND_ACCENT_COLOR;
    merged.bubbleFromUserBackground = env.VITE_BRAND_ACCENT_COLOR;
    merged.botAvatarBackgroundColor = env.VITE_BRAND_ACCENT_COLOR;
    merged.suggestedActionBorderColor = env.VITE_BRAND_ACCENT_COLOR;
    merged.suggestedActionTextColor = env.VITE_BRAND_ACCENT_COLOR;
  }
  if (env.VITE_BRAND_ACCENT_FOREGROUND) {
    merged.bubbleFromUserTextColor = env.VITE_BRAND_ACCENT_FOREGROUND;
    merged.botAvatarTextColor = env.VITE_BRAND_ACCENT_FOREGROUND;
  }
  if (env.VITE_BRAND_FONT_FAMILY) {
    merged.primaryFont = env.VITE_BRAND_FONT_FAMILY;
  }
  if (env.VITE_BRAND_BOT_AVATAR_INITIALS) {
    merged.botAvatarInitials = env.VITE_BRAND_BOT_AVATAR_INITIALS;
  }
  return merged;
}

interface WidgetProps {
  /** Power Platform environment GUID. */
  environmentId: string;
  /** CS agent schema name. */
  schemaName: string;
  /** Bearer token for the Power Platform API. */
  accessToken: string;
}

/**
 * The chat widget. Pure presentation — receives a token from the parent.
 * Surfaces nothing about auth; the parent picks the right strategy.
 */
export function Widget(props: WidgetProps): JSX.Element | null {
  const [connection, setConnection] = useState<unknown>(null);
  const firstQueryRef = useRef<string | null>(null);
  const sentFirstRef = useRef(false);

  // Build the CS connection once we have a token.
  useEffect(() => {
    if (!props.accessToken) return;
    trace('cs-connection-build', {
      hasEnvId: Boolean(props.environmentId),
      hasSchema: Boolean(props.schemaName)
    });
    try {
      const c = buildCsConnection({
        environmentId: props.environmentId,
        schemaName: props.schemaName,
        accessToken: props.accessToken
      });
      trace('cs-connection-ready');
      setConnection(c);
    } catch (err) {
      trace('cs-connection-failed', {
        msg: String((err as Error)?.message || err).substr(0, 200)
      });
    }
  }, [props.accessToken, props.environmentId, props.schemaName]);

  // Listen for the host's first-message handoff (e.g. M365 Copilot tool
  // input). We capture it here and let `Composer`'s `sendMessageBox` send
  // it once the connection is ready.
  useEffect(() => {
    const unsub = subscribeFirstQuery((text) => {
      firstQueryRef.current = text;
    });
    return () => unsub();
  }, []);

  // When the connection becomes ready, simulate sending the first message
  // (if any). We do this by dispatching a Web Chat action via the store —
  // but the simplest portable approach is to use the SDK connection's
  // `postActivity` directly.
  const onConnectionReady = useCallback(() => {
    if (sentFirstRef.current) return;
    const text = firstQueryRef.current;
    if (!text || !connection) return;
    sentFirstRef.current = true;
    try {
      const c = connection as {
        postActivity?: (a: unknown) => unknown;
      };
      if (typeof c.postActivity === 'function') {
        c.postActivity({
          type: 'message',
          from: { id: 'user', role: 'user' },
          text
        });
      }
    } catch {
      // The standalone SWA path may not provide postActivity; in that
      // case we just leave the sendBox focused for the user to type.
      // No-op.
    }
  }, [connection]);

  useEffect(() => {
    if (connection) {
      // The connection emits `connectionStatus$` (rxjs Observable) but
      // listening to it correctly across versions of botframework-webchat
      // is fiddly. The simplest safe shim: try to send the first message
      // on the next tick. If the connection isn't ready, postActivity
      // throws and we just skip — the user types it manually.
      const t = window.setTimeout(onConnectionReady, 250);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [connection, onConnectionReady]);

  if (!connection) return null;

  // styleOptions: file-driven (CS Kit export-compatible) + env overrides.
  const styleOptions = applyBrandOverrides(
    styleOptionsJson as Record<string, unknown>
  );

  return (
    <FluentThemeProvider>
      <Composer
        directLine={connection as never}
        styleOptions={styleOptions as never}
      >
        <BasicWebChat />
      </Composer>
    </FluentThemeProvider>
  );
}
