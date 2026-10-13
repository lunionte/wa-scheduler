import { describe, expect, it } from 'vitest';
import { firstAt, nextAfter, parseLocalDateTime, randomMinute, validateTiming } from '../src/core/time';
import type { Schedule } from '../src/core/model';

describe('datas e intervalos', () => {
  it('rejeita datas inexistentes e formatos incompletos', () => {
    expect(() => parseLocalDateTime('2026-02-30', '12:00')).toThrow();
    expect(() => parseLocalDateTime('2026-12-01', '25:00')).toThrow();
    expect(() => parseLocalDateTime('2026-12-01', '5:30')).toThrow();
    const date = new Date(parseLocalDateTime('2026-12-01', '05:32'));
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 11, 1, 5, 32]);
  });
  it('sorteia minutos incluindo os dois limites', () => {
    const start = parseLocalDateTime('2026-12-01', '05:00');
    const end = parseLocalDateTime('2026-12-01', '05:40');
    expect(randomMinute(start, end, () => 0)).toBe(start);
    expect(randomMinute(start, end, () => .9999)).toBe(end);
    expect(randomMinute(start, end, () => 32 / 41)).toBe(start + 32 * 60000);
    expect(randomMinute(start, start, () => .5)).toBe(start);
  });
  it('rejeita janelas invertidas, em outro dia ou no passado', () => {
    const start = parseLocalDateTime('2026-12-01', '05:00');
    expect(() => randomMinute(start + 60000, start)).toThrow();
    expect(() => randomMinute(start, start + 86400000)).toThrow();
    expect(() => validateTiming({ kind: 'once', at: start }, start)).toThrow();
    expect(() => validateTiming({ kind: 'once', at: start + 60000, window: { start, end: start + 120000 } }, start)).toThrow();
    expect(() => validateTiming({ kind: 'once', at: start + 180000, window: { start, end: start + 120000 } }, start - 60000)).toThrow();
  });
  it('envia primeiro após o intervalo e mantém a cadência após atrasos', () => {
    expect(firstAt({ kind: 'interval', minutes: 120 }, 1000)).toBe(7201000);
    const schedule = { timing: { kind: 'interval', minutes: 2 }, anchorAt: 1000 } as Schedule;
    expect(nextAfter(schedule, 401000)).toBe(481000);
    expect(nextAfter(schedule, 121000)).toBe(241000);
  });
});
