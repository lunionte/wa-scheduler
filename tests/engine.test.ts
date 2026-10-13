import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SchedulerEngine, type EngineDependencies } from '../src/core/engine';
import { emptyDatabase } from '../src/core/model';
import type { Database, ScheduleInput, SendResult } from '../src/core/model';

const recipient = { phone: '5511999999999', label: 'Contato teste' };
const input = (timing: ScheduleInput['timing']): ScheduleInput => ({ recipient, message: 'Olá 👋\nComo vai?', timing });
let db: Database;
let now: number;
let count: number;
let send: Mock<EngineDependencies['send']>;
let arm: Mock<EngineDependencies['arm']>;
let engine: SchedulerEngine;
function createEngine() {
  return new SchedulerEngine({
    load: async () => structuredClone(db),
    persist: async value => { db = structuredClone(value); },
    arm, send, now: () => now,
    uuid: () => `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
  });
}
beforeEach(() => {
  db = emptyDatabase(); now = 100000; count = 0;
  send = vi.fn(async (): Promise<SendResult> => ({ status: 'sent', reason: 'confirmado' }));
  arm = vi.fn(async () => {});
  engine = createEngine();
});

describe('motor persistente', () => {
  it('persiste o horário sorteado e reconstrói o alarme sem ressorteio', async () => {
    await engine.save(input({ kind: 'once', at: 180000, window: { start: 120000, end: 240000 } }));
    await createEngine().recover();
    expect(db.schedules[0]?.nextAt).toBe(180000);
    expect(arm).toHaveBeenLastCalledWith(180000);
  });
  it('aceita vários agendamentos e dispara o mais próximo', async () => {
    await engine.save(input({ kind: 'once', at: 200000 }));
    await engine.save(input({ kind: 'once', at: 150000 }));
    expect(db.schedules).toHaveLength(2);
    expect(arm).toHaveBeenLastCalledWith(150000);
  });
  it('processa uma ocorrência apenas uma vez mesmo com ticks concorrentes', async () => {
    await engine.save(input({ kind: 'once', at: 160000 })); now = 160000;
    await Promise.all([engine.tick(), engine.tick(), engine.tick()]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.history).toHaveLength(1);
    expect(db.schedules[0]?.state).toBe('finished');
    expect(db.inFlight).toBeNull();
  });
  it('persiste a intenção antes de tocar na aba', async () => {
    send.mockImplementation(async () => {
      expect(db.inFlight?.scheduledAt).toBe(160000);
      return { status: 'sent', reason: 'confirmado' };
    });
    await engine.save(input({ kind: 'once', at: 160000 })); now = 160000;
    await engine.tick();
  });
  it('pula horários vencidos, sem acumular mensagens, preservando cadência', async () => {
    await engine.save(input({ kind: 'interval', minutes: 2 })); now = 1000000;
    await engine.tick();
    expect(send).not.toHaveBeenCalled();
    expect(db.history[0]?.result.status).toBe('missed');
    expect(db.schedules[0]?.nextAt).toBe(1060000);
    expect(db.schedules[0]?.state).toBe('active');
  });
  it('admite até 60 segundos de atraso e pula após isso', async () => {
    await engine.save(input({ kind: 'once', at: 160000 })); now = 220000;
    await engine.tick(); expect(send).toHaveBeenCalledTimes(1);
    await engine.save(input({ kind: 'once', at: 300000 })); now = 360001;
    await engine.tick(); expect(send).toHaveBeenCalledTimes(1);
    expect(db.history.at(-1)?.result.status).toBe('missed');
  });
  it('conversa errada perde somente a ocorrência, mantendo a recorrência', async () => {
    send.mockResolvedValue({ status: 'missed', reason: 'outra conversa' });
    await engine.save(input({ kind: 'interval', minutes: 1 })); now = 160000;
    await engine.tick();
    expect(db.schedules[0]?.state).toBe('active');
    expect(db.schedules[0]?.nextAt).toBe(220000);
  });
  it('pausa quando o envio não é confirmado, sem retry', async () => {
    send.mockRejectedValue(new Error('porta fechada'));
    await engine.save(input({ kind: 'interval', minutes: 1 })); now = 160000;
    await engine.tick(); now = 280000; await engine.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.schedules[0]?.state).toBe('paused');
    expect(db.history[0]?.result.status).toBe('uncertain');
  });
  it('recupera interrupção como incerta e não reenvia', async () => {
    await engine.save(input({ kind: 'interval', minutes: 1 }));
    const schedule = db.schedules[0]!;
    db.inFlight = { id: `${schedule.id}:160000`, scheduleId: schedule.id, scheduledAt: 160000, recipient };
    now = 160000; await createEngine().recover(); await engine.tick();
    expect(db.inFlight).toBeNull();
    expect(db.history[0]?.result.status).toBe('uncertain');
    expect(db.schedules[0]?.state).toBe('paused');
    expect(send).not.toHaveBeenCalled();
  });
  it('retoma contando o intervalo novamente e permite editar e excluir', async () => {
    await engine.save(input({ kind: 'interval', minutes: 2 }));
    const id = db.schedules[0]!.id;
    await engine.pause(id, true); expect(arm).toHaveBeenLastCalledWith(null);
    now = 200000; await engine.pause(id, false);
    expect(db.schedules[0]?.nextAt).toBe(320000);
    await engine.save({ ...input({ kind: 'interval', minutes: 3 }), message: 'Nova' }, id);
    expect(db.schedules).toHaveLength(1); expect(db.schedules[0]?.message).toBe('Nova');
    await engine.remove(id); expect(db.schedules).toHaveLength(0);
  });
  it('rejeita entradas inválidas e destinatário alterado', async () => {
    await expect(engine.save(input({ kind: 'interval', minutes: 0 }))).rejects.toThrow();
    await expect(engine.save({ ...input({ kind: 'once', at: 160000 }), message: '  ' })).rejects.toThrow();
    await engine.save(input({ kind: 'interval', minutes: 2 }));
    await expect(engine.save({ ...input({ kind: 'interval', minutes: 2 }), recipient: { phone: '5511888888888', label: 'Outro' } }, db.schedules[0]!.id)).rejects.toThrow();
  });
  it('preserva dados incompatíveis em vez de apagá-los', async () => {
    const incompatible = { version: 2, schedules: [] };
    const persist = vi.fn();
    const other = new SchedulerEngine({ load: async () => incompatible, persist, arm, send, now: () => now, uuid: () => '' });
    await expect(other.recover()).rejects.toThrow('Dados locais incompatíveis');
    expect(persist).not.toHaveBeenCalled();
  });
});
