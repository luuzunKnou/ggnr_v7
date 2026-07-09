import type { NextRequest } from 'next/server';

export function resolveRequestClientMeta(req: NextRequest): { ip?: string; clientHost?: string } {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || undefined;
  const host = req.headers.get('host')?.trim() || undefined;
  return { ip, clientHost: host };
}
