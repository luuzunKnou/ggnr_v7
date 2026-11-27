import { AsyncLocalStorage } from 'node:async_hooks';

/** 요청 처리 중 클라이언트가 넘긴 사설 IP 힌트(감사 이력용) */
const als = new AsyncLocalStorage<{ clientIp?: string }>();

export function runWithAuditClientIpHint<T>(clientIp: string | undefined, fn: () => T): T {
  return als.run({ clientIp: clientIp?.trim() || undefined }, fn);
}

export function getAuditClientIpHint(): string | undefined {
  const v = als.getStore()?.clientIp?.trim();
  return v || undefined;
}
