import { recipientSchema, sameRecipient, type Recipient, type SendResult } from '../core/model';
import { sendCommandSchema, type SendCommand, type ProbeResponse } from '../core/protocol';

export interface ActiveChat {
  id: { _serialized: string };
  name?: string; formattedTitle?: string;
  isGroup?: boolean; isBroadcast?: boolean; isNewsletter?: boolean;
  isReadOnly?: boolean; canSend?: boolean;
  recording?: unknown; composeQuotedMsg?: unknown; attachMediaContents?: unknown;
}
export interface SchedulerSdk {
  readonly isReady: boolean;
  conn: { isAuthenticated(): boolean; isOnline(): boolean };
  chat: {
    getActiveChat(): ActiveChat | undefined;
    sendTextMessage(id: string, text: string, options: {
      waitForAck: boolean; detectMentioned: boolean; markIsRead: boolean; linkPreview: boolean; delay: number;
    }): Promise<{ id: string; ack: number; sendMsgResult: { messageSendResult?: string } | null }>;
  };
}
export interface PageApi {
  identify(): ProbeResponse;
  send(command: SendCommand): Promise<SendResult>;
}
declare global { interface Window { __waSchedulerPageV1?: PageApi } }

function hasAttachments(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function createPageApi(sdk: SchedulerSdk, now = Date.now, ackTimeout = 15000, composerAvailable = () => true): PageApi {
  const attempts = new Map<string, Promise<SendResult>>();
  let sending = false;
  const uncertain = (): SendResult => ({ status: 'uncertain', unsafe: true,
    reason: 'O envio foi iniciado, mas não houve confirmação. Confira a conversa antes de retomar.' });
  function active(): { chat: ActiveChat; recipient: Recipient } | null {
    if (!sdk.isReady || !sdk.conn.isAuthenticated()) return null;
    const chat = sdk.chat.getActiveChat();
    if (!chat || chat.isGroup || chat.isBroadcast || chat.isNewsletter) return null;
    const chatId = chat.id._serialized.replace('@s.whatsapp.net', '@c.us');
    const fallback = chatId.endsWith('@c.us') ? `+${chatId.split('@')[0]}` : 'Conversa individual';
    const label = (chat.formattedTitle || chat.name || fallback).slice(0, 200);
    const parsed = recipientSchema.safeParse({ chatId, label,
      ...(chatId.endsWith('@c.us') ? { phone: chatId.split('@')[0] } : {}) });
    return parsed.success ? { chat, recipient: parsed.data } : null;
  }
  function identify(): ProbeResponse {
    try {
      const current = active();
      return { recipient: current?.recipient ?? null,
        ready: !!current && sdk.conn.isOnline() && composerAvailable() && current.chat.canSend !== false && !current.chat.isReadOnly };
    } catch { return { ready: false, recipient: null }; }
  }
  async function perform(command: SendCommand): Promise<SendResult> {
    if (sending) return { status: 'missed', reason: 'A extensão já estava enviando outra mensagem.' };
    let initiated = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = active();
      if (!current || !sameRecipient(current.recipient, command.recipient) || !sdk.conn.isOnline() || !composerAvailable() ||
          current.chat.isReadOnly || current.chat.canSend === false || current.chat.recording ||
          current.chat.composeQuotedMsg || hasAttachments(current.chat.attachMediaContents) || now() > command.deadline) {
        return { status: 'missed', reason: 'A conversa agendada não estava selecionada e disponível.' };
      }
      // No await between the active-chat check and dispatch. The compositor is
      // never edited, focused, cleared or restored by the scheduler.
      sending = true; initiated = true;
      const outcome = await Promise.race([
        sdk.chat.sendTextMessage(current.recipient.chatId!, command.message, {
          waitForAck: true, detectMentioned: false, markIsRead: false, linkPreview: false, delay: 0,
        }),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ackTimeout); }),
      ]);
      return outcome && outcome.id && (outcome.ack >= 1 || outcome.sendMsgResult?.messageSendResult === 'OK') ?
        { status: 'sent', reason: 'WhatsApp confirmou o envio da mensagem.' } : uncertain();
    } catch {
      return initiated ? uncertain() : { status: 'missed', reason: 'Não foi possível confirmar a conversa ativa.' };
    } finally { if (timer) clearTimeout(timer); if (initiated) sending = false; }
  }
  return Object.freeze({ identify, send(raw: SendCommand): Promise<SendResult> {
    const parsed = sendCommandSchema.safeParse(raw);
    if (!parsed.success) return Promise.resolve({ status: 'failed', reason: 'Comando de envio inválido.' });
    const command = parsed.data;
    const previous = attempts.get(command.occurrenceId);
    if (previous) return previous;
    const job = perform(command);
    attempts.set(command.occurrenceId, job);
    // The worker also persists occurrences before dispatch; retain recent
    // promises here to deduplicate simultaneous and repeated tab requests.
    if (attempts.size > 200) attempts.delete(attempts.keys().next().value!);
    return job;
  } });
}
