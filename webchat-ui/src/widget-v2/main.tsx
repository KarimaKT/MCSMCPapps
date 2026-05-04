/**
 * Widget v2 — data card for the v0.6 redesign.
 *
 * Per spec 0001, this widget is NOT a chat surface. It receives the
 * structured payload from the MCP tool response (via
 * `window.openai.toolOutput.structuredContent`) and renders a small
 * inline card: text reply, optional chart, optional citations.
 *
 * # What this widget intentionally does NOT do
 *
 *   - No chat input (M365 Copilot's existing input box is the user's
 *     chat — we do not duplicate it; per MS UX guidelines)
 *   - No internal scrolling (the card fits in a single response scroll)
 *   - No MSAL / no auth flow in the browser (server-side OBO handles it)
 *   - No CS conversation maintenance in the browser (server drains it)
 *   - No bot-framework-webchat (5 MB heavy lift)
 *
 * # What it does
 *
 *   - Reads `structuredContent` synchronously on mount
 *   - Renders one of: stat / compare / trend / text-only layouts
 *   - Two action buttons max (per MS guidelines): Open analyst (full-
 *     screen mode), Sources popout
 *   - Notifies host of intrinsic height
 *   - Honors host theme (light/dark)
 */

import * as React from 'react';
import { useEffect, useState, useRef } from 'react';
import * as ReactDOM from 'react-dom';
// AdaptiveCards renderer (~120 KB gz). Spec 0002, ADR 0004.
import * as AdaptiveCards from 'adaptivecards';
// Lightweight Markdown for `replyText` (CS often emits markdown).
import { marked } from 'marked';
// Sanitize markdown HTML before injection.
import DOMPurify from 'dompurify';

interface Citation { title: string; url: string }
interface ChartData {
  kind: 'stat' | 'compare' | 'trend';
  title?: string;
  primaryValue?: string;
  deltaText?: string;
  series?: Array<{ label?: string; value: number }>;
}
/** Verbatim Adaptive Card JSON from CS. Spec 0002. */
type AdaptiveCardPayload = Record<string, unknown>;

interface ToolPayload {
  replyText: string;
  citations: Citation[];
  chartData: ChartData | null;
  /** v0.7.0+: Adaptive Cards extracted from CS reply activities. */
  adaptiveCards?: AdaptiveCardPayload[];
  conversationId: string | null;
  agentDisplayName: string;
  userQuery?: string;
  diag?: {
    ok?: boolean;
    csCallMs?: number;
    oboMs?: number;
    timedOut?: boolean;
    error?: string;
    activityCount?: number;
    step?: string;
    message?: string;
  };
}

/**
 * `window.openai` bridge surface. Augmented per the v0.6 widget needs.
 * Use the `widgetV2` namespace to avoid colliding with v1's narrower
 * declaration in webchat-ui/src/widget/host-bridge.ts.
 */
interface OpenAiBridgeV2 {
  toolOutput?: ToolPayload;
  toolInput?: { userQuery?: string };
  theme?: 'light' | 'dark';
  displayMode?: 'inline' | 'fullscreen';
  notifyIntrinsicHeight?: (h: number) => void;
  requestDisplayMode?: (req: { mode: 'inline' | 'fullscreen' }) => void;
  openExternal?: (req: { href: string }) => void;
  callTool?: (name: string, args: unknown) => Promise<unknown>;
  sendFollowUpMessage?: (req: { prompt: string }) => void;
}

/** Local cast helper — avoids merging declarations across widget bundles. */
function host(): OpenAiBridgeV2 | undefined {
  return (window as unknown as { openai?: OpenAiBridgeV2 }).openai;
}

function readPayload(): ToolPayload | null {
  try {
    const w = host();
    return w?.toolOutput ?? null;
  } catch {
    return null;
  }
}

/** Tiny inline SVG sparkline for trend charts. No deps. */
function Sparkline({ series }: { series: Array<{ value: number }> }) {
  if (!series || series.length < 2) return null;
  const values = series.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 240;
  const h = 40;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="mcs-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        points={pts}
      />
    </svg>
  );
}

function StatCard({ chart }: { chart: ChartData }) {
  const delta = chart.deltaText ?? '';
  const cls = delta.startsWith('↑') || delta.toLowerCase().startsWith('up')
    ? 'positive'
    : delta.startsWith('↓') || delta.toLowerCase().startsWith('down')
      ? 'negative'
      : '';
  return (
    <div className="mcs-stat">
      {chart.title ? <div className="mcs-stat-title">{chart.title}</div> : null}
      {chart.primaryValue ? <div className="mcs-stat-value">{chart.primaryValue}</div> : null}
      {chart.deltaText ? <div className={`mcs-stat-delta ${cls}`}>{chart.deltaText}</div> : null}
      {chart.series ? <Sparkline series={chart.series} /> : null}
    </div>
  );
}

