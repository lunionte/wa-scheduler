import { z } from 'zod';
import { recipientSchema, scheduleInputSchema } from './model';
import type { Database, Recipient, SendResult } from './model';

export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('WA_SCHEDULER_SNAPSHOT') }),
  z.object({ type: z.literal('WA_SCHEDULER_SAVE'), input: scheduleInputSchema, id: z.string().uuid().optional() }),
  z.object({ type: z.literal('WA_SCHEDULER_PAUSE'), id: z.string().uuid(), paused: z.boolean() }),
  z.object({ type: z.literal('WA_SCHEDULER_DELETE'), id: z.string().uuid() }),
]);
export type Request = z.infer<typeof requestSchema>;
export type Response = { ok: true; database: Database } | { ok: false; error: string };
export type ProbeResponse = { ready: boolean; recipient: Recipient | null };
export const probeResponseSchema = z.object({ ready: z.boolean(), recipient: recipientSchema.nullable() });
export const sendCommandSchema = z.object({
  type: z.literal('WA_SCHEDULER_SEND'), occurrenceId: z.string(),
  recipient: recipientSchema, message: z.string().min(1).max(10000),
  deadline: z.number(),
});
export type SendCommand = z.infer<typeof sendCommandSchema>;
export type TabResponse = ProbeResponse | SendResult;
