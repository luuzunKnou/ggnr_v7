import { call } from '@/lib/api';
import type { EmdRiOption } from './parcelAnalysisTypes';

const RI_FETCH_TIMEOUT_MS = 15_000;

const riCache = new Map<string, EmdRiOption[]>();
const inflight = new Map<string, Promise<EmdRiOption[]>>();

export function getCachedRiOptions(emdCode: string): EmdRiOption[] | null {
  const hit = riCache.get(emdCode);
  return hit && hit.length > 0 ? hit : null;
}

export function fetchRiOptionsCached(emdCode: string, force = false): Promise<EmdRiOption[]> {
  const code = emdCode.trim();
  if (!code) return Promise.resolve([]);

  if (!force) {
    const hit = riCache.get(code);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(code);
    if (pending) return pending;
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), RI_FETCH_TIMEOUT_MS);
    try {
      const res = await call(
        '',
        'POST',
        {
          service: 'devTestService',
          action: 'getRiOptionsByEmd',
          params: { emdCode: code },
        },
        { signal: controller.signal }
      );
      const data = res?.data ?? res;
      const ri = Array.isArray(data?.ri) ? (data.ri as EmdRiOption[]) : [];
      riCache.set(code, ri);
      return ri;
    } catch {
      riCache.set(code, []);
      return [] as EmdRiOption[];
    } finally {
      window.clearTimeout(timer);
      inflight.delete(code);
    }
  })();

  inflight.set(code, promise);
  return promise;
}

export function clearRiOptionsCache(): void {
  riCache.clear();
  inflight.clear();
}
