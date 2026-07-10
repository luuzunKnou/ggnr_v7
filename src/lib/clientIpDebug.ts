const LOG_PREFIX = '[mvh-ip]';

export type Ipv4Kind = 'empty' | 'invalid' | 'loopback' | 'private' | 'public';

export function describeIpv4(ip?: string | null): { value?: string; kind: Ipv4Kind } {
  if (!ip?.trim()) return { kind: 'empty' };
  const v = ip.trim();
  const parts = v.split('.');
  const ipv4 =
    parts.length === 4 &&
    parts.every((p) => {
      const n = Number(p);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  if (!ipv4) return { value: v, kind: 'invalid' };
  if (v === '0.0.0.0') return { value: v, kind: 'invalid' };
  const lower = v.toLowerCase();
  if (lower === '127.0.0.1' || lower.startsWith('127.') || lower === 'localhost') {
    return { value: v, kind: 'loopback' };
  }
  const n = parts.map(Number);
  if (n[0] === 10) return { value: v, kind: 'private' };
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return { value: v, kind: 'private' };
  if (n[0] === 192 && n[1] === 168) return { value: v, kind: 'private' };
  return { value: v, kind: 'public' };
}

export function logMvhIp(scope: string, payload: Record<string, unknown>): void {
  console.log(LOG_PREFIX, scope, payload);
}
