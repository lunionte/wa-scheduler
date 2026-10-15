import { z } from 'zod';
import { databaseSchema, recipientSchema, scheduleInputSchema } from './model';
import type { Recipient, SendResult } from './model';

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WA_SCHEDULER_SNAPSHOT') }),
  z.object({ type: z.literal('WA_SCHEDULER_SAVE'), input: scheduleInputSchema, id: z.string().uuid().optional() }),
  z.object({ type: z.literal('WA_SCHEDULER_PAUSE'), id: z.string().uuid(), paused: z.boolean() }),
  z.object({ type: z.literal('WA_SCHEDULER_DELETE'), id: z.string().uuid() }),
  z.object({ type: z.literal('WA_SCHEDULER_SETTINGS'), autoDeleteFinished: z.boolean() }),
]);
export type Request = z.infer<typeof requestSchema>;
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), database: databaseSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type Response = z.infer<typeof responseSchema>;

export function parseResponse(raw: unknown): Response {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Dados recebidos incompatíveis. Recarregue a extensão e o WhatsApp Web.');
  return parsed.data;
}
export type ProbeResponse = { ready: boolean; recipient: Recipient | null };
export const probeResponseSchema = z.object({ ready: z.boolean(), recipient: recipientSchema.nullable() });
export const sendCommandSchema = z.object({
  type: z.literal('WA_SCHEDULER_SEND'), occurrenceId: z.string(),
  recipient: recipientSchema, message: z.string().min(1).max(10000),
  deadline: z.number(),
});
export type SendCommand = z.infer<typeof sendCommandSchema>;
export type TabResponse = ProbeResponse | SendResult;
