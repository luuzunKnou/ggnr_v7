import type { NextRequest } from 'next/server';
import { describeIpv4, logMvhIp } from '@/lib/clientIpDebug';
import { pickHostMachinePrivateIpv4 } from '@/lib/hostMachineIpv4';

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

export function isPrivateIpv4(ip?: string | null): boolean {
  if (!ip || !isIpv4(ip)) return false;
  const parts = ip.split('.').map((p) => Number(p));
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

/** 사설·루프백이 아닌 IPv4 (NAT/STUN 공인 IP 등) */
export function isPublicIpv4(ip?: string | null): boolean {
  if (!ip || !isIpv4(ip)) return false;
  return !isLoopbackIp(ip) && !isPrivateIpv4(ip);
}

/** Host 헤더(예: 192.168.1.10:3001)에서 IPv4만 추출 */
export function extractIpv4FromHost(hostHeader?: string | null): string | undefined {
  if (!hostHeader) return undefined;
  const host = hostHeader.split(':')[0]?.trim() ?? '';
  return isIpv4(host) ? host : undefined;
}

/**
 * 브라우저 사용자 PC IPv4 선택 (이력 기록용)
 * - body(WebRTC) 사설 IPv4 최우선
 * - 서버가 직접 본 사설 IPv4 (LAN 직접 접속)
 * - localhost 접속 시 서버 OS NIC (ipconfig) fallback
 * - 127.0.0.1·공인 IP·NAT srflx는 기록하지 않음
 */
export function pickClientIp(
  serverIp?: string,
  bodyIp?: string,
  requestHost?: string | null,
  debugScope = 'pickClientIp',
  options?: { osFallback?: boolean }
): string | undefined {
  const server = normalizeClientIp(serverIp);
  let client = normalizeClientIp(bodyIp);
  const hostIp = extractIpv4FromHost(requestHost);
  const steps: string[] = [];

  if (client && hostIp && client === hostIp) {
    steps.push(`body=${client} Host와 동일 → body 제외`);
    client = undefined;
  }
  if (client && isPublicIpv4(client)) {
    steps.push(`body=${client} 공인 IP → body 제외`);
    client = undefined;
  }
  if (client && isLoopbackIp(client)) {
    steps.push(`body=${client} 루프백 → body 제외`);
    client = undefined;
  }

  let effectiveServer = server;
  if (effectiveServer && isPublicIpv4(effectiveServer)) {
    steps.push(`server=${effectiveServer} 공인 IP → server 제외`);
    effectiveServer = undefined;
  }
  if (effectiveServer && isLoopbackIp(effectiveServer)) {
    steps.push(`server=${effectiveServer} 루프백 → server 제외`);
    effectiveServer = undefined;
  }

  let selected: string | undefined;
  let reason = '기록할 IP 없음';

  if (client && isPrivateIpv4(client)) {
    selected = client;
    reason = 'body 사설 IPv4 우선';
  } else if (effectiveServer && isPrivateIpv4(effectiveServer)) {
    selected = effectiveServer;
    reason = 'server 사설 IPv4 (LAN 직접 접속)';
  } else if (options?.osFallback) {
    const osNicIp = pickHostMachinePrivateIpv4();
    if (osNicIp && isPrivateIpv4(osNicIp)) {
      selected = osNicIp;
      reason = 'localhost 접속 — 서버 OS NIC 사설 IPv4 (ipconfig)';
    }
  }

  logMvhIp(debugScope, {
    inputs: {
      serverRaw: serverIp ?? null,
      server: describeIpv4(server),
      bodyRaw: bodyIp ?? null,
      body: describeIpv4(client ?? bodyIp),
      bodyAfterFilter: describeIpv4(client),
      hostHeader: requestHost ?? null,
      hostIp: describeIpv4(hostIp),
      serverEffective: describeIpv4(effectiveServer),
      osFallback: options?.osFallback ?? false,
    },
    steps,
    selected: describeIpv4(selected),
    reason,
  });

  return selected;
}

export function resolveRequestClientMeta(req: NextRequest): { ip?: string } {
  const forwarded = req.headers.get('x-forwarded-for');
  const fromForwarded = forwarded?.split(',')[0]?.trim();
  const fromReal = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const reqWithIp = req as NextRequest & { ip?: string };
  const fromReq = reqWithIp.ip?.trim();
  const serverIp = fromForwarded || fromReal || fromCf || fromReq;

  logMvhIp('resolveRequestClientMeta.headers', {
    xForwardedFor: forwarded ?? null,
    xRealIp: fromReal ?? null,
    cfConnectingIp: fromCf ?? null,
    reqIp: fromReq ?? null,
    host: req.headers.get('host'),
    chosenServerRaw: serverIp ?? null,
    chosenServer: describeIpv4(normalizeClientIp(serverIp)),
  });

  const ip = pickClientIp(serverIp, undefined, req.headers.get('host'), 'resolveRequestClientMeta');
  return { ip };
}

export function pickClientIpFromRequest(req: NextRequest, bodyIp?: string): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  const fromForwarded = forwarded?.split(',')[0]?.trim();
  const fromReal = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const reqWithIp = req as NextRequest & { ip?: string };
  const fromReq = reqWithIp.ip?.trim();
  const serverIp = fromForwarded || fromReal || fromCf || fromReq;

  logMvhIp('pickClientIpFromRequest.headers', {
    xForwardedFor: forwarded ?? null,
    xRealIp: fromReal ?? null,
    cfConnectingIp: fromCf ?? null,
    reqIp: fromReq ?? null,
    host: req.headers.get('host'),
    bodyRaw: bodyIp ?? null,
    body: describeIpv4(normalizeClientIp(bodyIp)),
    chosenServerRaw: serverIp ?? null,
    chosenServer: describeIpv4(normalizeClientIp(serverIp)),
  });

  return pickClientIp(serverIp, bodyIp, req.headers.get('host'), 'pickClientIpFromRequest', {
    osFallback: isLoopbackIp(normalizeClientIp(serverIp)),
  });
}
