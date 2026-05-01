/**
 * Rich message rendering — markdown + attachments + suggested actions.
 *
 * Pipeline:
 *   activity (Bot Framework Activity) → render(activity, container)
 *
 * 1. If `activity.text` is set, parse as GFM markdown via `marked`,
 *    sanitize the HTML output via DOMPurify, and append.
 * 2. For each attachment, route by `contentType`:
 *      - `application/vnd.microsoft.card.adaptive` → render an Adaptive Card
 *      - `application/vnd.microsoft.card.hero`     → render a HeroCard
 *      - `image/*`                                 → inline <img>
 *      - everything else                           → file-download chip
 * 3. If `activity.suggestedActions?.actions`, render a button row that
 *    invokes the provided handler when clicked.
 *
 * All HTML insertion goes through DOMPurify with a strict allowlist before
 * touching the DOM. We never use `innerHTML` with raw bot output.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import * as AdaptiveCards from 'adaptivecards';
import type { Activity } from '@microsoft/agents-activity';

// ----- marked setup -----
marked.setOptions({
  gfm: true,
  breaks: true
});

// ----- DOMPurify config -----
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'kbd', 's', 'del', 'ins',
    'blockquote', 'br', 'hr',
    'ul', 'ol', 'li',
    'p', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img'
  ] as string[],
  ALLOWED_ATTR: [
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height', 'loading',
    'class', 'colspan', 'rowspan', 'align'
  ] as string[],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false
};

// Force external links to open in new tab + add rel for security.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG' && !node.hasAttribute('loading')) {
    node.setAttribute('loading', 'lazy');
  }
});

export interface SuggestedActionEvent {
  /** The "value" the bot expects when this action is clicked. */
  value: string;
  /** Display title (what was on the button). */
  title: string;
  /** The activity type to send back. CardAction's `type` (imBack/postBack/openUrl/etc.). */
  type: string;
}

export interface RenderHandlers {
  /** User clicked a suggested action. */
  onSuggestedAction: (event: SuggestedActionEvent) => void;
  /** User submitted an Adaptive Card form (Action.Submit). */
  onAdaptiveSubmit: (data: unknown) => void;
}

/**
 * Render a single bot activity into `container`. Returns the wrapper element
 * so callers can scroll-into-view, animate, etc.
 */
