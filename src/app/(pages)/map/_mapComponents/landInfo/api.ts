'use client';

import { call } from '@/lib/api';
import {
  buildPnuQueryParams,
  hasParcelLandInfoTabData,
} from '@/lib/parcelLandNormalize';
import {
  fetchLandInfoConfig,
  fetchVworldLatestOfficialLandPrice,
  fetchVworldParcelTabData,
  sortCharacteristicsLatestFirst,
  sortPossessionsLatestFirst,
  sortPricesLatestFirst,
  type LandInfoMapConfig,
} from '@/lib/vworldParcelLandClient';
import { transformCoordinate } from '../services/coordinateService';

type JsonObject = Record<string, unknown>;

export type { LandInfoMapConfig };

export type ParcelIdentity = {
  pnu: string | null;
  jibunFromParcel: string | null;
};

export type BuildingLedgerRow = Record<string, string>;

export type BuildingLedgerLandInfoRow = {
  pnu: string;
  addr: string;
  bldNm: string;
  platLoc: string;
  jibun: string;
  roadAddr: string;
  bcRat: string;
  vlRat: string;
  jijigu: string;
  platArea: string;
  totArea: string;
  source?: 'seum' | 'portal';
};
export type BuildingPermitSource = 'seum' | 'arch' | 'housing' | null;

export type BuildingPermitFetchResult = {
  source: BuildingPermitSource;
  permitKind?: 'arch' | 'housing' | null;
  rows: BuildingLedgerRow[];
};

export { fetchLandInfoConfig };

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
  if (!res.ok) return '';
  return await res.text();
}

function parseXmlRows(xmlText: string): BuildingLedgerRow[] {
  if (!xmlText) return [];
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'text/xml');
  const items = Array.from(xml.getElementsByTagName('item'));
  return items.map((item) => {
    const row: BuildingLedgerRow = {};
    for (const child of Array.from(item.children)) {
      row[child.tagName] = child.textContent?.trim() ?? '';
    }
    return row;
  });
}

export async function fetchParcelIdentityAtPoint(
  coordinate: [number, number],
  viewProjection: string
): Promise<ParcelIdentity> {
  const coord3857 = transformCoordinate(coordinate, viewProjection, 'EPSG:3857');
  if (!coord3857) return { pnu: null, jibunFromParcel: null };
  const [x, y] = coord3857;
  try {
    const res = await call('', 'POST', {
      service: 'standardService',
      action: 'getJijukParcelAtPoint',
      params: { x, y },
    });
    const payload = (res?.data ?? res) as {
      results?: { tableName?: string; features?: { data?: JsonObject }[] }[];
    };
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const jijuk = results.find((r) => String(r?.tableName ?? '').trim() === 'jijuk');
    const row = (jijuk?.features?.[0]?.data ?? null) as JsonObject | null;
    if (!row) return { pnu: null, jibunFromParcel: null };
    return {
      pnu: toStr(row.pnu) || null,
      jibunFromParcel: toStr(row.jibun) || null,
    };
  } catch {
    return { pnu: null, jibunFromParcel: null };
  }
}

/** 호환 — 공용 `fetchVworldParcelTabData` 위임 */
export async function fetchParcelTabDataFromVworld(args: { pnu: string; vworldKey: string }) {
  return fetchVworldParcelTabData(args);
}

export type ParcelTabData = {
  characteristics: JsonObject[];
  landUses: JsonObject[];
  prices: JsonObject[];
  possessions: JsonObject[];
  source?: 'kras' | 'koreps' | 'vworld' | 'mixed';
};

function emptyParcelTabData(): ParcelTabData {
  return {
    characteristics: [],
    landUses: [],
    prices: [],
    possessions: [],
    source: 'vworld',
  };
}

function normalizeParcelTabPayload(payload: ParcelTabData & { ok?: boolean }): ParcelTabData {
  return {
    characteristics: sortCharacteristicsLatestFirst(
      Array.isArray(payload.characteristics) ? payload.characteristics : []
    ),
    landUses: Array.isArray(payload.landUses) ? payload.landUses : [],
    prices: sortPricesLatestFirst(Array.isArray(payload.prices) ? payload.prices : []),
    possessions: sortPossessionsLatestFirst(
      Array.isArray(payload.possessions) ? payload.possessions : []
    ),
    source:
      payload.source === 'kras' ||
      payload.source === 'koreps' ||
      payload.source === 'vworld' ||
      payload.source === 'mixed'
        ? payload.source
        : undefined,
  };
}

