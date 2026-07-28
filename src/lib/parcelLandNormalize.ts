/**
 * 필지 토지·소유 보강 공통 — 정규화·표시·우클릭 탭 매핑 (필지분석·필지정보 공유)
 */
import type { KrasBodyRecord } from '@/lib/krasLandUseXml';
import type { KrasLandInfoRow } from '@/lib/krasLandXml';
import { zonesFromKrasLandUseRows } from '@/lib/krasLandUseXml';

// —— 표시 라벨·출처 UI ——

/**
 * 연계 확인용 UI (출처 범례 문구 · 출처별 글자색 · «연계 브이월드» 배지).
 * false = 숨김. true로 바꾸면 다시 표시.
 */
export const SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI = false;

/** 지적·API에서 지목·소유구분을 알 수 없을 때 (통계·집계용) */
export const PARCEL_LAND_UNKNOWN_LABEL = '미상';

/** 연계 단계 전체 실패 — KRAS·브이월드 등에서 보강 행 없음 */
export const PARCEL_LAND_LINKAGE_FAIL_LABEL = '연계실패';

/** 연계실패 셀·값 title(툴팁) */
export const PARCEL_LAND_LINKAGE_FAIL_TITLE = '이 필지 토지 정보를 조회하지 못했습니다';

export type ParcelLandRowSource =
  | 'db'
  | 'kras'
  | 'koreps'
  | 'vworld'
  | 'seum'
  | 'portal'
  | 'mixed'
  | string
  | undefined;

export function normalizeParcelLandSource(source: ParcelLandRowSource): string {
  return String(source ?? '').trim().toLowerCase();
}

/** 연계 출처별 셀 색 (값이 있을 때만 적용) — 확인용 플래그 off면 무색 */
export function parcelLandLinkageSourceCellClass(source: ParcelLandRowSource): string | undefined {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return undefined;
  switch (normalizeParcelLandSource(source)) {
    case 'kras':
      return 'font-medium text-blue-700';
    case 'koreps':
      return 'font-medium text-indigo-700';
    case 'vworld':
      return 'font-medium text-emerald-700';
    case 'seum':
      return 'font-medium text-violet-700';
    case 'portal':
      return 'font-medium text-sky-700';
    default:
      return undefined;
  }
}

export function parcelLandLinkageSourceTitle(source: ParcelLandRowSource): string | undefined {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return undefined;
  const label = parcelLandLinkageSourceLabel(source);
  if (!label) return undefined;
  switch (normalizeParcelLandSource(source)) {
    case 'kras':
      return '행망(KRAS)에서 조회';
    case 'koreps':
      return '코렙스(공시지가)에서 조회';
    case 'vworld':
      return '브이월드에서 조회';
    case 'seum':
      return '세움터 적재 DB에서 조회';
    case 'portal':
      return '공공데이터포털에서 조회';
    case 'mixed':
      return '여러 연계 출처 혼합';
    default:
      return `${label}에서 조회`;
  }
}

/** 화면 표시용 짧은 연계 출처 (색상 범례·배지·열 텍스트) */
export function parcelLandLinkageSourceLabel(source: ParcelLandRowSource): string | undefined {
  if (!SHOW_PARCEL_LAND_LINKAGE_DEBUG_UI) return undefined;
  switch (normalizeParcelLandSource(source)) {
    case 'kras':
      return '행망';
    case 'koreps':
      return '코렙스';
    case 'vworld':
      return '브이월드';
    case 'seum':
      return '세움터';
    case 'portal':
      return '데이터포털';
    case 'mixed':
      return '혼합';
    default:
      return undefined;
  }
}

/** 지목 — 연계 실패와 무관, 미상·값·빈 값(-)만 */
export function formatParcelLandJimokValue(value: unknown): string {
  const s = String(value ?? '').trim();
  if (s === PARCEL_LAND_UNKNOWN_LABEL) return PARCEL_LAND_UNKNOWN_LABEL;
  return s || '-';
}

/**
 * 소유·공시 등 연계 전용 필드
 * - 보강 행 있음 + 빈 값 → '-' (연계는 됐으나 데이터 없음)
 * - 보강 행 없음 → '연계실패'
 */
export function formatParcelLandLinkageField(
  value: unknown,
  linkageFailed: boolean,
  allowUnknown = false
): string {
  const s = String(value ?? '').trim();
  if (allowUnknown && s === PARCEL_LAND_UNKNOWN_LABEL) return PARCEL_LAND_UNKNOWN_LABEL;
  if (!s || s === '-') {
    return linkageFailed ? PARCEL_LAND_LINKAGE_FAIL_LABEL : '-';
  }
  return s;
}

// —— 정규화·통계 ——