function CompareCard({ chart }: { chart: ChartData }) {
  const series = chart.series ?? [];
  const max = Math.max(...series.map(s => s.value), 1);
  return (
    <div>
      {chart.title ? <div className="mcs-stat-title" style={{ marginBottom: 8 }}>{chart.title}</div> : null}
      <div className="mcs-compare">
        {series.map((s, i) => (
          <div key={i} className="mcs-compare-row">
            <div>
              <div className="mcs-compare-label">{s.label ?? `Item ${i + 1}`}</div>
              <div className="mcs-compare-bar">
                <div className="mcs-compare-bar-fill" style={{ width: `${(s.value / max) * 100}%` }} />
              </div>
            </div>
            <div className="mcs-compare-value">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CitationsList({ items }: { items: Citation[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mcs-citations" aria-label="Sources">
      {items.slice(0, 5).map((c, i) => (
        <a
          key={i}
          className="mcs-citation"
          href={c.url}
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            host()?.openExternal?.({ href: c.url });
          }}
        >
          ↗ {c.title}
        </a>
      ))}
    </div>
  );
}

function ErrorState({ payload }: { payload: ToolPayload }) {
  const err = payload.diag?.error ?? payload.diag?.message ?? 'Unknown error';
  return (
    <div className="mcs-error">
      <h4>{payload.agentDisplayName} couldn’t answer</h4>
      <div>{err}</div>
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
          Diagnostic
        </summary>
        <pre>{JSON.stringify(payload.diag ?? {}, null, 2)}</pre>
      </details>
    </div>
  );
}

/**
 * Render an Adaptive Card from CS into a DOM node. Per spec 0002 + ADR 0004:
 *  - We trust CS's JSON (no client-side schema validation)
 *  - Action.OpenUrl → `window.openai.openExternal`
 *  - Action.Submit + form inputs render but do nothing in v0.7.0
 *    (v0.7.1 spec 0003 will wire `submitAdaptiveCardAction`)
 *  - Parse failure → inline error placeholder; rest of widget keeps rendering
 */
function AdaptiveCardBlock({ card }: { card: AdaptiveCardPayload }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSubmit, setHasSubmit] = useState<boolean>(false);

  useEffect(() => {
    if (!ref.current) return;
    setError(null);
    // Cheap pre-scan of the JSON for interactive inputs / submit actions
    // so we can show the v0.7.0 "forms in v0.7.1" banner without parsing
    // twice. Look for any input/action.submit pattern in the serialized
    // card. False positives are fine; the banner is informational.
    try {
      const serialized = JSON.stringify(card).toLowerCase();
      setHasSubmit(
        serialized.includes('action.submit') ||
          /"type"\s*:\s*"input\./i.test(JSON.stringify(card))
      );
    } catch {
      setHasSubmit(false);
    }
    try {
      const ac = new AdaptiveCards.AdaptiveCard();
      // Minimal HostConfig honoring the widget's CSS custom props.
      ac.hostConfig = new AdaptiveCards.HostConfig({
        spacing: { small: 4, default: 8, medium: 16, large: 24, extraLarge: 32, padding: 12 },
        separator: { lineThickness: 1, lineColor: 'var(--border, #e0e0e0)' },
        supportsInteractivity: true,
        fontFamily:
          'var(--font, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif)',
        fontSizes: { small: 12, default: 14, medium: 16, large: 18, extraLarge: 22 },
        fontWeights: { lighter: 200, default: 400, bolder: 600 },
        containerStyles: {
          default: {
            backgroundColor: 'transparent',
            foregroundColors: {
              default: { default: 'var(--text, #242424)', subtle: 'var(--muted, #6b6b6b)' },
              accent: { default: 'var(--accent, #0f6cbd)', subtle: 'var(--accent, #0f6cbd)' },
              good: { default: '#107c10', subtle: '#107c10' },
              warning: { default: '#bc4b09', subtle: '#bc4b09' },
              attention: { default: '#c50f1f', subtle: '#c50f1f' }
            }
          }
        },
        actions: {
          maxActions: 5,
          spacing: 'default',
          buttonSpacing: 8,
          actionsOrientation: 'horizontal',
          actionAlignment: 'left'
        }
      });
      ac.onExecuteAction = (action) => {
        if (action instanceof AdaptiveCards.OpenUrlAction && action.url) {
          host()?.openExternal?.({ href: action.url });
          return;
        }
        if (action instanceof AdaptiveCards.SubmitAction) {
          // v0.7.1 (spec 0003) will wire this to `submitAdaptiveCardAction`.
          // For v0.7.0 we deliberately no-op so static cards render safely
          // without false-positive submit handlers.
          // eslint-disable-next-line no-console
          console.log('[widget] AC Submit clicked (v0.7.0 no-op)', action.data);
          return;
        }
      };
      ac.parse(card);
      const rendered = ac.render();
      ref.current.innerHTML = '';
      if (rendered) ref.current.appendChild(rendered);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [card]);

  if (error) {
    return (
      <div className="mcs-error" style={{ marginTop: 8 }}>
        <small>Card render failed: {error}</small>
      </div>
    );
  }
  return (
    <div>
      {hasSubmit ? (
        <div
          className="mcs-banner"
          style={{
            fontSize: 12,
            color: 'var(--muted, #6b6b6b)',
            background: 'var(--surface, #f5f5f5)',
            border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 4,
            padding: '6px 10px',
            marginBottom: 8
          }}
        >
          Interactive form inputs are coming in v0.7.1. Buttons that open
          a URL work today; Submit buttons currently do not post back.
        </div>
      ) : null}
      <div className="mcs-ac" ref={ref} />
    </div>
  );
}

/**
 * Render `replyText` as Markdown. CS often emits markdown bullets,
 * bold, links. Sanitized via DOMPurify before injection.
 */
function MarkdownText({ text }: { text: string }) {
  const html = React.useMemo(() => {
    try {
      const raw = marked.parse(text, { async: false }) as string;
      return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] });
    } catch {
      // Fall back to plain text if marked fails.
      return text.replace(/[<>&]/g, (c) =>
        c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'
      );
    }
  }, [text]);
  return (
    <div
      className="mcs-md"
      style={{ whiteSpace: 'normal' }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // Route in-card link clicks through openExternal for sandbox safety.
        const t = e.target as HTMLElement;
        if (t && t.tagName === 'A') {
          const href = t.getAttribute('href');
          if (href) {
            e.preventDefault();
            host()?.openExternal?.({ href });
          }
        }
      }}
    />
  );
}

function App() {
  const [payload, setPayload] = useState<ToolPayload | null>(() => readPayload());
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    host()?.theme === 'dark' ? 'dark' : 'light'
  );

  // Watch for late toolOutput delivery (host may mount the iframe before
  // the tool result is ready).
  useEffect(() => {
    if (payload) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const p = readPayload();
      if (p) setPayload(p);
      else setTimeout(tick, 250);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  // Track host theme + display mode + globals updates.
  useEffect(() => {
    const onSetGlobals = () => {
      const t = host()?.theme;
      if (t === 'light' || t === 'dark') setTheme(t);
      const p = readPayload();
      if (p) setPayload(p);
    };
    window.addEventListener('openai:set_globals', onSetGlobals as EventListener, {
      passive: true
    } as AddEventListenerOptions);
    return () => window.removeEventListener('openai:set_globals', onSetGlobals as EventListener);
  }, []);

  // Notify host of intrinsic height when content changes.
  useEffect(() => {
    const notify = () => {
      try {
        const h = document.documentElement.scrollHeight;
        host()?.notifyIntrinsicHeight?.(h);
      } catch {
        // ignore
      }
    };
    notify();
    const ro = new ResizeObserver(notify);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [payload]);

  // Apply theme to body.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  if (!payload) {
    const userQuery = host()?.toolInput?.userQuery;
    return <div className="mcs-pending">Loading{userQuery ? ' “' + userQuery + '”' : ''}…</div>;
  }

  const ok = payload.diag?.ok !== false && (payload.replyText.length > 0 || (payload.adaptiveCards?.length ?? 0) > 0);
  if (!ok) {
    return <ErrorState payload={payload} />;
  }

  const chart = payload.chartData;
  const cards = payload.adaptiveCards ?? [];
  const isFullscreen = host()?.displayMode === 'fullscreen';
  const onOpenFullscreen = () => {
    host()?.requestDisplayMode?.({ mode: 'fullscreen' });
  };
  const onCopy = async () => {
    // Copy the rendered text. Falls back gracefully if clipboard API
    // is blocked by the sandbox (rare but possible).
    try {
      const txt = payload.replyText ?? '';
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      // ignore — best effort
    }
  };
  const onPrint = () => {
    // window.print works inside the skybridge iframe and prints just
    // the iframe contents — exactly the analyst canvas. Browser handles
    // the "Save as PDF" destination from the print dialog.
    try {
      window.print();
    } catch {
      // ignore
    }
  };

  return (
    <div className="mcs-card">
      {isFullscreen ? (
        <div
          className="mcs-toolbar"
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginBottom: 8,
            position: 'sticky',
            top: 0,
            background: 'var(--bg, #fff)',
            paddingBottom: 8,
            borderBottom: '1px solid var(--border, #e0e0e0)',
            zIndex: 1
          }}
        >
          <button className="mcs-btn" onClick={onCopy} aria-label="Copy answer text">
            Copy
          </button>
          <button className="mcs-btn" onClick={onPrint} aria-label="Print or save as PDF">
            Print / Save as PDF
          </button>
        </div>
      ) : null}
      {chart && chart.kind === 'stat' ? <StatCard chart={chart} /> : null}
      {chart && chart.kind === 'compare' ? <CompareCard chart={chart} /> : null}
      {chart && chart.kind === 'trend' ? <StatCard chart={chart} /> : null}
      {payload.replyText ? <MarkdownText text={payload.replyText} /> : null}
      {cards.length > 0 ? (
        <div className="mcs-cards" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: chart || payload.replyText ? 12 : 0 }}>
          {cards.map((c, i) => (
            <AdaptiveCardBlock key={i} card={c} />
          ))}
        </div>
      ) : null}
      <CitationsList items={payload.citations ?? []} />
      <div className="mcs-actions">
        {!isFullscreen && host()?.requestDisplayMode ? (
          <button className="mcs-btn primary" onClick={onOpenFullscreen}>
            Open analyst
          </button>
        ) : null}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  ReactDOM.render(<App />, container);
}
