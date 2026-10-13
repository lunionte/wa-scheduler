import { z } from 'zod';

export const recipientSchema = z.object({
  phone: z.string().regex(/^\d{7,15}$/).optional(),
  chatId: z.string().regex(/^(?:\d{7,15}@c\.us|\d{7,20}@lid)$/).optional(),
  label: z.string().min(1).max(200),
}).refine(value => !!value.phone || !!value.chatId, 'Conversa não identificada.');
export const timingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('once'),
    at: z.number().int().positive(),
    window: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).optional(),
  }),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(525600) }),
]);
export const scheduleInputSchema = z.object({
  recipient: recipientSchema,
  message: z.string().max(10000).refine((value) => value.trim().length > 0, 'Escreva uma mensagem.'),
  timing: timingSchema,
});
export const scheduleSchema = scheduleInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.number(),
  updatedAt: z.number(),
  anchorAt: z.number(),
  nextAt: z.number().nullable(),
  state: z.enum(['active', 'paused', 'finished']),
});
export const resultSchema = z.object({
  status: z.enum(['sent', 'missed', 'failed', 'uncertain']),
  reason: z.string().max(500),
  unsafe: z.boolean().optional(),
});
export const occurrenceSchema = z.object({
  id: z.string(),
  scheduleId: z.string(),
  recipient: recipientSchema,
  scheduledAt: z.number(),
  completedAt: z.number(),
  result: resultSchema,
});
export const databaseSchema = z.object({
  version: z.literal(1),
  schedules: z.array(scheduleSchema),
  history: z.array(occurrenceSchema),
  inFlight: z.object({
    id: z.string(), scheduleId: z.string(), scheduledAt: z.number(),
    recipient: recipientSchema,
  }).nullable(),
});
export type Recipient = z.infer<typeof recipientSchema>;
export const recipientKey = (recipient: Recipient): string => recipient.chatId ?? `${recipient.phone}@c.us`;
export const sameRecipient = (a: Recipient, b: Recipient): boolean => recipientKey(a) === recipientKey(b);
export type Timing = z.infer<typeof timingSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type SendResult = z.infer<typeof resultSchema>;
export type Occurrence = z.infer<typeof occurrenceSchema>;
export type Database = z.infer<typeof databaseSchema>;
export const emptyDatabase = (): Database => ({ version: 1, schedules: [], history: [], inFlight: null });
export const MAX_LATENESS_MS = 60_000;
export const HISTORY_LIMIT = 200;
