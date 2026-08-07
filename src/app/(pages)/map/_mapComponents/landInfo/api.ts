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
  notice?: string;
};

export const BUILDING_PERMIT_PORTAL_TIMEOUT_NOTICE =
  '공공데이터포털 연결이 불안정합니다. 잠시 후 다시 조회해 주세요';

const PERMIT_PORTAL_RETRY_MAX = 2;
const PERMIT_PORTAL_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortalTransientFailure(status: number, text: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  const t = String(text ?? '').toLowerCase();
  return (
    t.includes('service_timeout') ||
    t.includes('servicetimeout') ||
    t.includes('연결실패') ||
    t.includes('http_error') ||
    /\breturnreasoncode["\s:]*["']?0[45]\b/.test(t)
  );
}

async function fetchPortalTextOnce(url: string): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, text: msg };
  }
}

/** 연결실패·타임아웃(04/05, 502/503)만 재시도. 본문은 status가 비정상이어도 유지 */
async function fetchPortalTextWithRetry(url: string): Promise<{
  status: number;
  text: string;
  transient: boolean;
}> {
  let last = { status: 0, text: '' };
  for (let attempt = 0; attempt <= PERMIT_PORTAL_RETRY_MAX; attempt++) {
    if (attempt > 0) await sleep(PERMIT_PORTAL_RETRY_DELAY_MS * attempt);
    last = await fetchPortalTextOnce(url);
    const transient = isPortalTransientFailure(last.status, last.text);
    if (!transient) {
      return { ...last, transient: false };
    }
  }
  return { ...last, transient: true };
}

export { fetchLandInfoConfig };

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
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

/** 공공데이터포털 JSON — `response` 래퍼 유무 모두 */
function parseJsonRows(text: string): BuildingLedgerRow[] {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{')) return [];
  try {
    type Envelope = {
      header?: { resultCode?: string };
      body?: { items?: { item?: Record<string, unknown> | Record<string, unknown>[] } | string };
    };
    const json = JSON.parse(trimmed) as Envelope & {
      response?: Envelope;
      OpenAPI_ServiceResponse?: unknown;
    };
    if (json.OpenAPI_ServiceResponse) return [];
    const root = json.response ?? json;
    const code = String(root.header?.resultCode ?? '').trim();
    if (code && code !== '00' && code !== '03') return [];
    const rawItems = root.body?.items;
    if (rawItems == null || rawItems === '') return [];
    const item =
      typeof rawItems === 'object' && !Array.isArray(rawItems)
        ? rawItems.item
        : undefined;
    if (!item) return [];
    const list = Array.isArray(item) ? item : [item];
    return list.map((row) => {
      const out: BuildingLedgerRow = {};
      for (const [k, v] of Object.entries(row)) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s) out[k] = s;
      }
      return out;
    });
  } catch {
    return [];
  }
}

function parsePortalRows(text: string): BuildingLedgerRow[] {
  const jsonRows = parseJsonRows(text);
  if (jsonRows.length) return jsonRows;
  return parseXmlRows(text);
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
    // 2026-07-21 이수빈: 빌드 오류로 임시 처리
    const payload = (res?.data ?? res) as ParcelTabData & { ok?: boolean };
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
      error?: string;
      debug?: {
        requested: number;
        fromSeum: number;
        portalAttempted: number;
        portalOk: number;
        portalEmpty: number;
        portalQuota: number;
        portalOtherError: number;
        samples?: Array<{
          pnu: string;
          outcome: string;
          status?: number;
          resultCode?: string;
          reason?: string;
          bodyPreview?: string;
          count?: number;
        }>;
      };
    };
    if (typeof console !== 'undefined') {
      const logFn =
        payload?.notice ||
        payload?.portalQuotaExceeded ||
        (payload?.debug?.portalQuota ?? 0) > 0 ||
        (payload?.debug?.portalOtherError ?? 0) > 0
          ? console.warn
          : console.info;
      logFn('[필지정보·건축물대장]', {
        pnu,
        ok: payload?.ok,
        rowCount: Array.isArray(payload?.rows) ? payload.rows.length : 0,
        notice: payload?.notice,
        portalQuotaExceeded: payload?.portalQuotaExceeded,
        error: payload?.error,
        debug: payload?.debug,
      });
    }
    if (payload?.ok === false) {
      return {
        rows: [],
        notice: payload.notice ?? payload.error,
      };
    }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const notice = payload?.notice;
    return { rows, notice };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof console !== 'undefined') {
      console.error('[필지정보·건축물대장]', { pnu, error: msg });
    }
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

  const archUrl = `/api/public-data/building?kind=arch&${qs.toString()}`;
  const arch = await fetchPortalTextWithRetry(archUrl);
  const apRows = parsePortalRows(arch.text);
  if (apRows.length > 0) {
    return { source: 'arch', permitKind: 'arch', rows: apRows };
  }

  const housingUrl = `/api/public-data/building?kind=housing&${qs.toString()}`;
  const housing = await fetchPortalTextWithRetry(housingUrl);
  const hpRows = parsePortalRows(housing.text);
  if (hpRows.length > 0) {
    return { source: 'housing', permitKind: 'housing', rows: hpRows };
  }

  const transient = arch.transient || housing.transient;
  if (transient) {
    if (typeof console !== 'undefined') {
      console.warn('[필지정보·건축인허가]', {
        pnu,
        archStatus: arch.status,
        housingStatus: housing.status,
        notice: BUILDING_PERMIT_PORTAL_TIMEOUT_NOTICE,
        archPreview: String(arch.text ?? '').slice(0, 160),
      });
    }
    return {
      source: null,
      rows: [],
      notice: BUILDING_PERMIT_PORTAL_TIMEOUT_NOTICE,
    };
  }

  return { source: null, rows: [] };
}
