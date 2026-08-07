'use client';

/**
 * 브이월드 NED 토지 API — 브라우저 JSONP 전용.
 * 서버 fetch는 도메인·키 제한으로 INCORRECT_KEY가 나는 경우가 많아 필지분석 보강 fallback으로 쓴다.
 * 지도 클라이언트 키(config)도 이 파일에서 조회한다.
 */
import { call } from '@/lib/api';
import {
  normalizeFromVworldParts,
  type NormalizedParcelLand,
  type ParcelLandEnrichmentMap,
} from '@/lib/parcelLandNormalize';

type JsonObject = Record<string, unknown>;

// —— 지도 클라이언트 키 (DB·건축물 fetch 미포함) ——

export type LandInfoMapConfig = {
  vworldKey: string;
  dataPortalKey: string;
};

const DEFAULT_DATA_PORTAL_KEY =
  'dpeDzr70q5P1mLRdtcj1YVE3Po0OCaBEf6Wyi1SSErnKBu3XzCLnQiYxknChirRI9LybE2vSMEn0SZ/rRYytdw==';

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function toNum(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function getAnyString(row: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
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

/** 브이월드 NED 응답 field 배열 파싱 — 우클릭·필지분석 공용 */
export function parseRowsFromVworld(payload: JsonObject | null, rootKey: string): JsonObject[] {
  if (!payload) return [];
  const root = payload[rootKey] as JsonObject | undefined;
  if (toStr(root?.resultCode) && toStr(root?.resultCode) !== 'OK') return [];
  const field = root?.field;
  if (Array.isArray(field)) return field.filter((v): v is JsonObject => !!v && typeof v === 'object');
  if (field && typeof field === 'object') return [field as JsonObject];
  return [];
}

/** 토지특성 — 기준연월 내림차순 (필지분석 보강과 동일) */
export function sortCharacteristicsLatestFirst(rows: JsonObject[]): JsonObject[] {
  return [...rows].sort((a, b) => {
    const yearCmp = toStr(b.stdrYear).localeCompare(toStr(a.stdrYear));
    if (yearCmp !== 0) return yearCmp;
    return toStr(b.stdrMt).localeCompare(toStr(a.stdrMt));
  });
}

/** 개별공시 — 공시일자 내림차순 (필지분석 보강과 동일) */
export function sortPricesLatestFirst(rows: JsonObject[]): JsonObject[] {
  return [...rows].sort((a, b) => {
    const dateCmp = toStr(b.pblntfDe).localeCompare(toStr(a.pblntfDe));
    if (dateCmp !== 0) return dateCmp;
    return toStr(b.stdrYear).localeCompare(toStr(a.stdrYear));
  });
}

/** 소유 — 변동일자·기준년월 내림차순 */
export function sortPossessionsLatestFirst(rows: JsonObject[]): JsonObject[] {
  return [...rows].sort((a, b) => {
    const chgCmp = toStr(b.ownshipChgDe).localeCompare(toStr(a.ownshipChgDe));
    if (chgCmp !== 0) return chgCmp;
    return toStr(b.stdrYm).localeCompare(toStr(a.stdrYm));
  });
}

function sortLatestCharacteristic(rows: JsonObject[]): JsonObject | undefined {
  return sortCharacteristicsLatestFirst(rows)[0];
}

function sortLatestPrice(rows: JsonObject[]): JsonObject | undefined {
  return sortPricesLatestFirst(rows)[0];
}

/** 브라우저 JSONP — 우클릭·필지분석·공시지가 레이어 공용 */
export async function fetchVworldJsonp(
  url: string,
  query: Record<string, string>
): Promise<JsonObject | null> {
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
    setTimeout(() => finish(null), 12_000);
  });
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

export type VworldParcelTabRaw = {
  characteristics: JsonObject[];
  landUses: JsonObject[];
  prices: JsonObject[];
  possessions: JsonObject[];
  source: 'vworld';
};

/** 우클릭 필지정보 탭 — 브이월드 4종 raw (서버 행망 실패·dev 폴백) */
export async function fetchVworldParcelTabData(args: {
  pnu: string;
  vworldKey: string;
}): Promise<VworldParcelTabRaw> {
  const query = {
    key: args.vworldKey,
    pnu: args.pnu,
    format: 'json',
    numOfRows: '1000',
  };
  const base = 'https://api.vworld.kr/ned/data';
  const [characteristicRaw, landUseRaw, priceRaw, possessionRaw] = await Promise.all([
    fetchVworldJsonp(`${base}/getLandCharacteristics`, query),
    fetchVworldJsonp(`${base}/getLandUseAttr`, query),
    fetchVworldJsonp(`${base}/getIndvdLandPriceAttr`, query),
    fetchVworldJsonp(`${base}/getPossessionAttr`, query),
  ]);

  return {
    characteristics: sortCharacteristicsLatestFirst(
      dedupeRows(parseRowsFromVworld(characteristicRaw, 'landCharacteristicss'), [
        'ldCodeNm',
        'stdrYear',
        'stdrMt',
        'pblntfPclnd',
        'lndcgrCodeNm',
        'lndpclAr',
      ])
    ),
    landUses: dedupeRows(parseRowsFromVworld(landUseRaw, 'landUses'), [
      'prposAreaDstrcCodeNm',
      'cnflcAtNm',
      'registDt',
    ]),
    prices: sortPricesLatestFirst(
      dedupeRows(parseRowsFromVworld(priceRaw, 'indvdLandPrices'), [
        'pblntfDe',
        'pblntfPclnd',
        'registDt',
      ])
    ),
    possessions: sortPossessionsLatestFirst(
      dedupeRows(parseRowsFromVworld(possessionRaw, 'possessions'), [
        'posesnSeCodeNm',
        'nationInsttSeCodeNm',
        'ownerNm',
        'ownerAddr',
        'ownshipChgDe',
      ])
    ),
    source: 'vworld',
  };
}

/** 공시지가 지도 레이어 — 최신 1건 */
export async function fetchVworldLatestOfficialLandPrice(args: {
  pnu: string;
  vworldKey: string;
}): Promise<{ priceNum: number | null; priceLabel: string; jibun: string; source?: 'vworld' }> {
  const pnu = toStr(args.pnu);
  const vworldKey = toStr(args.vworldKey);
  if (!pnu || !vworldKey) {
    return { priceNum: null, priceLabel: '-', jibun: '' };
  }

  const priceRaw = await fetchVworldJsonp('https://api.vworld.kr/ned/data/getIndvdLandPriceAttr', {
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
  const latest = sortLatestPrice(prices);
  if (!latest) {
    return { priceNum: null, priceLabel: '-', jibun: '', source: 'vworld' };
  }
  const priceNum = Number(latest.pblntfPclnd);
  const priceLabel = Number.isFinite(priceNum)
    ? `${priceNum.toLocaleString('ko-KR')}원/㎡`
    : '-';
  const jibun = toStr(latest.ldCodeNm) || toStr(latest.jibun);

  return {
    priceNum: Number.isFinite(priceNum) ? priceNum : null,
    priceLabel,
    jibun,
    source: 'vworld',
  };
}

async function fetchVworldParcelLandForPnu(pnu: string, vworldKey: string): Promise<NormalizedParcelLand | null> {
  if (!vworldKey || !/^\d{19}$/.test(pnu)) return null;
  const query = {
    key: vworldKey,
    pnu,
    format: 'json',
    numOfRows: '1000',
  };
  const base = 'https://api.vworld.kr/ned/data';
  const [charRaw, possRaw, priceRaw] = await Promise.all([
    fetchVworldJsonp(`${base}/getLandCharacteristics`, query),
    fetchVworldJsonp(`${base}/getPossessionAttr`, query),
    fetchVworldJsonp(`${base}/getIndvdLandPriceAttr`, query),
  ]);
  const char = sortLatestCharacteristic(parseRowsFromVworld(charRaw, 'landCharacteristicss'));
  const poss = sortPossessionsLatestFirst(parseRowsFromVworld(possRaw, 'possessions'))[0];
  const price = sortLatestPrice(parseRowsFromVworld(priceRaw, 'indvdLandPrices'));
  if (!char && !poss && !price) return null;
  return normalizeFromVworldParts(pnu, {
    jimok: toStr(char?.lndcgrCodeNm),
    jimokNm: toStr(char?.lndcgrCodeNm),
    areaSqm: toNum(char?.lndpclAr),
    ownerName: toStr(poss?.ownerNm),
    ownerType: toStr(poss?.posesnSeCodeNm) || toStr(poss?.nationInsttSeCodeNm),
    publicPrice: toNum(price?.pblntfPclnd) || null,
  });
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return out;
}

/** PNU 목록 — 브라우저 JSONP로 토지 이용계획(용도지역) */
export async function fetchVworldLandUseZonesBatch(
  pnus: string[],
  vworldKey: string,
  concurrency = 8
): Promise<Record<string, string[]>> {
  const unique = [...new Set(pnus.map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  if (!unique.length || !vworldKey) return {};
  const results = await mapPool(unique, concurrency, (pnu) => fetchVworldLandUseForPnu(pnu, vworldKey));
  const out: Record<string, string[]> = {};
  unique.forEach((pnu, i) => {
    const zones = results[i] ?? [];
    if (zones.length) out[pnu] = zones;
  });
  return out;
}

async function fetchVworldLandUseForPnu(pnu: string, vworldKey: string): Promise<string[]> {
  if (!vworldKey) return [];
  const raw = await fetchVworldJsonp('https://api.vworld.kr/ned/data/getLandUseAttr', {
    key: vworldKey,
    pnu,
    format: 'json',
    numOfRows: '1000',
  });
  const rows = parseRowsFromVworld(raw, 'landUses');
  const zones = new Set<string>();
  for (const row of rows) {
    const label = toStr(row.prposAreaDstrcCodeNm);
    if (label) zones.add(label);
  }
  return [...zones];
}

/** PNU 목록 — 브라우저 JSONP로 토지 보강 (필지분석 서버 연계 실패 시) */
export async function fetchVworldParcelLandEnrichmentBatch(
  pnus: string[],
  vworldKey: string,
  concurrency = 8
): Promise<ParcelLandEnrichmentMap> {
  const unique = [...new Set(pnus.map((p) => toStr(p)).filter((p) => /^\d{19}$/.test(p)))];
  if (!unique.length || !vworldKey) return {};
  const results = await mapPool(unique, concurrency, (pnu) => fetchVworldParcelLandForPnu(pnu, vworldKey));
  const out: ParcelLandEnrichmentMap = {};
  unique.forEach((pnu, i) => {
    const row = results[i];
    if (row) out[pnu] = row;
  });
  return out;
}
