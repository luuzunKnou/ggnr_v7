import type { NextRequest } from 'next/server';

export function normalizeClientIp(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v) return undefined;
  if (v.startsWith('::ffff:')) return v.slice(7);
  if (v === '::1') return '127.0.0.1';
  return v;
}

export function isLoopbackIp(ip?: string | null): boolean {
  if (!ip) return true;
  const v = ip.trim().toLowerCase();
  if (!v || v === 'localhost') return true;
  if (v === '::1' || v === '127.0.0.1') return true;
  if (v.startsWith('127.')) return true;
  return false;
}

export function isIpv4(ip?: string | null): boolean {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

/** Host 헤더(예: 192.168.1.10:3001)에서 IPv4만 추출 */
export function extractIpv4FromHost(hostHeader?: string | null): string | undefined {
  if (!hostHeader) return undefined;
  const host = hostHeader.split(':')[0]?.trim() ?? '';
  return isIpv4(host) ? host : undefined;
}

/**
 * 브라우저 사용자 IPv4 선택
 * 1) 서버가 본 비루프백 IP (다른 PC·LAN 접속)
 * 2) body WebRTC 등으로 온 비루프백 IPv4 (localhost 개발)
 * body IP가 Host(접속 서버 주소)와 같으면 제외
 */
export function pickClientIp(
  serverIp?: string,
  bodyIp?: string,
  requestHost?: string | null
): string | undefined {
  const server = normalizeClientIp(serverIp);
  let client = normalizeClientIp(bodyIp);
  const hostIp = extractIpv4FromHost(requestHost);

  if (client && hostIp && client === hostIp) {
    client = undefined;
  }

  if (server && !isLoopbackIp(server) && isIpv4(server)) return server;
  if (client && !isLoopbackIp(client) && isIpv4(client)) return client;
  if (server && isIpv4(server)) return server;
  if (client && isIpv4(client)) return client;
  return undefined;
}

export function resolveRequestClientMeta(req: NextRequest): { ip?: string } {
  const forwarded = req.headers.get('x-forwarded-for');
  const fromForwarded = forwarded?.split(',')[0]?.trim();
  const fromReal = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const reqWithIp = req as NextRequest & { ip?: string };
  const fromReq = reqWithIp.ip?.trim();

  const ip = pickClientIp(fromForwarded || fromReal || fromCf || fromReq, undefined, req.headers.get('host'));
  return { ip };
}

export function pickClientIpFromRequest(req: NextRequest, bodyIp?: string): string | undefined {
  const meta = resolveRequestClientMeta(req);
  return pickClientIp(meta.ip, bodyIp, req.headers.get('host'));
}
