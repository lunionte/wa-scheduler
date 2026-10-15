import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePhone, readComposer, WhatsAppAdapter } from '../src/content/adapter';

let adapter: WhatsAppAdapter;
let editor: HTMLElement;
let button: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="main"><header><button><span title="Teste">Teste</span></button></header><div id="messages"></div><footer><div contenteditable="true" role="textbox"></div><button id="send"><span data-icon="send"></span></button></footer></div>';
  editor = document.querySelector('[contenteditable]')!;
  button = document.querySelector('#send')!;
  adapter = new WhatsAppAdapter();

});

describe('adaptador da interface', () => {
  it('não trata o parágrafo vazio do editor como um rascunho', () => {
    editor.innerHTML = '<p><br></p>';
    Object.defineProperty(editor, 'innerText', { configurable: true, value: '\n' });
    expect(readComposer(editor)).toBe('');
  });
  it('localiza a conversa sem depender do id main e aceita ícones atualizados', () => {
    document.querySelector('#main')!.removeAttribute('id');
    button.querySelector('span')!.setAttribute('data-icon', 'microphone-refreshed');
    expect(adapter.editor()).toBe(editor);
    expect(adapter.main()?.querySelector('header')).not.toBeNull();
    expect(adapter.actionAnchor()).toBe(button);
  });
  it('aceita compositor sem footer usando o textbox e o botão semântico de áudio', () => {
    const footer = document.querySelector('footer')!;
    const toolbar = document.createElement('div');
    toolbar.append(...footer.childNodes); footer.replaceWith(toolbar);
    editor.setAttribute('aria-label', 'Digite uma mensagem');
    button.innerHTML = '<svg></svg>'; button.setAttribute('aria-label', 'Mensagem de voz');
    expect(adapter.footer()).toBe(toolbar);
    expect(adapter.actionAnchor()).toBe(button);
  });
  it('não confunde a busca lateral com o compositor da conversa', () => {
    document.querySelector('#main')!.remove();
    document.body.innerHTML = '<div><header>Conversas</header><div contenteditable="true" role="textbox" aria-label="Pesquisar" data-tab="3"></div><button aria-label="Enviar"></button></div>';
    expect(adapter.editor()).toBeNull();
    expect(adapter.actionAnchor()).toBeNull();
  });
  it('normaliza telefones sem aceitar títulos ou identificadores arbitrários', () => {
    expect(normalizePhone('+55 (11) 99999-9999')).toBe('5511999999999');
    expect(normalizePhone('Contato 5511999999999')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
  it('usa o runtime, mesmo com hashes opacos no DOM, sem abrir informações', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ ready: true, recipient: { label: 'Teste', chatId: '123456789012345@lid' } })) } });
    adapter = new WhatsAppAdapter();
    document.querySelector('#messages')!.innerHTML = '<div data-id="A901F559"></div>';
    const click = vi.spyOn(document.querySelector<HTMLElement>('header button')!, 'click');
    expect(await adapter.resolveRecipient()).toEqual({ label: 'Teste', chatId: '123456789012345@lid' });
    expect(click).not.toHaveBeenCalled();
  });
  it('bloqueia preparações de resposta mas ignora citações no histórico', () => {
    document.querySelector('#messages')!.innerHTML = '<div data-testid="quoted-message"></div>';
    expect(adapter.unsupportedDraft()).toBe(false);
    document.querySelector('footer')!.insertAdjacentHTML('beforeend', '<div data-testid="compose-quoted-message"></div>');
    expect(adapter.unsupportedDraft()).toBe(true);
  });
  it('uma consulta antiga não libera nem substitui a verificação forçada mais recente', async () => {
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    const sendMessage = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { first = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const previous = adapter.resolveRecipient();
    const fresh = adapter.resolveRecipient(true);
    first({ ready: true, recipient: { phone: '5511999999999', label: 'Anterior' } });
    await previous;
    const shared = adapter.resolveRecipient();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    second({ ready: true, recipient: { phone: '5511888888888', label: 'Atual' } });
    expect((await fresh)?.phone).toBe('5511888888888');
    expect(await shared).toEqual(await fresh);
  });
});
