import { probeResponseSchema } from '../core/protocol';
import type { Recipient } from '../core/model';

const editorSelector = '[contenteditable="true"][role="textbox"]';
const actionSelector = '[data-icon="ptt"], [data-icon="mic"], [data-icon*="microphone"], [data-icon^="send"], [data-icon="ptt-refreshed"]';
const actionLabel = /^(?:voice message|record voice message|audio|áudio|mensagem de voz|gravar mensagem de voz|gravar áudio|send|enviar)$/i;
const normalize = (value: string) => value.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');

export function normalizePhone(value: string): string | null {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

export function readComposer(editor: HTMLElement): string {
  // innerText follows visible line breaks in WhatsApp's contenteditable.
  if (!editor.textContent) return '';
  return normalize(editor.innerText ?? editor.textContent ?? '');
}

export class WhatsAppAdapter {
  private identifying: Promise<Recipient | null> | null = null;

  editor(): HTMLElement | null {
    const known = document.querySelector<HTMLElement>(`#main footer ${editorSelector}, [data-testid="conversation-compose-box-input"][contenteditable="true"], [data-testid="conversation-compose-box-input"] ${editorSelector}`);
    if (known) return known;
    const candidates = [...document.querySelectorAll<HTMLElement>(editorSelector)].filter(element => {
      const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? '';
      return !!element.closest('footer') || element.getAttribute('data-tab') === '10' || /^(?:type a message|digite uma mensagem|escreva uma mensagem)$/i.test(label);
    });
    return candidates.length === 1 ? candidates[0]! : null;
  }
  main(): HTMLElement | null {
    const editor = this.editor();
    if (!editor) return null;
    const known = editor.closest<HTMLElement>('#main');
    if (known) return known;
    let node = editor.parentElement;
    while (node && node !== document.body) {
      if (node.querySelector('header')) return node;
      node = node.parentElement;
    }
    return null;
  }
  footer(): HTMLElement | null {
    const editor = this.editor();
    if (!editor) return null;
    const footer = editor.closest<HTMLElement>('footer');
    if (footer) return footer;
    let node = editor.parentElement;
    while (node && node !== document.body && !node.querySelector('header')) {
      if (this.actionButton(node)) return node;
      node = node.parentElement;
    }
    return null;
  }
  header(): HTMLElement | null { return this.main()?.querySelector('header') ?? null; }
  actionAnchor(): HTMLElement | null {
    const footer = this.footer();
    return footer ? this.actionButton(footer) : null;
  }
  private actionButton(container: HTMLElement): HTMLElement | null {
    const icon = container.querySelector(actionSelector);
    const button = icon?.closest<HTMLElement>('button, [role="button"]');
    if (button) return button;
    return [...container.querySelectorAll<HTMLElement>('button[aria-label], [role="button"][aria-label]')]
      .find(element => actionLabel.test(element.getAttribute('aria-label')!)) ?? null;
  }
  diagnostics() {
    // Only structural attributes: never include chats, message text or phone numbers.
    return {
      version: chrome.runtime.getManifest().version,
      conversationRoot: !!this.main(), composer: !!this.editor(), toolbar: !!this.footer(), action: !!this.actionAnchor(),
      textboxCount: document.querySelectorAll(editorSelector).length,
      footerCount: document.querySelectorAll('footer').length,
      toolbarIcons: [...(this.footer()?.querySelectorAll('[data-icon]') ?? [])].map(element => element.getAttribute('data-icon')),
    };
  }
  label(): string | null {
    const header = this.header();
    return header?.querySelector<HTMLElement>('span[title]')?.getAttribute('title') ??
      header?.querySelector<HTMLElement>('[data-testid="conversation-info-header-chat-title"]')?.textContent?.trim() ?? null;
  }
  signature(): string {
    return this.label() ?? '';
  }
  invalidate(): void { /* Identity is always read fresh from the WhatsApp runtime. */ }
  available(): boolean {
    return !!this.editor() && navigator.onLine && !document.querySelector(
      '[data-testid="alert-phone-disconnected"], [data-testid="alert-computer-disconnected"], [data-testid="qrcode"]',
    );
  }

  async resolveRecipient(force = false): Promise<Recipient | null> {
    if (this.identifying && !force) return this.identifying;
    const job = chrome.runtime.sendMessage({ type: 'WA_SCHEDULER_ACTIVE' }).then(raw => {
      const parsed = probeResponseSchema.safeParse(raw);
      return parsed.success ? parsed.data.recipient : null;
    });
    this.identifying = job;
    try { return await job; } finally { if (this.identifying === job) this.identifying = null; }
  }

  unsupportedDraft(): boolean {
    return !!this.footer()?.querySelector(
      '[data-testid="quoted-message"], [data-testid="media-editor"], [data-testid="audio-recording"], ' +
      '[data-icon="quoted"], [data-icon="ptt-stop"], [data-icon="ptt-pause"], [data-testid="compose-quoted-message"]',
    ) || !!this.main()?.querySelector('[data-testid="media-editor"]') || !!document.querySelector('[role="dialog"]');
  }

}
