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

const parcelCache = new Map<string, WimsParcelResult>();
const parcelInflight = new Map<string, Promise<WimsParcelResult>>();
let enabledPromise: Promise<boolean> | null = null;

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || '수용가 정보를 조회하지 못했습니다.';
}

/** 설정 여부는 성공한 경우에만 캐시. 실패는 다음 호출에서 재시도. */
export function loadWimsEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    console.log('[wimsClient.loadWimsEnabled] fetch /api/wims/status');
    enabledPromise = appFetch('/api/wims/status')
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          enabled?: boolean;
          error?: string;
          debug?: Record<string, unknown>;
        };
        console.log('[wimsClient.loadWimsEnabled] response', {
          ok: res.ok,
          status: res.status,
          enabled: data.enabled,
          error: data.error,
          debug: data.debug,
        });
        if (!res.ok) {
          enabledPromise = null;
          return false;
        }
        return Boolean(data.enabled);
      })
      .catch((err) => {
        console.error('[wimsClient.loadWimsEnabled] error', err);
        enabledPromise = null;
        return false;
      });
  } else {
    console.log('[wimsClient.loadWimsEnabled] reuse cached promise');
  }
  return enabledPromise;
}

/** 같은 필지는 다시 요청하지 않는다. */
export function loadWimsParcel(pnu: string): Promise<WimsParcelResult> {
  console.log('[wimsClient.loadWimsParcel] start', { pnu });
  const hit = parcelCache.get(pnu);
  if (hit) {
    console.log('[wimsClient.loadWimsParcel] cache hit', { pnu, meters: hit.meters.length, total: hit.totalCount });
    return Promise.resolve(hit);
  }
  const pending = parcelInflight.get(pnu);
  if (pending) {
    console.log('[wimsClient.loadWimsParcel] inflight', { pnu });
    return pending;
  }
  const task = appFetch('/api/wims/parcel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pnu }),
  })
    .then(async (res) => {
      console.log('[wimsClient.loadWimsParcel] response', { pnu, ok: res.ok, status: res.status });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as WimsParcelResult;
    })
    .then((data) => {
      console.log('[wimsClient.loadWimsParcel] data', {
        pnu,
        meters: data.meters?.length ?? 0,
        stat: data.statList?.length ?? 0,
        list: data.dataList?.length ?? 0,
        total: data.totalCount,
      });
      parcelCache.set(pnu, data);
      parcelInflight.delete(pnu);
      return data;
    })
    .catch((err) => {
      console.error('[wimsClient.loadWimsParcel] error', { pnu, err });
      parcelInflight.delete(pnu);
      throw err;
    });
  parcelInflight.set(pnu, task);
  return task;
}

export async function loadWimsList(query: WimsListQuery): Promise<{ dataList: WimsHistoryRow[]; totalCount: number }> {
  const res = await appFetch('/api/wims/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...query, pageSize: query.pageSize ?? WIMS_PAGE_SIZE, searchKeys: query.searchKeys ?? [...WIMS_SEARCH_KEYS] }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as { dataList: WimsHistoryRow[]; totalCount: number };
}

export async function loadWimsStat(query: WimsStatQuery): Promise<WimsStatRow[]> {
  const res = await appFetch('/api/wims/stat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { dataList?: WimsStatRow[] };
  return data.dataList ?? [];
}

export async function downloadWimsExcel(query: WimsListQuery): Promise<void> {
  const res = await appFetch('/api/wims/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...query, searchKeys: query.searchKeys ?? [...WIMS_SEARCH_KEYS] }),
  });
  if (!res.ok) throw new Error(await readError(res));
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
