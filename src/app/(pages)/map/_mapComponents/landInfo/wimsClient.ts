'use client';

import { appFetch } from '@/lib/basePath';
import {
  WIMS_PAGE_SIZE,
  WIMS_SEARCH_KEYS,
  type WimsListQuery,
  type WimsParcelResult,
  type WimsStatQuery,
  type WimsStatRow,
  type WimsHistoryRow,
} from '@/lib/wimsTypes';

export type WimsClientStatus = {
  /** WIMS_INFO 설정 여부 */
  enabled: boolean;
  /** 설정됐을 때만. 접속 가능 여부 */
  connected: boolean | null;
};

export class WimsClientError extends Error {
  code: string;
  constructor(message: string, code = 'query_failed') {
    super(message);
    this.name = 'WimsClientError';
    this.code = code;
  }
}

const parcelCache = new Map<string, WimsParcelResult>();
const parcelInflight = new Map<string, Promise<WimsParcelResult>>();
let statusPromise: Promise<WimsClientStatus> | null = null;

async function readError(res: Response): Promise<WimsClientError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return new WimsClientError(
    data.error || '수용가 정보를 조회하지 못했습니다.',
    data.code || (res.status === 503 ? 'not_configured' : 'query_failed')
  );
}

/** 설정·접속 상태. 성공한 응답만 캐시. */
export function loadWimsStatus(): Promise<WimsClientStatus> {
  if (!statusPromise) {
    statusPromise = appFetch('/api/wims/status')
      .then(async (res) => {
        if (!res.ok) {
          statusPromise = null;
          return { enabled: false, connected: null };
        }
        const data = (await res.json().catch(() => ({}))) as {
          enabled?: boolean;
          connected?: boolean | null;
        };
        return {
          enabled: Boolean(data.enabled),
          connected: data.enabled ? Boolean(data.connected) : null,
        };
      })
      .catch(() => {
        statusPromise = null;
        return { enabled: false, connected: null };
      });
  }
  return statusPromise;
}

/** @deprecated loadWimsStatus 사용 권장 */
export async function loadWimsEnabled(): Promise<boolean> {
  const status = await loadWimsStatus();
  return status.enabled;
}

/** 같은 필지는 다시 요청하지 않는다. 접속 실패 결과는 캐시하지 않는다. */
export function loadWimsParcel(pnu: string): Promise<WimsParcelResult> {
  const hit = parcelCache.get(pnu);
  if (hit) return Promise.resolve(hit);
  const pending = parcelInflight.get(pnu);
  if (pending) return pending;

  const task = appFetch('/api/wims/parcel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pnu }),
  })
    .then(async (res) => {
      if (!res.ok) throw await readError(res);
      return (await res.json()) as WimsParcelResult;
    })
    .then((data) => {
      parcelCache.set(pnu, data);
      parcelInflight.delete(pnu);
      return data;
    })
    .catch((err) => {
      parcelInflight.delete(pnu);
      throw err;
    });
  parcelInflight.set(pnu, task);
  return task;
}

export async function loadWimsList(
  query: WimsListQuery
): Promise<{ dataList: WimsHistoryRow[]; totalCount: number }> {
  const res = await appFetch('/api/wims/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...query,
      pageSize: query.pageSize ?? WIMS_PAGE_SIZE,
      searchKeys: query.searchKeys ?? [...WIMS_SEARCH_KEYS],
    }),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as { dataList: WimsHistoryRow[]; totalCount: number };
}

export async function loadWimsStat(query: WimsStatQuery): Promise<WimsStatRow[]> {
  const res = await appFetch('/api/wims/stat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw await readError(res);
  const data = (await res.json()) as { dataList?: WimsStatRow[] };
  return data.dataList ?? [];
}

export async function downloadWimsExcel(query: WimsListQuery): Promise<void> {
  const res = await appFetch('/api/wims/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...query, searchKeys: query.searchKeys ?? [...WIMS_SEARCH_KEYS] }),
  });
  if (!res.ok) throw await readError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  a.href = url;
  a.download = `${stamp}_WIMS_검침이력.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