export type ParcelLandSource = 'db' | 'kras' | 'koreps' | 'vworld' | 'mixed';

/** PNU 단위 보강 결과 */
export type NormalizedParcelLand = {
  pnu: string;
  jimok: string;
  jimokNm: string;
  areaSqm: number;
  ownerName: string;
  ownerType: string;
  publicPrice: number | null;
  source: ParcelLandSource;
};

export type ParcelLandEnrichmentMap = Record<string, NormalizedParcelLand>;

export type AnalyzeLandRow = {
  pnu: string;
  jibun: string;
  jimok: string;
  areaSqm: number;
  ownerName?: string;
  ownerType?: string;
  publicPrice?: number | null;
  source?: ParcelLandSource;
  /** 연계 보강을 시도했으나 해당 PNU에 성공 응답이 없음 */
  linkageFailed?: boolean;
};

export type OwnerStatRow = { label: string; count: number; areaSqm: number };
export type JimokStatRow = { jimok: string; count: number; areaSqm: number };

function toNum(value: unknown): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function normalizeFromKrasRow(pnu: string, row: KrasLandInfoRow): NormalizedParcelLand {
  const jimokNm = toStr(row.JIMOK_NM) || toStr(row.JIMOK);
  const ownerType = toStr(row.OWN_GBN_NM) || toStr(row.OWN_GBN);
  return {
    pnu,
    jimok: toStr(row.JIMOK) || jimokNm,
    jimokNm,
    areaSqm: toNum(row.PAREA),
    ownerName: toStr(row.OWNER_NM),
    ownerType,
    publicPrice: toNum(row.PANN_JIGA) || null,
    source: 'kras',
  };
}

export function normalizeFromVworldParts(
  pnu: string,
  parts: {
    jimok?: string;
    jimokNm?: string;
    areaSqm?: number;
    ownerName?: string;
    ownerType?: string;
    publicPrice?: number | null;
  }
): NormalizedParcelLand {
  const jimokNm = toStr(parts.jimokNm) || toStr(parts.jimok);
  const ownerType = toStr(parts.ownerType);
  return {
    pnu,
    jimok: toStr(parts.jimok) || jimokNm,
    jimokNm,
    areaSqm: toNum(parts.areaSqm),
    ownerName: toStr(parts.ownerName),
    ownerType,
    publicPrice: parts.publicPrice ?? null,
    source: 'vworld',
  };
}

function mergeRow(base: AnalyzeLandRow, enrich?: NormalizedParcelLand): AnalyzeLandRow {
  if (!enrich) {
    return { ...base, linkageFailed: true };
  }
  const areaSqm = enrich.areaSqm > 0 ? enrich.areaSqm : base.areaSqm;
  const jimok =
    enrich.jimokNm && enrich.jimokNm !== PARCEL_LAND_UNKNOWN_LABEL
      ? enrich.jimokNm
      : enrich.jimok && enrich.jimok !== PARCEL_LAND_UNKNOWN_LABEL
        ? enrich.jimok
        : base.jimok;
  const ownerType =
    enrich.ownerType && enrich.ownerType !== PARCEL_LAND_UNKNOWN_LABEL
      ? enrich.ownerType
      : base.ownerType || '';
  const ownerName = enrich.ownerName
    ? toStr(enrich.ownerName) || '-'
    : base.ownerName ?? '-';
  const publicPrice = enrich.publicPrice ?? base.publicPrice ?? null;
  return {
    ...base,
    jimok,
    areaSqm,
    ownerName,
    ownerType,
    publicPrice,
    source: enrich.source,
    linkageFailed: false,
  };
}

/** 토지현황 목록 보강 — 소유·지목 통계는 호출측에서 재집계 */
export function applyEnrichmentToLandRows(
  landRows: AnalyzeLandRow[],
  enrichments: ParcelLandEnrichmentMap
): AnalyzeLandRow[] {
  return landRows.map((row) => mergeRow(row, enrichments[row.pnu]));
}

export function recomputeOwnerStats(rows: AnalyzeLandRow[]): OwnerStatRow[] {
  const map = new Map<string, { count: number; areaSqm: number }>();
  for (const row of rows) {
    const label = toStr(row.ownerType) || PARCEL_LAND_UNKNOWN_LABEL;
    const prev = map.get(label) ?? { count: 0, areaSqm: 0 };
    map.set(label, { count: prev.count + 1, areaSqm: prev.areaSqm + toNum(row.areaSqm) });
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, count: v.count, areaSqm: v.areaSqm }))
    .sort((a, b) => b.areaSqm - a.areaSqm);
}

