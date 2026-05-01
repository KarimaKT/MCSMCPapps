/**
 * Minimal chat UI for the embedded Copilot Studio agent.
 *
 * Renders message bubbles, a system status row, a typing indicator, and an
 * input box. Designed to be replaced with a richer renderer in Phase 7
 * Chunk B (markdown + Adaptive Cards + suggested actions). For now it just
 * lets us validate the SDK transport and SSO end-to-end.
 */

export type ChatRole = 'user' | 'bot' | 'system';

export interface ChatUiHandlers {
  /** Called when user submits text from the input box. */
  onSend: (text: string) => void;
}

export interface ChatUi {
  appendMessage(role: ChatRole, text: string): HTMLElement;
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

  const status = root.querySelector('.chat-status') as HTMLDivElement;
  const log = root.querySelector('.chat-log') as HTMLDivElement;
  const typing = root.querySelector('.chat-typing') as HTMLDivElement;
  const form = root.querySelector('.chat-form') as HTMLFormElement;
  const input = root.querySelector('.chat-input') as HTMLInputElement;
  const send = root.querySelector('.chat-send') as HTMLButtonElement;

  function appendMessage(role: ChatRole, text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `msg msg-${role}`;
    el.textContent = text;
    log.appendChild(el);
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
    return el;
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

  // Send-on-Enter is the default form behaviour. Add Esc to clear.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
    }
  });

  return {
    appendMessage,
    setTyping,
    setStatus,
    hideStatus,
    enableInput,
    focusInput
  };
}
