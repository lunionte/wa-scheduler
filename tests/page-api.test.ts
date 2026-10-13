import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageApi, type ActiveChat, type SchedulerSdk } from '../src/integration/page-api';
import type { SendCommand } from '../src/core/protocol';

let chat: ActiveChat | undefined;
let sdk: SchedulerSdk;
const command = (): SendCommand => ({ type: 'WA_SCHEDULER_SEND', occurrenceId: 'occurrence:1',
  recipient: { phone: '5511999999999', label: 'Teste' }, message: 'Agendada 👋\nsegunda linha', deadline: Date.now() + 60000 });
beforeEach(() => {
  chat = { id: { _serialized: '5511999999999@c.us' }, name: 'Teste', canSend: true };
  sdk = { isReady: true, conn: { isAuthenticated: vi.fn(() => true), isOnline: vi.fn(() => true) },
    chat: { getActiveChat: vi.fn(() => chat), sendTextMessage: vi.fn(async () => ({ id: 'message-hash', ack: 1, sendMsgResult: null })) } };
  document.body.innerHTML = '<div contenteditable="true">Rascunho 🙌\nsegunda linha\n</div>';
});
describe('integração da conversa ativa', () => {
  it('identifica sem mensagens no DOM e sem abrir a ficha', () => {
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    expect(createPageApi(sdk).identify()).toEqual({ ready: true, recipient: { label: 'Teste', phone: '5511999999999', chatId: '5511999999999@c.us' } });
    expect(click).not.toHaveBeenCalled();
  });
  it('ignora hashes e citações no DOM; aceita LID sem inventar um telefone', () => {
    document.body.innerHTML += '<div data-id="A9F114E4"><div data-jid="5511888888888@c.us"></div></div>';
    chat!.id._serialized = '123456789012345@lid';
    expect(createPageApi(sdk).identify().recipient).toEqual({ label: 'Teste', chatId: '123456789012345@lid' });
  });
  it('não mostra um ID LID como nome quando não há título disponível', () => {
    chat = { id: { _serialized: '123456789012345@lid' } };
    expect(createPageApi(sdk).identify().recipient?.label).toBe('Conversa individual');
  });
  it.each(['123456789@g.us', '123456789@broadcast', '123456789@newsletter', 'hash'])('rejeita identidade %s', id => {
    chat!.id._serialized = id;
    expect(createPageApi(sdk).identify().recipient).toBeNull();
  });
  it('aguarda a biblioteca e autenticação; desconexão impede prontidão', () => {
    const api = createPageApi(sdk);
    Object.assign(sdk, { isReady: false }); expect(api.identify().recipient).toBeNull();
    Object.assign(sdk, { isReady: true }); vi.mocked(sdk.conn.isAuthenticated).mockReturnValue(false);
    expect(api.identify().recipient).toBeNull();
    vi.mocked(sdk.conn.isAuthenticated).mockReturnValue(true); vi.mocked(sdk.conn.isOnline).mockReturnValue(false);
    expect(api.identify().ready).toBe(false);
  });
  it('envia diretamente e deixa texto, foco e estrutura do rascunho intactos', async () => {
    const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
    editor.focus(); const original = editor.outerHTML;
    expect((await createPageApi(sdk).send(command())).status).toBe('sent');
    expect(editor.outerHTML).toBe(original); expect(document.activeElement).toBe(editor);
    expect(sdk.chat.sendTextMessage).toHaveBeenCalledWith('5511999999999@c.us', command().message,
      { waitForAck: true, detectMentioned: false, markIsRead: false, linkPreview: false, delay: 0 });
  });
  it('revalida o destinatário após o probe e não envia em conversa diferente', async () => {
    const api = createPageApi(sdk); expect(api.identify().ready).toBe(true);
    chat!.id._serialized = '5511888888888@c.us';
    expect((await api.send(command())).status).toBe('missed'); expect(sdk.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it.each(['recording', 'composeQuotedMsg', 'attachMediaContents', 'isReadOnly'])('pula preparação incompatível: %s', field => {
    Object.assign(chat!, { [field]: { pending: true } });
    return createPageApi(sdk).send(command()).then(result => {
      expect(result.status).toBe('missed'); expect(sdk.chat.sendTextMessage).not.toHaveBeenCalled();
    });
  });
  it('não bloqueia listas ou objetos de anexos vazios', async () => {
    chat!.attachMediaContents = [];
    expect((await createPageApi(sdk).send(command())).status).toBe('sent');
    chat!.attachMediaContents = {};
    expect((await createPageApi(sdk).send(command())).status).toBe('sent');
  });
  it('pula comandos vencidos, desconexão e compositor bloqueado', async () => {
    expect((await createPageApi(sdk).send({ ...command(), deadline: 1 })).status).toBe('missed');
    vi.mocked(sdk.conn.isOnline).mockReturnValue(false);
    expect((await createPageApi(sdk).send(command())).status).toBe('missed');
    vi.mocked(sdk.conn.isOnline).mockReturnValue(true);
    expect((await createPageApi(sdk, Date.now, 10, () => false).send(command())).status).toBe('missed');
    expect(sdk.chat.sendTextMessage).not.toHaveBeenCalled();
  });
  it('deduplica inclusive enquanto espera confirmação', async () => {
    let finish!: (value: { id: string; ack: number; sendMsgResult: null }) => void;
    vi.mocked(sdk.chat.sendTextMessage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const api = createPageApi(sdk); const first = api.send(command()), second = api.send(command());
    expect(first).toBe(second); expect(sdk.chat.sendTextMessage).toHaveBeenCalledTimes(1);
    finish({ id: 'msg', ack: 1, sendMsgResult: null }); await first;
    await api.send(command()); expect(sdk.chat.sendTextMessage).toHaveBeenCalledTimes(1);
  });
  it('não interpreta ACK pendente como sucesso nem repete envio incerto', async () => {
    vi.mocked(sdk.chat.sendTextMessage).mockResolvedValue({ id: 'msg', ack: 0, sendMsgResult: null });
    const api = createPageApi(sdk);
    expect(await api.send(command())).toMatchObject({ status: 'uncertain', unsafe: true });
    await api.send(command()); expect(sdk.chat.sendTextMessage).toHaveBeenCalledTimes(1);
  });
  it('timeout e rejeição após despacho são incertos; não vazam detalhes internos', async () => {
    vi.mocked(sdk.chat.sendTextMessage).mockImplementation(() => new Promise(() => {}));
    expect(await createPageApi(sdk, Date.now, 5).send(command())).toMatchObject({ status: 'uncertain', unsafe: true });
    vi.mocked(sdk.chat.sendTextMessage).mockRejectedValue(new Error('dados privados'));
    const result = await createPageApi(sdk).send(command());
    expect(result.status).toBe('uncertain'); expect(result.reason).not.toContain('dados privados');
  });
});