/** 행망(KRAS)은 서버, 브이월드는 브라우저 JSONP(공용 클라이언트) */
export async function fetchParcelTabData(args: { pnu: string; vworldKey: string }) {
  const pnu = toStr(args.pnu);
  if (!pnu) return emptyParcelTabData();

  try {
    const res = await call('', 'POST', {
      service: 'landLinkageService',
      action: 'fetchParcelLandInfoTab',
      params: { pnu },
    });
    const payload = (res?.data ?? res) as ParcelTabData & { ok?: boolean; error?: string };
    if (payload?.ok !== false) {
      const tab = normalizeParcelTabPayload(payload);
      if (hasParcelLandInfoTabData(tab)) return tab;
    }
  } catch {
    /* KRAS 실패 시 브라우저 브이월드 */
  }

  if (!toStr(args.vworldKey)) return emptyParcelTabData();
  return fetchVworldParcelTabData(args);
}

/** 필지 PNU 기준 최신 공시지가 1건 — 공용 브이월드 클라이언트 */
export async function fetchLatestOfficialLandPriceForPnu(args: {
  pnu: string;
  vworldKey: string;
}): Promise<{ priceNum: number | null; priceLabel: string; jibun: string; source?: 'vworld' }> {
  return fetchVworldLatestOfficialLandPrice(args);
}

/** 세움터 → 데이터포털 (필지분석과 동일 경로) */
export async function fetchBuildingLedgerRows(args: {
  pnu: string;
  jibun?: string;
}): Promise<{ rows: BuildingLedgerLandInfoRow[]; notice?: string }> {
  const pnu = toStr(args.pnu);
  const jibun = toStr(args.jibun);
  if (!pnu) return { rows: [] };
  try {
    const res = await call('', 'POST', {
      service: 'mapAnalyseService',
      action: 'fetchBuildingLedgersForParcels',
      params: { parcels: [{ pnu, jibun: jibun || undefined }] },
    });
    const payload = (res?.data ?? res) as {
      ok?: boolean;
      rows?: BuildingLedgerLandInfoRow[];
      notice?: string;
      portalQuotaExceeded?: boolean;
    };
    if (payload?.ok === false) return { rows: [], notice: payload.notice };
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const notice = payload?.notice;
    if (notice && typeof console !== 'undefined') {
      console.warn('[필지정보·건축물대장]', notice);
    }
    return { rows, notice };
  } catch {
    return { rows: [] };
  }
}

export async function fetchPermitRows(args: {
  pnu: string;
  dataPortalKey: string;
}): Promise<BuildingPermitFetchResult> {
  const pnu = toStr(args.pnu);
  if (!pnu) return { source: null, rows: [] };

  try {
    const seumRes = await call('', 'POST', {
      service: 'seumPermitService',
      action: 'fetchSeumPermitRowsByPnu',
      params: { pnu },
    });
    const seumPayload = (seumRes?.data ?? seumRes) as {
      ok?: boolean;
      kind?: 'arch' | 'housing';
      rows?: BuildingLedgerRow[];
    };
    if (seumPayload?.ok !== false && Array.isArray(seumPayload?.rows) && seumPayload.rows.length) {
      return {
        source: 'seum',
        permitKind: seumPayload.kind ?? null,
        rows: seumPayload.rows,
      };
    }
  } catch {
    /* 세움터 실패 시 포털 폴백 */
  }

  if (!args.dataPortalKey) return { source: null, rows: [] };
  const qs = buildPnuQueryParams(pnu);
  qs.set('serviceKey', args.dataPortalKey);
  const apText = await fetchText(`/api/public-data/building?kind=arch&${qs.toString()}`);
  const apRows = parseXmlRows(apText);
  if (apRows.length > 0) return { source: 'arch', permitKind: 'arch', rows: apRows };
  const hpText = await fetchText(`/api/public-data/building?kind=housing&${qs.toString()}`);
  const hpRows = parseXmlRows(hpText);
  if (hpRows.length > 0) return { source: 'housing', permitKind: 'housing', rows: hpRows };
  return { source: null, rows: [] };
}