export function renderActivity(
  activity: Activity,
  container: HTMLElement,
  handlers: RenderHandlers
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg msg-bot rich';

  // 1. Text → markdown
  //    Suppress trivial "Generated file: foo.png" text if the same file
  //    is also attached — the image itself is the better presentation.
  const text = activity.text?.trim();
  const skipText = !!(text && activity.attachments?.some((a) =>
    a.name && new RegExp(`\\b${escapeRegExp(a.name)}\\b`).test(text)
  ) && /^(generated file|here'?s the (chart|file|image)|chart|attached)\s*[:!.]?/i.test(text));

  if (text && !skipText) {
    const html = marked.parse(text, { async: false }) as string;
    const clean = DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    // eslint-disable-next-line no-unsanitized/property -- sanitized above
    textEl.innerHTML = clean;
    wrapper.appendChild(textEl);
  }

  // 2. Attachments
  if (activity.attachments && activity.attachments.length > 0) {
    for (const att of activity.attachments) {
      const node = renderAttachment(att, handlers);
      if (node) wrapper.appendChild(node);
    }
  }

  container.appendChild(wrapper);

  // 3. Suggested actions (rendered as a sibling row beneath the message bubble)
  if (
    activity.suggestedActions &&
    Array.isArray(activity.suggestedActions.actions) &&
    activity.suggestedActions.actions.length > 0
  ) {
    const row = renderSuggestedActions(
      activity.suggestedActions.actions,
      handlers.onSuggestedAction
    );
    container.appendChild(row);
  }

  return wrapper;
}

// ----- attachment dispatch -----

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface BfAttachment {
  contentType?: string;
  content?: unknown;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

function renderAttachment(
  att: BfAttachment,
  handlers: RenderHandlers
): HTMLElement | null {
  const ct = (att.contentType ?? '').toLowerCase();

  if (ct === 'application/vnd.microsoft.card.adaptive') {
    return renderAdaptiveCard(att.content, handlers);
  }
  if (ct === 'application/vnd.microsoft.card.hero') {
    return renderHeroCard(att.content as HeroCardContent | undefined);
  }
  if (ct.startsWith('image/') || (att.contentUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(att.contentUrl))) {
    return renderImage(att);
  }
  // Fallback: file-download chip
  if (att.contentUrl) {
    return renderFileChip(att);
  }
  return null;
}

// ----- Adaptive Cards -----

function renderAdaptiveCard(content: unknown, handlers: RenderHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'attachment adaptive-card';
  try {
    const card = new AdaptiveCards.AdaptiveCard();
    card.hostConfig = new AdaptiveCards.HostConfig({
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      spacing: { small: 4, default: 8, medium: 16, large: 24, extraLarge: 32, padding: 12 }
    });
    card.parse(content);
    card.onExecuteAction = (action) => {
      // Action.Submit returns { ...inputs }. Action.OpenUrl handled by the
      // Adaptive Cards renderer itself.
      const submit = action as AdaptiveCards.SubmitAction;
      if (submit?.data !== undefined) {
        handlers.onAdaptiveSubmit(submit.data);
      }
    };
    const rendered = card.render();
    if (rendered) wrap.appendChild(rendered);
  } catch (err) {
    wrap.textContent = `(Adaptive Card failed to render: ${
      err instanceof Error ? err.message : String(err)
    })`;
    wrap.classList.add('error');
  }
  return wrap;
}

// ----- HeroCard (legacy but common) -----

interface HeroCardContent {
  title?: string;
  subtitle?: string;
  text?: string;
  images?: { url?: string; alt?: string }[];
  buttons?: { type?: string; title?: string; value?: string }[];
}

function renderHeroCard(content: HeroCardContent | undefined): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'attachment hero-card';
  if (!content) return wrap;

  if (content.images?.[0]?.url) {
    const img = document.createElement('img');
    img.src = content.images[0].url;
    img.alt = content.images[0].alt ?? '';
    img.loading = 'lazy';
    wrap.appendChild(img);
  }
  if (content.title) {
    const h = document.createElement('div');
    h.className = 'hero-title';
    h.textContent = content.title;
    wrap.appendChild(h);
  }
  if (content.subtitle) {
    const s = document.createElement('div');
    s.className = 'hero-subtitle';
    s.textContent = content.subtitle;
    wrap.appendChild(s);
  }
  if (content.text) {
    const t = document.createElement('div');
    t.className = 'hero-body';
    t.textContent = content.text;
    wrap.appendChild(t);
  }
  return wrap;
}

// ----- Image attachment -----

function renderImage(att: BfAttachment): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'attachment image';
  const img = document.createElement('img');
  img.src = att.contentUrl ?? '';
  img.alt = att.name ?? 'Image';
  img.loading = 'lazy';
  fig.appendChild(img);
  if (att.name) {
    const cap = document.createElement('figcaption');
    cap.textContent = att.name;
    fig.appendChild(cap);
  }
  return fig;
}

// ----- File chip -----

function renderFileChip(att: BfAttachment): HTMLElement {
  const a = document.createElement('a');
  a.className = 'attachment file-chip';
  a.href = att.contentUrl ?? '#';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `📎 ${att.name ?? att.contentUrl ?? 'file'}`;
  return a;
}

// ----- Suggested actions -----

interface BfCardAction {
  type?: string;
  title?: string;
  value?: string;
  text?: string;
}

function renderSuggestedActions(
  actions: BfCardAction[],
  onClick: (event: SuggestedActionEvent) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'suggested-actions';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'suggested-action';
    btn.textContent = action.title ?? action.value ?? '(action)';
    btn.addEventListener('click', () => {
      onClick({
        value: String(action.value ?? action.text ?? action.title ?? ''),
        title: action.title ?? '',
        type: action.type ?? 'imBack'
      });
    });
    row.appendChild(btn);
  }
  return row;
}
