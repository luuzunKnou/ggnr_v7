'use client';

import { call } from '@/lib/api';
import { hasParcelLandInfoTabData } from '@/lib/parcelLandInfoTab';
import { transformCoordinate } from '../services/coordinateService';

type JsonObject = Record<string, unknown>;

export type LandInfoMapConfig = {
  vworldKey: string;
  dataPortalKey: string;
};

export type ParcelIdentity = {
  pnu: string | null;
  jibunFromParcel: string | null;
};

export type BuildingLedgerRow = Record<string, string>;
export type BuildingPermitSource = 'arch' | 'housing' | null;
const DEFAULT_DATA_PORTAL_KEY =
  'aiP4epT7GQrb64StfWRp3NF1Ng%2BIC%2Fg4pdDz%2BpKuU4Dh31MWXIyhos7HT6puzyJjWC0UuCugVMapD1bm9D7pTA%3D%3D';

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function getAnyString(row: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function parseRowsFromVworld(payload: JsonObject | null, rootKey: string): JsonObject[] {
  if (!payload) return [];
  const root = payload[rootKey] as JsonObject | undefined;
  const field = root?.field;
  if (Array.isArray(field)) return field.filter((v): v is JsonObject => !!v && typeof v === 'object');
  return [];
}

function dedupeRows(rows: JsonObject[], keys: string[]): JsonObject[] {
  const seen = new Set<string>();
  const result: JsonObject[] = [];
  for (const row of rows) {
    const signature = keys.map((k) => toStr(row[k])).join('||');
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(row);
  }
  return result;
}

async function fetchJsonp(url: string, query: Record<string, string>): Promise<JsonObject | null> {
  if (typeof document === 'undefined' || !document.head) return null;
  return new Promise<JsonObject | null>((resolve) => {
    const callbackName = `__vworldNed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const params = new URLSearchParams(query);
    params.set('callback', callbackName);
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
      if (script.parentNode) script.remove();
    };

    const finish = (value: JsonObject | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };

    (window as unknown as Record<string, (data: JsonObject) => void>)[callbackName] = (data: JsonObject) => {
      finish(data);
    };

    script.src = `${url}?${params.toString()}`;
    script.async = true;
    script.onerror = () => finish(null);
    document.head.appendChild(script);
    setTimeout(() => finish(null), 12000);
  });
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

export async function fetchLandInfoConfig(): Promise<LandInfoMapConfig> {
  try {
    const res = await call('', 'POST', { service: 'configService', action: 'getMapConfig', params: {} });
    const data = (res?.data ?? res) as JsonObject;
    const vworldKey = toStr(data?.VWORLD_API_KEY);
    const candidatePortalKey = getAnyString(data, [
      'DATA_PORTAL_KEY',
      'dataPotalKey',
      'DATA_POTAL_KEY',
      'DATA_PORTAL_KEY',
      'OPEN_API_KEY',
      'PUBLIC_DATA_KEY',
      'DATA_GO_KR_KEY',
    ]);
    return { vworldKey, dataPortalKey: candidatePortalKey || DEFAULT_DATA_PORTAL_KEY };
  } catch {
    return { vworldKey: '', dataPortalKey: DEFAULT_DATA_PORTAL_KEY };
  }
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
    const payload = (res?.data ?? res) as { results?: { tableName?: string; features?: { data?: JsonObject }[] }[] };
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

export async function fetchParcelTabDataFromVworld(args: { pnu: string; vworldKey: string }) {
  const query = {
    key: args.vworldKey,
    pnu: args.pnu,
    format: 'json',
    numOfRows: '1000',
  };
  const [characteristicRaw, landUseRaw, priceRaw, possessionRaw] = await Promise.all([
    fetchJsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', query),
    fetchJsonp('https://api.vworld.kr/ned/data/getLandUseAttr', query),
    fetchJsonp('https://api.vworld.kr/ned/data/getIndvdLandPriceAttr', query),
    fetchJsonp('https://api.vworld.kr/ned/data/getPossessionAttr', query),
  ]);

  const characteristics = dedupeRows(parseRowsFromVworld(characteristicRaw, 'landCharacteristicss'), [
    'ldCodeNm',
    'stdrYear',
    'stdrMt',
    'pblntfPclnd',
    'lndcgrCodeNm',
    'lndpclAr',
  ]);
  const landUses = dedupeRows(parseRowsFromVworld(landUseRaw, 'landUses'), [
    'prposAreaDstrcCodeNm',
    'cnflcAtNm',
    'registDt',
  ]);
  const prices = dedupeRows(parseRowsFromVworld(priceRaw, 'indvdLandPrices'), [
    'pblntfDe',
    'pblntfPclnd',
    'registDt',
  ]);
  const possessions = dedupeRows(parseRowsFromVworld(possessionRaw, 'possessions'), [
    'posesnSeCodeNm',
    'nationInsttSeCodeNm',
    'ownerNm',
    'ownerAddr',
    'ownshipChgDe',
  ]);

  return { characteristics, landUses, prices, possessions, source: 'vworld' as const };
}

async function fetchParcelTabDataFromCache(pnu: string): Promise<ParcelTabData | null> {
  try {
    const res = await call('', 'POST', {
      service: 'jijukLandAttrService',
      action: 'getParcelTabDataFromCache',
      params: { pnu },
    });
    const payload = (res?.data ?? res) as {
      hit?: boolean;
      characteristics?: JsonObject[];
      landUses?: JsonObject[];
      prices?: JsonObject[];
      possessions?: JsonObject[];
    };
    if (!payload?.hit) return null;
    return {
      characteristics: Array.isArray(payload.characteristics) ? payload.characteristics : [],
      landUses: Array.isArray(payload.landUses) ? payload.landUses : [],
      prices: Array.isArray(payload.prices) ? payload.prices : [],
      possessions: Array.isArray(payload.possessions) ? payload.possessions : [],
      source: 'cache' as const,
    };
  } catch {
    return null;
  }
}

export type ParcelTabData = {
  characteristics: JsonObject[];
  landUses: JsonObject[];
  prices: JsonObject[];
  possessions: JsonObject[];
  source: 'kras' | 'cache' | 'vworld' | 'mixed';
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

type ParcelTabPayloadLike = Omit<ParcelTabData, 'source'> & {
  source?: ParcelTabData['source'];
  ok?: boolean;
  error?: string;
};

function normalizeParcelTabPayload(payload: ParcelTabPayloadLike): ParcelTabData {
  const source =
    payload.source === 'kras' ||
    payload.source === 'cache' ||
    payload.source === 'vworld' ||
    payload.source === 'mixed'
      ? payload.source
      : 'cache';

  return {
    characteristics: Array.isArray(payload.characteristics) ? payload.characteristics : [],
    landUses: Array.isArray(payload.landUses) ? payload.landUses : [],
    prices: Array.isArray(payload.prices) ? payload.prices : [],
    possessions: Array.isArray(payload.possessions) ? payload.possessions : [],
    source,
  };
}

/** 행망·캐시 우선(서버) — 내용 없으면 브라우저 VWorld JSONP 폴백 (v6 동일) */
export async function fetchParcelTabData(args: { pnu: string; vworldKey: string }) {
  const pnu = toStr(args.pnu);
  if (!pnu) return emptyParcelTabData();

  try {
    const res = await call('', 'POST', {
      service: 'landLinkageService',
      action: 'fetchParcelLandInfoTab',
      params: { pnu },
    });
    const payload = (res?.data ?? res) as ParcelTabPayloadLike;
    if (payload?.ok !== false) {
      const tab = normalizeParcelTabPayload(payload);
      // 서버 VWorld 직접 호출은 키 도메인·망 제약으로 빈 결과가 올 수 있음 → 실데이터 있을 때만 사용
      if (hasParcelLandInfoTabData(tab)) {
        return tab;
      }
    }
  } catch {
    /* 서버 실패 시 클라이언트 fallback */
  }

  const cached = await fetchParcelTabDataFromCache(pnu);
  if (cached && hasParcelLandInfoTabData(cached)) return cached;

  if (!toStr(args.vworldKey)) return emptyParcelTabData();

  const fresh = await fetchParcelTabDataFromVworld(args);
  void cacheJijukLandAttrFromParcelData({
    pnu,
    characteristics: fresh.characteristics,
    landUses: fresh.landUses,
    prices: fresh.prices,
    possessions: fresh.possessions,
  });
  return fresh;
}

/** 필지정보(토지기본정보) 조회 결과를 public_layer.jijuk_land_attr에 캐시 */
export async function cacheJijukLandAttrFromParcelData(args: {
  pnu: string;
  characteristics: JsonObject[];
  landUses: JsonObject[];
  prices: JsonObject[];
  possessions: JsonObject[];
}): Promise<void> {
  const pnu = toStr(args.pnu);
  if (!pnu) return;
  try {
    await call('', 'POST', {
      service: 'jijukLandAttrService',
      action: 'upsertJijukLandAttrFromParcelData',
      params: {
        pnu,
        characteristics: args.characteristics,
        landUses: args.landUses,
        prices: args.prices,
        possessions: args.possessions,
      },
    });
  } catch {
    /* 캐시 실패는 UI 조회를 막지 않음 */
  }
}

/** 필지 PNU 기준 최신 공시지가 1건 — 캐시 우선, 없으면 VWorld */
export async function fetchLatestOfficialLandPriceForPnu(args: {
  pnu: string;
  vworldKey: string;
}): Promise<{ priceNum: number | null; priceLabel: string; jibun: string; source?: 'cache' | 'vworld' }> {
  const pnu = toStr(args.pnu);
  const vworldKey = toStr(args.vworldKey);
  if (!pnu) {
    return { priceNum: null, priceLabel: '-', jibun: '' };
  }

  try {
    const cacheRes = await call('', 'POST', {
      service: 'jijukLandAttrService',
      action: 'getJijukLandAttrByPnu',
      params: { pnu },
    });
    const cached = (cacheRes?.data ?? cacheRes) as { row?: { pblntf_pclnd?: unknown } | null };
    const cachedPrice = Number(cached?.row?.pblntf_pclnd);
    if (Number.isFinite(cachedPrice)) {
      return {
        priceNum: cachedPrice,
        priceLabel: `${cachedPrice.toLocaleString('ko-KR')}원/㎡`,
        jibun: '',
        source: 'cache',
      };
    }
  } catch {
    /* cache miss → VWorld */
  }

  if (!vworldKey) {
    return { priceNum: null, priceLabel: '-', jibun: '' };
  }

  const priceRaw = await fetchJsonp('https://api.vworld.kr/ned/data/getIndvdLandPriceAttr', {
    key: vworldKey,
    pnu,
    format: 'json',
    numOfRows: '1000',
  });
  const prices = dedupeRows(parseRowsFromVworld(priceRaw, 'indvdLandPrices'), [
    'pblntfDe',
    'pblntfPclnd',
    'registDt',
  ]);
  if (!prices.length) {
    return { priceNum: null, priceLabel: '-', jibun: '', source: 'vworld' };
  }
  const sorted = [...prices].sort((a, b) =>
    toStr(b.pblntfDe).localeCompare(toStr(a.pblntfDe))
  );
  const latest = sorted[0]!;
  const priceNum = Number(latest.pblntfPclnd);
  const priceLabel = Number.isFinite(priceNum)
    ? `${priceNum.toLocaleString('ko-KR')}원/㎡`
    : '-';
  const jibun = toStr(latest.ldCodeNm) || toStr(latest.jibun);

  if (Number.isFinite(priceNum)) {
    void call('', 'POST', {
      service: 'jijukLandAttrService',
      action: 'mergeJijukLandAttrSummary',
      params: { pnu, pblntfPclnd: priceNum },
    }).catch(() => undefined);
  }

  return {
    priceNum: Number.isFinite(priceNum) ? priceNum : null,
    priceLabel,
    jibun,
    source: 'vworld',
  };
}

function buildPnuQueryParams(pnu: string): URLSearchParams {
  const sigunguCd = pnu.slice(0, 5);
  const bjdongCd = pnu.slice(5, 10);
  const platGbCd = String(Math.max(Number(pnu.slice(10, 11)) - 1, 0));
  const bun = pnu.slice(11, 15);
  const ji = pnu.slice(15, 19);
  const qs = new URLSearchParams();
  qs.set('sigunguCd', sigunguCd);
  qs.set('bjdongCd', bjdongCd);
  qs.set('platGbCd', platGbCd);
  qs.set('bun', bun);
  qs.set('ji', ji);
  qs.set('numOfRows', '10');
  qs.set('pageNo', '1');
  qs.set('format', 'json');
  return qs;
}

export async function fetchBuildingLedgerRows(args: { pnu: string; dataPortalKey: string }): Promise<BuildingLedgerRow[]> {
  if (!args.dataPortalKey) return [];
  const qs = buildPnuQueryParams(args.pnu);
  qs.set('serviceKey', args.dataPortalKey);
  const requestUrl = `/api/public-data/building?kind=ledger&${qs.toString()}`;
  console.log('[landInfo:ledger:req]', { pnu: args.pnu, requestUrl, hasServiceKey: Boolean(args.dataPortalKey) });
  const text = await fetchText(requestUrl);
  const rows = parseXmlRows(text);
  console.log('[landInfo:ledger:res]', { pnu: args.pnu, rowCount: rows.length, bodySnippet: text.slice(0, 300) });
  return rows;
}

export async function fetchPermitRows(args: {
  pnu: string;
  dataPortalKey: string;
}): Promise<{ source: BuildingPermitSource; rows: BuildingLedgerRow[] }> {
  if (!args.dataPortalKey) return { source: null, rows: [] };
  const qs = buildPnuQueryParams(args.pnu);
  qs.set('serviceKey', args.dataPortalKey);
  const apUrl = `/api/public-data/building?kind=arch&${qs.toString()}`;
  console.log('[landInfo:permit:req]', { pnu: args.pnu, kind: 'arch', requestUrl: apUrl, hasServiceKey: Boolean(args.dataPortalKey) });
  const apText = await fetchText(apUrl);
  const apRows = parseXmlRows(apText);
  console.log('[landInfo:permit:res]', { pnu: args.pnu, kind: 'arch', rowCount: apRows.length, bodySnippet: apText.slice(0, 300) });
  if (apRows.length > 0) return { source: 'arch', rows: apRows };
  const hpUrl = `/api/public-data/building?kind=housing&${qs.toString()}`;
  console.log('[landInfo:permit:req]', { pnu: args.pnu, kind: 'housing', requestUrl: hpUrl, hasServiceKey: Boolean(args.dataPortalKey) });
  const hpText = await fetchText(hpUrl);
  const hpRows = parseXmlRows(hpText);
  console.log('[landInfo:permit:res]', { pnu: args.pnu, kind: 'housing', rowCount: hpRows.length, bodySnippet: hpText.slice(0, 300) });
  if (hpRows.length > 0) return { source: 'housing', rows: hpRows };
  return { source: null, rows: [] };
}
