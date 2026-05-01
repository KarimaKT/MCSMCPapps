/**
 * Chat UI shell — branded header, log, typing dots, status banner, input.
 *
 * Renderer-agnostic: callers append messages via `appendUserMessage(text)`,
 * `appendBotContainer()` (returns a host element they fill with rich content),
 * or `appendSystemMessage(text)`. The `messageRenderer.ts` module renders into
 * the host element returned by `appendBotContainer`.
 *
 * The header reads from a `Branding` object so the maker can rebrand by
 * editing env vars only \u2014 no TypeScript edits required.
 */

import type { Branding } from './branding';

export interface ChatUiHandlers {
  /** Called when user submits text from the input box. */
  onSend: (text: string) => void;
}

export interface ChatUi {
  /** Append a plain-text user bubble. Returns the wrapper element. */
  appendUserMessage(text: string): HTMLElement;
  /** Append a system note (centered, italic). */
  appendSystemMessage(text: string): HTMLElement;
  /** Append an empty bot container; caller fills it with rich content. */
  appendBotContainer(): HTMLElement;
  setTyping(on: boolean): void;
  setStatus(text: string, level?: 'info' | 'ok' | 'error'): void;
  hideStatus(): void;
  enableInput(enabled: boolean): void;
  focusInput(): void;
}

export function mountChatUi(
  root: HTMLElement,
  handlers: ChatUiHandlers,
  branding: Branding
): ChatUi {
  root.innerHTML = `
    <div class="chat-frame">
      <div class="chat-header" data-branded></div>
      <div class="chat-status" role="status" aria-live="polite"></div>
      <div class="chat-log" role="log" aria-live="polite" aria-atomic="false"></div>
      <div class="chat-typing" hidden aria-hidden="true">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <form class="chat-form" autocomplete="off">
        <input
          class="chat-input"
          type="text"
          name="message"
          placeholder="Type a message\u2026"
          aria-label="Message input"
          maxlength="4000"
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck="true"
        />
        <button class="chat-send" type="submit" aria-label="Send">\u25b6</button>
      </form>
    </div>
  `;

  const header = root.querySelector('.chat-header') as HTMLDivElement;
  const status = root.querySelector('.chat-status') as HTMLDivElement;
  const log = root.querySelector('.chat-log') as HTMLDivElement;
  const typing = root.querySelector('.chat-typing') as HTMLDivElement;
  const form = root.querySelector('.chat-form') as HTMLFormElement;
  const input = root.querySelector('.chat-input') as HTMLInputElement;
  const send = root.querySelector('.chat-send') as HTMLButtonElement;

  function scrollToBottom(): void {
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  function applyHeaderBranding(b: Branding): void {
    header.replaceChildren();

    if (b.logo) {
      const logo = renderLogo(b.logo);
      logo.classList.add('chat-logo');
      header.appendChild(logo);
    }

    const titleBlock = document.createElement('div');
    titleBlock.className = 'chat-title-block';

    if (b.companyName) {
      const company = document.createElement('div');
      company.className = 'chat-company';
      company.textContent = b.companyName;
      titleBlock.appendChild(company);
    }

    const name = document.createElement('div');
    name.className = 'chat-title';
    name.textContent = b.agentName;
    titleBlock.appendChild(name);

    if (b.agentSubtitle) {
      const sub = document.createElement('div');
      sub.className = 'chat-subtitle';
      sub.textContent = b.agentSubtitle;
      titleBlock.appendChild(sub);
    }

    header.appendChild(titleBlock);
  }
  /** A logo is either an `<img>` (URL or data URL) or a text node (emoji/initials). */
  function renderLogo(value: string): HTMLElement {
    const trimmed = value.trim();
    if (/^(https?:|data:image\/)/i.test(trimmed)) {
      const img = document.createElement('img');
      img.src = trimmed;
      img.alt = '';
      img.loading = 'eager';
      return img;
    }
    const span = document.createElement('span');
    span.textContent = trimmed;
    return span;
  }

  function appendUserMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
    log.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendSystemMessage(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'msg msg-system';
    el.textContent = text;
    log.appendChild(el);
    scrollToBottom();
    return el;
  }

  function appendBotContainer(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'msg-host';
    log.appendChild(host);
    scrollToBottom();
    return host;
  }

  function setTyping(on: boolean): void {
    typing.hidden = !on;
    typing.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  function setStatus(text: string, level: 'info' | 'ok' | 'error' = 'info'): void {
    status.textContent = text;
    status.dataset.level = level;
    status.hidden = false;
  }

  function hideStatus(): void {
    status.hidden = true;
    status.textContent = '';
  }

  function enableInput(enabled: boolean): void {
    input.disabled = !enabled;
    send.disabled = !enabled;
  }

  function focusInput(): void {
    input.focus();
  }

  applyHeaderBranding(branding);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    handlers.onSend(text);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
    }
  });

  return {
    appendUserMessage,
    appendSystemMessage,
    appendBotContainer,
    setTyping,
    setStatus,
    hideStatus,
    enableInput,
    focusInput
  };
}
