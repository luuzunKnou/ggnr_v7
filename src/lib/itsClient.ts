/**
 * ITS(국가교통정보센터) — 브라우저 직접 호출.
 * openapi.its.go.kr / its.go.kr 는 CORS 허용(Origin 반영 또는 *).
 */
'use client';

import { call } from '@/lib/api';

const ITS_CCTV_URL = 'https://openapi.its.go.kr:9443/cctvInfo';

export type ItsCctvItem = {
  key: string;
  cctvname: string;
  coordx: number;
  coordy: number;
  cctvurl: string;
  cctvtype: string;
  cctvformat: string;
  roadsectionid: string;
  filecreatetime: string;
  cctvresolution: string;
};

export function buildItsTrafficTileUrl(z: number, x: number, y: number): string {
  return `https://its.go.kr:9443/geoserver/gwc/service/wmts/rest/ntic:N_LEVEL_${z}/ntic:REALTIME/EPSG:3857/EPSG:3857:${z}/${y}/${x}?format=image/png8`;
}

let cachedItsCctvKey: string | null = null;

export async function fetchItsCctvApiKey(): Promise<string> {
  if (cachedItsCctvKey != null) return cachedItsCctvKey;
  const res = await call('', 'POST', {
    service: 'configService',
    action: 'getMapConfig',
    params: {},
  });
  const data = (res?.data ?? res) as { ITS_CCTV_API_KEY?: string };
  const key = String(data?.ITS_CCTV_API_KEY ?? '').trim();
  cachedItsCctvKey = key;
  return key;
}

function pickXmlTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return m[1].trim().replace(/;+\s*$/g, '').trim();
}

type RawCctv = {
  cctvname: string;
  coordx: string;
  coordy: string;
  cctvurl: string;
  cctvtype: string;
  cctvformat: string;
  roadsectionid: string;
  filecreatetime: string;
  cctvresolution: string;
};

function parseItsCctvXml(xml: string): RawCctv[] {
  const items: RawCctv[] = [];
  const re = /<data>([\s\S]*?)<\/data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]!;
    const cctvname = pickXmlTag(block, 'cctvname');
    const coordx = pickXmlTag(block, 'coordx');
    const coordy = pickXmlTag(block, 'coordy');
    const cctvurl = pickXmlTag(block, 'cctvurl');
    if (!cctvurl) continue;
    const cx = parseFloat(coordx.replace(/,/g, '.'));
    const cy = parseFloat(coordy.replace(/,/g, '.'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    items.push({
      cctvname: cctvname || 'CCTV',
      coordx,
      coordy,
      cctvurl,
      cctvtype: pickXmlTag(block, 'cctvtype'),
      cctvformat: pickXmlTag(block, 'cctvformat'),
      roadsectionid: pickXmlTag(block, 'roadsectionid'),
      filecreatetime: pickXmlTag(block, 'filecreatetime'),
      cctvresolution: pickXmlTag(block, 'cctvresolution'),
    });
  }
  return items;
}

function parseItsCctvJson(raw: unknown): RawCctv[] {
  const items: RawCctv[] = [];
  const root = raw as Record<string, unknown>;
  const dataArr = root.data;
  const list = Array.isArray(dataArr) ? dataArr : dataArr != null ? [dataArr] : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const cctvurl = String(r.cctvurl ?? '').trim();
    if (!cctvurl) continue;
    const coordx = String(r.coordx ?? '').replace(/;+\s*$/g, '').trim();
    const coordy = String(r.coordy ?? '').replace(/;+\s*$/g, '').trim();
    const cx = parseFloat(coordx.replace(/,/g, '.'));
    const cy = parseFloat(coordy.replace(/,/g, '.'));
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    items.push({
      cctvname: String(r.cctvname ?? 'CCTV').trim() || 'CCTV',
      coordx,
      coordy,
      cctvurl,
      cctvtype: String(r.cctvtype ?? ''),
      cctvformat: String(r.cctvformat ?? ''),
      roadsectionid: String(r.roadsectionid ?? ''),
      filecreatetime: String(r.filecreatetime ?? ''),
      cctvresolution: String(r.cctvresolution ?? ''),
    });
  }
  return items;
}

function toItems(rows: RawCctv[]): ItsCctvItem[] {
  return rows.map((r, i) => {
    const cx = parseFloat(String(r.coordx).replace(/,/g, '.'));
    const cy = parseFloat(String(r.coordy).replace(/,/g, '.'));
    return {
      key: `${cx.toFixed(5)}_${cy.toFixed(5)}_${i}`,
      cctvname: r.cctvname,
      coordx: cx,
      coordy: cy,
      cctvurl: r.cctvurl,
      cctvtype: r.cctvtype,
      cctvformat: r.cctvformat,
      roadsectionid: r.roadsectionid,
      filecreatetime: r.filecreatetime,
      cctvresolution: r.cctvresolution,
    };
  });
}

export async function fetchItsCctvListClient(params: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  type: string;
  cctvType: string;
  getType?: 'xml' | 'json';
}): Promise<ItsCctvItem[]> {
  const apiKey = await fetchItsCctvApiKey();
  if (!apiKey) {
    throw new Error('ITS CCTV API 키가 설정되어 있지 않습니다.');
  }

  const getType = params.getType ?? 'xml';
  const u = new URL(ITS_CCTV_URL);
  u.searchParams.set('apiKey', apiKey);
  u.searchParams.set('type', params.type);
  u.searchParams.set('cctvType', params.cctvType);
  u.searchParams.set('minX', String(params.minX));
  u.searchParams.set('maxX', String(params.maxX));
  u.searchParams.set('minY', String(params.minY));
  u.searchParams.set('maxY', String(params.maxY));
  u.searchParams.set('getType', getType);

  const res = await fetch(u.toString(), {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    headers: { Accept: getType === 'json' ? 'application/json' : 'text/xml' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ITS API 요청 실패 (${res.status})`);
  }

  let rows: RawCctv[];
  if (getType === 'json') {
    try {
      rows = parseItsCctvJson(JSON.parse(text) as unknown);
    } catch {
      rows = parseItsCctvXml(text);
    }
  } else {
    rows = parseItsCctvXml(text);
  }
  return toItems(rows);
}

export function mergeExAndItsCctv(exList: ItsCctvItem[], itsList: ItsCctvItem[]): ItsCctvItem[] {
  const map = new Map<string, ItsCctvItem>();
  for (const it of [...exList, ...itsList]) {
    const url = it.cctvurl.trim();
    const dedupeKey =
      url ||
      `${Number(it.coordx).toFixed(5)}_${Number(it.coordy).toFixed(5)}_${it.cctvname.trim()}`;
    if (map.has(dedupeKey)) continue;
    map.set(dedupeKey, { ...it, key: dedupeKey });
  }
  return [...map.values()];
}

/** 고속도로(ex) + 국도(its) HLS 병합 */
export async function fetchMergedItsCctvListClient(bbox: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): Promise<ItsCctvItem[]> {
  const cctvType = '1';
  const settled = await Promise.allSettled([
    fetchItsCctvListClient({ ...bbox, type: 'ex', cctvType }),
    fetchItsCctvListClient({ ...bbox, type: 'its', cctvType }),
  ]);
  const exList = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const itsList = settled[1].status === 'fulfilled' ? settled[1].value : [];
  const merged = mergeExAndItsCctv(exList, itsList);
  if (merged.length === 0) {
    const firstReject = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (firstReject) {
      const msg =
        firstReject.reason instanceof Error
          ? firstReject.reason.message
          : String(firstReject.reason);
      throw new Error(msg);
    }
  }
  return merged;
}
