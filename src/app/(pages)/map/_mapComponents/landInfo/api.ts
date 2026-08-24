'use client';

import { call } from '@/lib/api';
import {
  buildPnuQueryParams,
  hasParcelLandInfoTabData,
  type HangmangCallLine,
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

/** 세움/포털 상세행 — jijigu_list 등 배열 필드 허용 */
export type BuildingRegisterRow = Record<string, unknown>;

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
  mgmBldrgstPk?: string;
  raw?: Record<string, string>;
  source?: 'seum' | 'portal';
};

/** 우클릭 건축물대장 상세 (v6형) */
export type BuildingRegisterMode = 'recap' | 'title' | 'portal' | null;

export type BuildingRegisterDetailResult = {
  source: 'seum' | 'portal' | null;
  mode: BuildingRegisterMode;
  buildings: BuildingRegisterRow[];
  children: BuildingRegisterRow[];
  notice?: string;
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
      body?: { items?: unknown };
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

    // items 가 배열이거나 { item: 단건|배열 } 모두 허용
    let list: unknown[] = [];
    if (Array.isArray(rawItems)) {
      list = rawItems;
    } else if (typeof rawItems === 'object') {
      const item = (rawItems as { item?: unknown }).item;
      if (item == null) return [];
      list = Array.isArray(item) ? item : [item];
    } else {
      return [];
    }

    return list.map((row) => {
      const out: BuildingLedgerRow = {};
      if (!row || typeof row !== 'object') return out;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
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
  /** 행망을 안 썼거나 실패한 이유 — 브이월드 폴백 원인 확인용 */
  krasSkipReason?: string;
  hangmangCalls?: HangmangCallLine[];
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

function normalizeParcelTabPayload(
  payload: ParcelTabData & { ok?: boolean; krasSkipReason?: string }
): ParcelTabData {
  const skip = String(payload.krasSkipReason ?? '').trim();
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
    krasSkipReason: skip || undefined,
    hangmangCalls: Array.isArray(payload.hangmangCalls) ? payload.hangmangCalls : undefined,
  };
}

/** 행망이면 KRAS 우선, 없거나 실패하면 브이월드. 호출 여부는 항상 서버에서 받아 표시 */
export async function fetchParcelTabData(args: { pnu: string; vworldKey: string }) {
  const pnu = toStr(args.pnu);
  if (!pnu) return emptyParcelTabData();

  let krasSkipReason: string | undefined;
  let hangmangCalls: HangmangCallLine[] | undefined;
  const cfg = await fetchLandInfoConfig();

  if (cfg.useKras) {
    try {
      const res = await call('', 'POST', {
        service: 'landLinkageService',
        action: 'fetchParcelLandInfoTab',
        params: { pnu },
      });
      const payload = (res?.data ?? res) as ParcelTabData & { ok?: boolean; error?: string };
      krasSkipReason = String(payload?.krasSkipReason ?? payload?.error ?? '').trim() || undefined;
      hangmangCalls = Array.isArray(payload?.hangmangCalls) ? payload.hangmangCalls : undefined;
      if (payload?.ok !== false) {
        const tab = normalizeParcelTabPayload(payload);
        if (hasParcelLandInfoTabData(tab)) return { ...tab, krasSkipReason, hangmangCalls };
      }
      if (!krasSkipReason) krasSkipReason = '행망 응답을 필지정보에 쓸 수 없어 브이월드로 표시';
    } catch (e) {
      krasSkipReason =
        krasSkipReason || (e instanceof Error ? e.message : '행망 조회 실패');
    }
  }

  if (!toStr(args.vworldKey)) {
    return { ...emptyParcelTabData(), source: undefined, krasSkipReason, hangmangCalls };
  }
  const vworld = await fetchVworldParcelTabData(args);
  return { ...vworld, krasSkipReason, hangmangCalls };
}

/** 필지 PNU 기준 최신 공시지가 1건 — 공용 브이월드 클라이언트 */
export async function fetchLatestOfficialLandPriceForPnu(args: {
  pnu: string;
  vworldKey: string;
}): Promise<{ priceNum: number | null; priceLabel: string; jibun: string; source?: 'vworld' }> {
  return fetchVworldLatestOfficialLandPrice(args);
}

/** 세움만 또는 포털만 — 한 필지에 섞지 않음 */
export async function fetchBuildingRegisterDetail(args: {
  pnu: string;
  jibun?: string;
}): Promise<BuildingRegisterDetailResult> {
  const pnu = toStr(args.pnu);
  if (!pnu) return { source: null, mode: null, buildings: [], children: [] };

  try {
    const seumRes = await call('', 'POST', {
      service: 'seumService',
      action: 'fetchSeumBuildingRegisterForLandInfo',
      params: { pnu },
    });
    const seumPayload = (seumRes?.data ?? seumRes) as {
      ok?: boolean;
      mode?: 'recap' | 'title' | null;
      buildings?: BuildingRegisterRow[];
      children?: BuildingRegisterRow[];
    };
    if (
      seumPayload?.ok !== false &&
      Array.isArray(seumPayload?.buildings) &&
      seumPayload.buildings.length
    ) {
      return {
        source: 'seum',
        mode: seumPayload.mode ?? 'title',
        buildings: seumPayload.buildings,
        children: Array.isArray(seumPayload.children) ? seumPayload.children : [],
      };
    }
  } catch (e: unknown) {
    if (typeof console !== 'undefined') {
      console.warn('[필지정보·건축물대장] 세움 없음 → 포털만', {
        pnu,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    const res = await call('', 'POST', {
      service: 'mapAnalyseService',
      action: 'fetchPortalBuildingRegisterForLandInfo',
      params: { pnu },
    });
    const payload = (res?.data ?? res) as {
      ok?: boolean;
      mode?: 'recap' | 'title' | null;
      buildings?: BuildingRegisterRow[];
      children?: BuildingRegisterRow[];
      notice?: string;
    };
    if (payload?.ok === false) {
      return { source: null, mode: null, buildings: [], children: [], notice: payload.notice };
    }
    const buildings = Array.isArray(payload?.buildings) ? payload.buildings : [];
    if (!buildings.length) {
      return { source: null, mode: null, buildings: [], children: [], notice: payload?.notice };
    }
    return {
      source: 'portal',
      mode: payload.mode === 'recap' ? 'recap' : 'title',
      buildings,
      children: Array.isArray(payload.children) ? payload.children : [],
      notice: payload.notice,
    };
  } catch (e: unknown) {
    if (typeof console !== 'undefined') {
      console.error('[필지정보·건축물대장] 포털 조회 실패', {
        pnu,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return { source: null, mode: null, buildings: [], children: [] };
  }
}

/** @deprecated 상세 API 사용 — 호환용 */
export async function fetchBuildingLedgerRows(args: {
  pnu: string;
  jibun?: string;
}): Promise<{ rows: BuildingLedgerLandInfoRow[]; notice?: string }> {
  const detail = await fetchBuildingRegisterDetail(args);
  return {
    rows: detail.buildings.map((b) => ({
      pnu: args.pnu,
      addr: '',
      bldNm: [strField(b, 'bld_nm'), strField(b, 'dong_nm')].filter(Boolean).join(' ') || '',
      platLoc:
        [strField(b, 'sigungu_cd_nm'), strField(b, 'bjdong_cd_nm')].filter(Boolean).join(' ') ||
        strField(b, 'plat_loc'),
      jibun: formatSeumJibun(b),
      roadAddr: formatSeumRoad(b),
      bcRat: strField(b, 'bcrat'),
      vlRat: strField(b, 'vlrat'),
      jijigu: strField(b, 'main_prpos_cd_nm') || strField(b, 'jijigu_nm'),
      platArea: strField(b, 'plat_area'),
      totArea: strField(b, 'totarea'),
      source: (strField(b, 'source') as 'seum' | 'portal') || (detail.source ?? undefined),
    })),
    notice: detail.notice,
  };
}

function strField(row: BuildingRegisterRow, key: string): string {
  const v = row[key];
  if (v == null) return '';
  return String(v).trim();
}

function formatSeumJibun(b: BuildingRegisterRow): string {
  const m = Number(b.mnnm);
  const s = Number(b.slno);
  if (!Number.isFinite(m) || m === 0) return strField(b, 'jibun');
  return s ? `${m}-${s}` : String(m);
}

function formatSeumRoad(b: BuildingRegisterRow): string {
  if (!strField(b, 'na_road_cd_nm')) return strField(b, 'road_addr');
  const m = Number(b.na_mnnm);
  const s = Number(b.na_slno);
  const lot = Number.isFinite(m) ? (s ? `${m}-${s}` : String(m)) : '';
  return [strField(b, 'sigungu_cd_nm'), strField(b, 'na_road_cd_nm'), lot].filter(Boolean).join(' ');
}

export async function fetchBuildingRegisterByDong(args: {
  pnu: string;
  bldNm: string;
  source?: 'seum' | 'portal' | null;
}): Promise<{ buildings: BuildingRegisterRow[]; children: BuildingRegisterRow[] }> {
  const pnu = toStr(args.pnu);
  if (!pnu) return { buildings: [], children: [] };
  const service = args.source === 'portal' ? 'mapAnalyseService' : 'seumService';
  const action =
    args.source === 'portal' ? 'fetchPortalBuildingRegisterByDong' : 'fetchSeumBuildingRegisterByDong';
  try {
    const res = await call('', 'POST', {
      service,
      action,
      params: { pnu, bldNm: toStr(args.bldNm) },
    });
    const payload = (res?.data ?? res) as {
      ok?: boolean;
      buildings?: BuildingRegisterRow[];
      children?: BuildingRegisterRow[];
    };
    return {
      buildings: Array.isArray(payload?.buildings) ? payload.buildings : [],
      children: Array.isArray(payload?.children) ? payload.children : [],
    };
  } catch {
    return { buildings: [], children: [] };
  }
}

export async function fetchBuildingFloorList(args: {
  type: string;
  seqNo: string;
  pnu?: string;
  source?: 'seum' | 'portal' | null;
}): Promise<BuildingRegisterRow[]> {
  const type = toStr(args.type);
  const seqNo = toStr(args.seqNo);
  if (!seqNo) return [];
  if (args.source === 'portal') {
    const pnu = toStr(args.pnu);
    if (!pnu) return [];
    try {
      const res = await call('', 'POST', {
        service: 'mapAnalyseService',
        action: 'fetchPortalBuildingFloorList',
        params: { pnu, seqNo },
      });
      const payload = (res?.data ?? res) as { ok?: boolean; children?: BuildingRegisterRow[] };
      return Array.isArray(payload?.children) ? payload.children : [];
    } catch {
      return [];
    }
  }
  if (!type) return [];
  try {
    const res = await call('', 'POST', {
      service: 'seumService',
      action: 'fetchSeumBuildingFloorList',
      params: { type, seqNo },
    });
    const payload = (res?.data ?? res) as { ok?: boolean; children?: BuildingRegisterRow[] };
    return Array.isArray(payload?.children) ? payload.children : [];
  } catch {
    return [];
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
    /* 세움 1차 실패 → 포털 2차 */
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
    return {
      source: null,
      rows: [],
      notice: BUILDING_PERMIT_PORTAL_TIMEOUT_NOTICE,
    };
  }

  return { source: null, rows: [] };
}
