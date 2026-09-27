/** Explicit endpoints prevent the time scale from replacing the first observation
 * with its next rounded calendar tick. Only the axis changes; observations do not.
 */
export function simulationTimeTicks(times: readonly number[]): number[] {
  const valid = times.filter(Number.isFinite);
  if (!valid.length) return [];
  const start = valid.reduce((minimum, time) => Math.min(minimum, time), Infinity);
  const end = valid.reduce((maximum, time) => Math.max(maximum, time), -Infinity);
  if (start === end) return [start];
  // Minute resolution matches the labels; keep short ranges from repeating them.
  const intervals = Math.min(4, Math.max(1, Math.floor((end - start) / 60_000)));
  return Array.from({ length: intervals + 1 }, (_, index) =>
    index === intervals ? end : start + ((end - start) * index) / intervals,
  );
}
