import type { NextRequest } from 'next/server';
export { normalizeClientIp } from '@/lib/normalizeClientIp';
import { normalizeClientIp } from '@/lib/normalizeClientIp';

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
  options?: { osFallback?: boolean }
): string | undefined {
  const server = normalizeClientIp(serverIp);
  let client = normalizeClientIp(bodyIp);
  const hostIp = extractIpv4FromHost(requestHost);

  if (client && hostIp && client === hostIp) {
    client = undefined;
  }
  if (client && (isPublicIpv4(client) || isLoopbackIp(client))) {
    client = undefined;
  }

  let effectiveServer = server;
  if (effectiveServer && (isPublicIpv4(effectiveServer) || isLoopbackIp(effectiveServer))) {
    effectiveServer = undefined;
  }

  if (client && isPrivateIpv4(client)) return client;
  if (effectiveServer && isPrivateIpv4(effectiveServer)) return effectiveServer;

  if (options?.osFallback) {
    const { pickHostMachinePrivateIpv4 } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- server-only, 클라이언트 번들 제외
      require('@/lib/hostMachineIpv4') as typeof import('@/lib/hostMachineIpv4');
    const osNicIp = pickHostMachinePrivateIpv4();
    if (osNicIp && isPrivateIpv4(osNicIp)) return osNicIp;
  }

  return undefined;
}

export function resolveRequestClientMeta(req: NextRequest): { ip?: string } {
  const forwarded = req.headers.get('x-forwarded-for');
  const fromForwarded = forwarded?.split(',')[0]?.trim();
  const fromReal = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const reqWithIp = req as NextRequest & { ip?: string };
  const fromReq = reqWithIp.ip?.trim();
  const serverIp = fromForwarded || fromReal || fromCf || fromReq;

  const ip = pickClientIp(serverIp, undefined, req.headers.get('host'));
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

  return pickClientIp(serverIp, bodyIp, req.headers.get('host'), {
    osFallback: isLoopbackIp(normalizeClientIp(serverIp)),
  });
}

function collectIpsFromHeaderBag(get: (name: string) => string | null): string[] {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    const n = normalizeClientIp(raw);
    if (n && !out.includes(n)) out.push(n);
  };

  const xff = get('x-forwarded-for');
  if (xff) {
    for (const part of xff.split(',')) push(part);
  }

  const forwarded = get('forwarded');
  if (forwarded) {
    for (const segment of forwarded.split(',')) {
      const m = /(?:^|;)\s*for=(?:"?\[?)([^\]";]+)/i.exec(segment);
      if (m?.[1]) push(m[1]);
    }
  }

  push(get('x-real-ip'));
  push(get('true-client-ip'));
  push(get('cf-connecting-ip'));
  push(get('x-client-ip'));
  push(get('x-cluster-client-ip'));
  return out;
}

/**
 * 감사 이력용 IP — 망 구성이 달라도 최대한 자리 IP를 고른다.
 * 우선순위: body 사설 IP → 헤더 체인 사설 IP → 헤더 비루프백 IP
 * (서버 NIC fallback 없음 — 감사에 서버 IP를 쓰지 않음)
 */
export function pickAuditClientIp(
  headerGet: (name: string) => string | null,
  bodyIp?: string | null
): string | undefined {
  const body = normalizeClientIp(bodyIp);
  if (body && isPrivateIpv4(body) && !isLoopbackIp(body)) return body;

  const fromHeaders = collectIpsFromHeaderBag(headerGet);
  const privateHeader = fromHeaders.find((ip) => isPrivateIpv4(ip) && !isLoopbackIp(ip));
  if (privateHeader) return privateHeader;

  const anyHeader = fromHeaders.find((ip) => !isLoopbackIp(ip));
  if (anyHeader) return anyHeader;

  if (body && !isLoopbackIp(body)) return body;
  return undefined;
}

/** Next 요청 헤더(+선택 body/ALS 힌트)에서 감사 IP 해석 */
export async function resolveAuditClientIp(bodyIp?: string | null): Promise<string | undefined> {
  let hint = bodyIp;
  if (!String(hint ?? '').trim()) {
    try {
      const { getAuditClientIpHint } = await import('@/lib/auditClientIpContext');
      hint = getAuditClientIpHint();
    } catch {
      hint = bodyIp;
    }
  }
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return pickAuditClientIp((name) => h.get(name), hint);
  } catch {
    const body = normalizeClientIp(hint);
    if (body && !isLoopbackIp(body)) return body;
    return undefined;
  }
}
