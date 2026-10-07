/** V6 maskAllByLength — 길이만큼 * (최소 3자) */
export function maskPersonFieldByLength(value: unknown): string {
  if (value == null) return '***';
  const str = String(value).trim();
  if (!str || str === '-') return str || '-';
  return '*'.repeat(Math.max(str.length, 3));
}
