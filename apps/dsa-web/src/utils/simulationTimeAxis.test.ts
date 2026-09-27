import { describe, expect, it } from 'vitest';
import { simulationTimeTicks } from './simulationTimeAxis';

describe('simulation time axis', () => {
  it('keeps the actual reset time, including seconds, instead of rounding to a calendar tick', () => {
    const start = Date.parse('2026-09-26T16:30:04.191979Z');
    const end = Date.parse('2026-09-27T03:11:00Z');
    const ticks = simulationTimeTicks([end, Number.NaN, start]);
    expect(ticks[0]).toBe(start);
    expect(ticks.at(-1)).toBe(end);
    expect(ticks.every((tick, index) => !index || tick > ticks[index - 1])).toBe(true);
  });
  it('uses visible observations after a date filter and does not invent an earlier baseline', () => {
    const start = Date.parse('2026-10-01T07:12:00Z');
    expect(simulationTimeTicks([start, start + 3_600_000])[0]).toBe(start);
  });
  it('handles empty, single-point and sub-minute histories', () => {
    expect(simulationTimeTicks([NaN, Infinity])).toEqual([]);
    expect(simulationTimeTicks([1000,1000])).toEqual([1000]);
    expect(simulationTimeTicks([1000,2000])).toEqual([1000,2000]);
  });
});
