/** Format percentage-point ticks using the visible range and the axis's zero baseline. */
export function simulationPercentTickFormatter(values: Iterable<number | null | undefined>, locale: string) {
  let minimum = 0;
  let maximum = 0;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const span = maximum - minimum;
  // Five automatic ticks need enough precision to distinguish adjacent values.
  const digits = span > 0 ? Math.max(1, Math.ceil(-Math.log10(span / 5))) : 1;
  return (value: number) => {
    if (!Number.isFinite(value)) return '—';
    if (digits > 6 && value !== 0) return `${value.toLocaleString(locale, {notation:'scientific',maximumSignificantDigits:4})}%`;
    const precision = Math.min(6, digits);
    const rounded = Number(value.toFixed(precision));
    return `${(rounded === 0 ? 0 : rounded).toLocaleString(locale, {minimumFractionDigits:precision,maximumFractionDigits:precision})}%`;
  };
}
