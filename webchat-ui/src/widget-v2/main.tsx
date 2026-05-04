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
import { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom';

interface Citation { title: string; url: string }
interface ChartData {
  kind: 'stat' | 'compare' | 'trend';
  title?: string;
  primaryValue?: string;
  deltaText?: string;
  series?: Array<{ label?: string; value: number }>;
}
interface ToolPayload {
  replyText: string;
  citations: Citation[];
  chartData: ChartData | null;
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

  const ok = payload.diag?.ok !== false && payload.replyText.length > 0;
  if (!ok) {
    return <ErrorState payload={payload} />;
  }

  const chart = payload.chartData;
  const onOpenFullscreen = () => {
    host()?.requestDisplayMode?.({ mode: 'fullscreen' });
  };

  return (
    <div className="mcs-card">
      {chart && chart.kind === 'stat' ? <StatCard chart={chart} /> : null}
      {chart && chart.kind === 'compare' ? <CompareCard chart={chart} /> : null}
      {chart && chart.kind === 'trend' ? <StatCard chart={chart} /> : null}
      {!chart && payload.replyText ? (
        <div style={{ whiteSpace: 'pre-wrap' }}>{payload.replyText}</div>
      ) : null}
      <CitationsList items={payload.citations ?? []} />
      <div className="mcs-actions">
        {host()?.requestDisplayMode ? (
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
