import type { Schedule, Timing } from './model';

export function parseLocalDateTime(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('Informe data e hora válidas.');
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day ||
      value.getHours() !== hour || value.getMinutes() !== minute) {
    throw new Error('Esta data ou hora não existe no fuso do sistema.');
  }
  return value.getTime();
}

export function randomMinute(start: number, end: number, random: () => number = Math.random): number {
  if (end < start || start % 60000 || end % 60000) throw new Error('Janela de horário inválida.');
  const a = new Date(start), b = new Date(end);
  if (a.toDateString() !== b.toDateString()) throw new Error('A janela deve ficar no mesmo dia.');
  return start + Math.floor(random() * ((end - start) / 60000 + 1)) * 60000;
}

export function validateTiming(timing: Timing, now: number): void {
  if (timing.kind === 'interval') return;
  if (timing.at <= now) throw new Error('Escolha um horário futuro.');
  if (timing.window) {
    const { start, end } = timing.window;
    randomMinute(start, end, () => 0);
    if (start <= now || timing.at < start || timing.at > end || timing.at % 60000) {
      throw new Error('A janela e o horário sorteado precisam estar no futuro.');
    }
  }
}

export function firstAt(timing: Timing, now: number): number {
  return timing.kind === 'once' ? timing.at : now + timing.minutes * 60000;
}

export function nextAfter(schedule: Schedule, now: number): number | null {
  if (schedule.timing.kind === 'once') return null;
  const period = schedule.timing.minutes * 60000;
  return schedule.anchorAt + (Math.floor((now - schedule.anchorAt) / period) + 1) * period;
}

export const formatDateTime = (at: number) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short',
}).format(at);
