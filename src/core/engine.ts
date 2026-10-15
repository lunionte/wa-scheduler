import { databaseSchema, emptyDatabase, HISTORY_LIMIT, MAX_LATENESS_MS, scheduleInputSchema, sameRecipient } from './model';
import type { Database, Schedule, ScheduleInput, SendResult } from './model';
import { firstAt, nextAfter, validateTiming } from './time';

export interface EngineDependencies {
  load(): Promise<unknown>;
  persist(database: Database): Promise<void>;
  arm(nextAt: number | null): Promise<void>;
  send(schedule: Schedule, occurrenceId: string, deadline: number): Promise<SendResult>;
  now(): number;
  uuid(): string;
}

export class SchedulerEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: EngineDependencies) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const job = this.queue.then(action);
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async read(): Promise<Database> {
    const raw = await this.deps.load();
    if (raw === undefined) return emptyDatabase();
    const parsed = databaseSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Dados locais incompatíveis. Nenhum agendamento foi alterado.');
    return parsed.data;
  }

  private async commit(db: Database): Promise<void> {
    if (db.settings.autoDeleteFinished) {
      db.schedules = db.schedules.filter(schedule => schedule.state !== 'finished' || schedule.id === db.inFlight?.scheduleId);
    }
    db.history = db.history.slice(-HISTORY_LIMIT);
    await this.deps.persist(db);
    const times = db.schedules.filter(s => s.state === 'active' && s.nextAt !== null).map(s => s.nextAt!);
    await this.deps.arm(times.length ? Math.min(...times) : null);
  }

  snapshot(): Promise<Database> { return this.serial(() => this.read()); }

  setAutoDeleteFinished(enabled: boolean): Promise<Database> {
    return this.serial(async () => {
      const db = await this.read();
      db.settings.autoDeleteFinished = enabled;
      await this.commit(db);
      return db;
    });
  }

  recover(): Promise<void> {
    return this.serial(async () => {
      const db = await this.read();
      if (db.inFlight) {
        const pending = db.inFlight;
        const schedule = db.schedules.find(s => s.id === pending.scheduleId);
        if (schedule) { schedule.state = 'paused'; schedule.updatedAt = this.deps.now(); }
        db.history.push({ ...pending, completedAt: this.deps.now(), result: {
          status: 'uncertain', reason: 'A extensão reiniciou durante o envio. Confira a conversa antes de retomar.', unsafe: true,
        } });
        db.inFlight = null;
      }
      await this.commit(db);
    });
  }

  save(raw: ScheduleInput, id?: string): Promise<Database> {
    return this.serial(async () => {
      const input = scheduleInputSchema.parse(raw);
      const now = this.deps.now();
      validateTiming(input.timing, now);
      const db = await this.read();
      const old = id ? db.schedules.find(s => s.id === id) : undefined;
      if (id && !old) throw new Error('Agendamento não encontrado.');
      if (old && !sameRecipient(old.recipient, input.recipient)) throw new Error('Não é possível trocar o destinatário.');
      const schedule: Schedule = {
        ...input, id: old?.id ?? this.deps.uuid(), createdAt: old?.createdAt ?? now,
        updatedAt: now, anchorAt: now, nextAt: firstAt(input.timing, now), state: 'active',
      };
      db.schedules = [...db.schedules.filter(s => s.id !== schedule.id), schedule];
      await this.commit(db);
      return db;
    });
  }

  pause(id: string, paused: boolean): Promise<Database> {
    return this.serial(async () => {
      const db = await this.read();
      const schedule = db.schedules.find(s => s.id === id);
      if (!schedule || schedule.timing.kind !== 'interval') throw new Error('Recorrência não encontrada.');
      const now = this.deps.now();
      schedule.state = paused ? 'paused' : 'active';
      schedule.updatedAt = now;
      if (!paused) { schedule.anchorAt = now; schedule.nextAt = firstAt(schedule.timing, now); }
      await this.commit(db);
      return db;
    });
  }

  remove(id: string): Promise<Database> {
    return this.serial(async () => {
      const db = await this.read();
      db.schedules = db.schedules.filter(s => s.id !== id);
      await this.commit(db);
      return db;
    });
  }

  tick(): Promise<void> {
    return this.serial(async () => {
      const db = await this.read();
      const due = db.schedules.filter(s => s.state === 'active' && s.nextAt !== null && s.nextAt <= this.deps.now())
        .sort((a, b) => a.nextAt! - b.nextAt! || a.createdAt - b.createdAt);
      for (const schedule of due) {
        const scheduledAt = schedule.nextAt!;
        const id = `${schedule.id}:${scheduledAt}`;
        if (db.history.some(h => h.id === id)) {
          schedule.nextAt = nextAfter(schedule, this.deps.now());
          if (schedule.nextAt === null) schedule.state = 'finished';
          continue;
        }
        let result: SendResult;
        if (this.deps.now() - scheduledAt > MAX_LATENESS_MS) {
          result = { status: 'missed', reason: 'Horário perdido: atraso superior a 60 segundos.' };
        } else {
          db.inFlight = { id, scheduleId: schedule.id, scheduledAt, recipient: schedule.recipient };
          await this.deps.persist(db);
          try { result = await this.deps.send(schedule, id, scheduledAt + MAX_LATENESS_MS); }
          catch { result = { status: 'uncertain', reason: 'Não foi possível confirmar o resultado do envio.', unsafe: true }; }
        }
        db.history.push({ id, scheduleId: schedule.id, recipient: schedule.recipient,
          scheduledAt, completedAt: this.deps.now(), result });
        db.inFlight = null;
        schedule.nextAt = nextAfter(schedule, this.deps.now());
        schedule.updatedAt = this.deps.now();
        if (result.unsafe || result.status === 'uncertain') schedule.state = 'paused';
        else if (schedule.nextAt === null) schedule.state = 'finished';
        await this.commit(db);
      }
      await this.commit(db);
    });
  }
}
