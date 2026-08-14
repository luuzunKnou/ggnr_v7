/** Edge·Node 공통 — Node 전용 모듈(fs/os) 없이 IP 문자열만 정규화 */
export function normalizeClientIp(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (v.startsWith('::ffff:')) return v.slice(7);
  if (v === '::1') return '127.0.0.1';
  return v;
}