export function recomputeJimokStats(rows: AnalyzeLandRow[]): JimokStatRow[] {
  const map = new Map<string, { count: number; areaSqm: number }>();
  for (const row of rows) {
    const jimok = toStr(row.jimok) || PARCEL_LAND_UNKNOWN_LABEL;
    const prev = map.get(jimok) ?? { count: 0, areaSqm: 0 };
    map.set(jimok, { count: prev.count + 1, areaSqm: prev.areaSqm + toNum(row.areaSqm) });
  }
  return [...map.entries()]
    .map(([jimok, v]) => ({ jimok, count: v.count, areaSqm: v.areaSqm }))
    .sort((a, b) => b.areaSqm - a.areaSqm);
}

// —— 우클릭 필지정보 탭 (KRAS → 화면 형식) ——

type JsonRow = Record<string, unknown>;

export type ParcelLandInfoTabData = {
  characteristics: JsonRow[];
  landUses: JsonRow[];
  prices: JsonRow[];
  possessions: JsonRow[];
  source: 'kras' | 'koreps' | 'vworld' | 'mixed';
};

function krasCtypeLabel(ctype: unknown): string {
  const c = toStr(ctype);
  if (c === '1') return '포함';
  if (c === '2') return '저촉';
  if (c === '3') return '접함';
  return c || '-';
}

function dedupeLandUseRows(rows: KrasBodyRecord[]): KrasBodyRecord[] {
  const seen = new Set<string>();
  const out: KrasBodyRecord[] = [];
  for (const row of rows) {
    const key = `${toStr(row.UNAME)}||${toStr(row.CTYPE)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** KRAS 토지대장·토지이용계획 → 우클릭 필지정보 탭 형식 */
export function mapKrasToParcelLandInfoTab(
  landRow: KrasLandInfoRow | null,
  useRows: KrasBodyRecord[]
): ParcelLandInfoTabData {
  const zones = zonesFromKrasLandUseRows(useRows);
  const dedupedUses = dedupeLandUseRows(useRows);

  const characteristics: JsonRow[] = [];
  if (landRow) {
    const row: JsonRow = {};
    const jimok = toStr(landRow.JIMOK_NM) || toStr(landRow.JIMOK);
    if (jimok) row.lndcgrCodeNm = jimok;
    if (toStr(landRow.PAREA)) row.lndpclAr = landRow.PAREA;
    if (zones[0]) row.prposArea1Nm = zones[0];
    if (toStr(landRow.LAND_MOV_RSN_CD_NM)) row.lndMoveResnNm = landRow.LAND_MOV_RSN_CD_NM;
    if (toStr(landRow.LAND_MOV_YMD)) row.lndMoveDe = landRow.LAND_MOV_YMD;
    if (Object.keys(row).length) characteristics.push(row);
  }

  const possessions: JsonRow[] = [];
  if (landRow && (toStr(landRow.OWNER_NM) || toStr(landRow.OWN_GBN_NM))) {
    possessions.push({
      posesnSeCodeNm: toStr(landRow.OWN_GBN_NM) || undefined,
      ownerNm: toStr(landRow.OWNER_NM) || undefined,
      ownerAddr: toStr(landRow.OWNER_ADDR) || undefined,
      cnrsPsnCo: toStr(landRow.SHR_CNT) || undefined,
      ownshipChgDe: toStr(landRow.OWNDYMD) || undefined,
      ownshipChgCauseCodeNm: toStr(landRow.OWN_RGT_CHG_RSN_CD_NM) || undefined,
    });
  }

  const prices: JsonRow[] = [];
  if (landRow && toStr(landRow.PANN_JIGA)) {
    prices.push({ pblntfPclnd: landRow.PANN_JIGA });
  }

  const landUses: JsonRow[] = dedupedUses.map((row) => ({
    prposAreaDstrcCodeNm: toStr(row.UNAME) || undefined,
    cnflcAtNm: krasCtypeLabel(row.CTYPE),
    registDt: toStr(row.LAWNM) || undefined,
  }));

  return {
    characteristics,
    landUses,
    prices,
    possessions,
    source: 'kras',
  };
}

export function hasParcelLandInfoTabData(data: {
  characteristics: unknown[];
  landUses: unknown[];
  prices: unknown[];
  possessions: unknown[];
}): boolean {
  return (
    data.characteristics.length > 0 ||
    data.landUses.length > 0 ||
    data.prices.length > 0 ||
    data.possessions.length > 0
  );
}

export function emptyParcelLandInfoTab(source: ParcelLandInfoTabData['source'] = 'vworld'): ParcelLandInfoTabData {
  return {
    characteristics: [],
    landUses: [],
    prices: [],
    possessions: [],
    source,
  };
}

/** PNU 19자리 → 공공데이터(건축·인허가) 쿼리 — 필지분석·우클릭 공용 */
export function buildPnuQueryParams(pnu: string): URLSearchParams {
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
