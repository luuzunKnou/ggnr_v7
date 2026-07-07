import { call } from '@/lib/api';
import type { EmdRiOption } from './parcelAnalysisTypes';

export type EmdRiOptionsResult = { emd: EmdRiOption[]; error?: string };

const FETCH_TIMEOUT_MS = 20_000;

let cached: EmdRiOptionsResult | null = null;
let inflight: Promise<EmdRiOptionsResult> | null = null;

function parseEmdResponse(res: unknown): EmdRiOptionsResult {
  const data = (res as { data?: unknown })?.data ?? res;
  const raw = data as { emd?: EmdRiOption[]; error?: string };
  const emd = Array.isArray(raw?.emd) ? raw.emd : [];
  if (!emd.length) {
    const msg = raw?.error ? String(raw.error) : '읍·면·동 목록이 비어 있습니다.';
    return { emd: [], error: msg };
  }
  return { emd };
}

async function fetchEmdRiOptions(): Promise<EmdRiOptionsResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await call(
      '',
      'POST',
      { service: 'devTestService', action: 'getEmdRiOptions', params: {} },
      { signal: controller.signal }
    );
    return parseEmdResponse(res);
  } catch (error: unknown) {
    const aborted =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError');
    return {
      emd: [],
      error: aborted
        ? '목록 조회가 지연되고 있습니다. «다시 불러오기»를 눌러 주세요.'
        : '읍·면·동 목록을 불러오지 못했습니다.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

/** 세션 내 읍·면·동 목록 — 동시 요청은 하나로 합침 */
export function fetchEmdRiOptionsCached(force = false): Promise<EmdRiOptionsResult> {
  if (force) {
    cached = null;
    inflight = null;
  }
  if (!force && cached) return Promise.resolve(cached);
  if (!force && inflight) return inflight;

  inflight = fetchEmdRiOptions()
    .then((result) => {
      cached = result;
      return result;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearEmdRiOptionsCache(): void {
  cached = null;
  inflight = null;
}

export function getCachedEmdRiOptions(): EmdRiOptionsResult | null {
  return cached;
}
