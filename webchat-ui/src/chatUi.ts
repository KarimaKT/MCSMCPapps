/**
 * Chat UI shell — frame, header, log, typing dots, status banner, input.
 *
 * Renderer-agnostic: callers append messages via `appendUserMessage(text)`,
 * `appendBotContainer()` (returns a host element they fill with rich content),
 * or `appendSystemMessage(text)`. The `messageRenderer.ts` module renders into
 * the host element returned by `appendBotContainer`.
 */

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
  /** Set the agent display name in the header. */
  setTitle(title: string): void;
  setTyping(on: boolean): void;
  setStatus(text: string, level?: 'info' | 'ok' | 'error'): void;
  hideStatus(): void;
  enableInput(enabled: boolean): void;
  focusInput(): void;
}

export function mountChatUi(root: HTMLElement, handlers: ChatUiHandlers): ChatUi {
  root.innerHTML = `
    <div class="chat-frame">
      <div class="chat-header">
        <div class="chat-title">Copilot Studio Agent</div>
        <div class="chat-status" role="status" aria-live="polite"></div>
      </div>
      <div class="chat-log" role="log" aria-live="polite" aria-atomic="false"></div>
      <div class="chat-typing" hidden aria-hidden="true">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
      <form class="chat-form" autocomplete="off">
        <input
          class="chat-input"
          type="text"
          name="message"
          placeholder="Type a message…"
          aria-label="Message input"
          maxlength="4000"
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck="true"
        />
        <button class="chat-send" type="submit" aria-label="Send">▶</button>
      </form>
    </div>
  `;

  const title = root.querySelector('.chat-title') as HTMLDivElement;
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

  function setTitle(t: string): void {
    title.textContent = t;
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
    setTitle,
    setTyping,
    setStatus,
    hideStatus,
    enableInput,
    focusInput
  };
}
