'use client';

import { useMemo } from 'react';
import { call } from '@/lib/api';
import {
  applyEnrichmentToLandRows,
  formatParcelLandJimokValue,
  formatParcelLandLinkageField,
  PARCEL_LAND_UNKNOWN_LABEL,
  recomputeJimokStats,
  recomputeOwnerStats,
  type AnalyzeLandRow,
} from '@/lib/parcelLandNormalize';
import { PARCEL_ANALYSIS_LINKAGE_CONCURRENCY } from '@/lib/parcelAnalysisTheme';
import {
  fetchLandInfoConfig,
  fetchVworldLandUseZonesBatch,
  fetchVworldParcelLandEnrichmentBatch,
} from '@/lib/vworldParcelLandClient';
import type { ParcelAnalysisGroupDef } from './ParcelAnalysis.items';
import { BASIC_MAP_COMPOSITE_SECTION_ID } from './parcelAnalysis.mapStyle';
import { formatAddressStripSidoSigungu } from '@/lib/formatAddressStripAdmin';

export type ParcelAnalysisLandRow = {
  pnu: string;
  addr: string;
  jimok: string;
  area: string;
  ownerType?: string;
  ownerName?: string;
  publicPrice?: string;
  /** 연계 출처 — 행망·코렙스·브이월드 등 (색상 범례) */
  linkageSource?: string;
  linkageFailed?: boolean;
};

export type ParcelAnalysisOwnerStat = { label: string; count: number; area: string; ratio: string };
export type ParcelAnalysisJimokStat = { jimok: string; count: number; area: string; ratio: string };
export type ParcelAnalysisLandUseStat = { zone: string; count: number; area: string; ratio: string };

export type ParcelAnalysisLandRowsProgress = { loaded: number; total: number; loading: boolean };

export type ParcelAnalysisBuildingRow = {
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
  linkageSource?: string;
};

export type ParcelAnalysisFacilityStatRow = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  stats: string;
  unit: string;
};

export type ParcelAnalysisResult = {
  parcelCount: number;
  totalAreaSqm: number;
  itemCount: number;
  landRows: ParcelAnalysisLandRow[];
  ownerStats: ParcelAnalysisOwnerStat[];
  jimokStats: ParcelAnalysisJimokStat[];
  buildingRows: ParcelAnalysisBuildingRow[];
  facilityStats: Record<string, ParcelAnalysisFacilityStatRow[]>;
  landUseStats: ParcelAnalysisLandUseStat[];
  landRowsProgress?: ParcelAnalysisLandRowsProgress;
  landUseProgress?: ParcelAnalysisLandRowsProgress;
  wkt5181?: string;
  /** 청크 연계 일부 실패 시 안내 (표·통계는 유지) — 토지·이용계획 등 */
  linkageNotice?: string;
  /** 건축물대장 전용 안내 (포털 쿼터 등) — 건축물대장 섹션에만 표시 */
  buildingLedgerNotice?: string;
};

/** 결과 모달 호환 alias */
export type MockParcelAnalysisResult = ParcelAnalysisResult;

export type ResultSectionKind =
  | 'land'
  | 'owner'
  | 'jimok'
  | 'landUse'
  | 'building'
  | 'basicMap'
  | 'facility'
  | 'placeholder';

export type ResultSectionDef = {
  id: string;
  groupTitle: string;
  itemTitle: string;
  kind: ResultSectionKind;
  /** 기본도 합성 지도 — 선택된 basicMap:* id 목록 */
  basicMapLayerIds?: string[];
  /** 시설목록 그룹 GeoServer WMS 레이어명(테이블명) */
  facilityWmsLayerKeys?: string[];
};

const ITEM_SECTION_MAP: Record<string, ResultSectionKind> = {
  'parcel:land': 'land',
  'parcel:owner': 'owner',
  'parcel:jimok': 'jimok',
  'parcel:landUse': 'landUse',
  'building:ledger': 'building',
  'basicMap:aerial': 'basicMap',
  'basicMap:jijuk': 'basicMap',
  'basicMap:building': 'basicMap',
  'basicMap:road': 'basicMap',
};

function resolveSectionKind(itemId: string): ResultSectionKind {
  if (ITEM_SECTION_MAP[itemId]) return ITEM_SECTION_MAP[itemId];
  if (itemId.startsWith('facility:')) return 'facility';
  return 'placeholder';
}

export function buildResultSections(
  selectedItemIds: string[],
  groups: ParcelAnalysisGroupDef[],
  facilityWmsLayerMap?: Record<string, string[]>
): ResultSectionDef[] {
  const sections: ResultSectionDef[] = [];
  const order = ['basicMap', 'building', 'parcel', 'facility'];

  for (const groupId of order) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) continue;

    if (groupId === 'basicMap') {
      const selectedBasic = group.items.filter((item) => selectedItemIds.includes(item.id));
      if (!selectedBasic.length) continue;
      const layerIds = selectedBasic.map((item) => item.id);
      sections.push({
        id: BASIC_MAP_COMPOSITE_SECTION_ID,
        groupTitle: group.title,
        itemTitle: group.title,
        kind: 'basicMap',
        basicMapLayerIds: layerIds,
      });
      continue;
    }

    for (const item of group.items) {
      if (!selectedItemIds.includes(item.id)) continue;
      const kind = resolveSectionKind(item.id);
      const wmsKeys = kind === 'facility' ? facilityWmsLayerMap?.[item.id] : undefined;
      sections.push({
        id: item.id,
        groupTitle: group.title,
        itemTitle: item.title,
        kind,
        facilityWmsLayerKeys: wmsKeys?.length ? wmsKeys : undefined,
      });
    }
  }
  return sections;
}

/** mapAnalyseService.analyzeParcels 응답(숫자 원본) */
export type AnalyzeParcelsResponse = {
  ok?: boolean;
  parcelCount?: number;
  totalAreaSqm?: number;
  ownerStats?: Array<{ label?: string; count?: number; areaSqm?: number }>;
  jimokStats?: Array<{ jimok?: string; count?: number; areaSqm?: number }>;
  landRows?: Array<{
    pnu?: string;
    jibun?: string;
    jimok?: string;
    areaSqm?: number;
    ownerName?: string;
    ownerType?: string;
    publicPrice?: number | null;
    source?: string;
    linkageFailed?: boolean;
  }>;
  error?: string;
};

export type AnalyzeExtendedResponse = AnalyzeParcelsResponse & {
  buildingRows?: Array<{
    pnu?: string;
    addr?: string;
    bldNm?: string;
    platLoc?: string;
    jibun?: string;
    roadAddr?: string;
    bcRat?: string;
    vlRat?: string;
    jijigu?: string;
    platArea?: string;
    totArea?: string;
    source?: string;
  }>;
  facilityStats?: Record<
    string,
    Array<{
      layerKey?: string;
      layerKorName?: string;
      geomType?: string;
      stats?: number;
      unit?: string;
    }>
  >;
  wkt5181?: string;
  landUseStats?: Array<{ zone?: string; count?: number; area?: string; ratio?: string }>;
  landRowsProgress?: { loaded?: number; total?: number; loading?: boolean };
  landUseProgress?: { loaded?: number; total?: number; loading?: boolean };
  linkageNotice?: string;
  buildingLedgerNotice?: string;
};

/** v6 스타일 결과 헤더: 「대표지번 외 N필지, 총면적」 (총면적=분석 영역 면적) */
export function formatParcelAnalysisHeader(params: {
  parcelCount: number;
  firstAddr?: string;
  scopeAreaSqm: number;
}): string {
  const areaText = `${Number(params.scopeAreaSqm).toLocaleString('ko-KR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}㎡`;
  const addr = String(params.firstAddr ?? '').trim();
  const count = Math.max(0, Number(params.parcelCount) || 0);

  if (count <= 0) return `총면적 ${areaText}`;
  if (count === 1 && addr) return `${addr}, 총면적 ${areaText}`;
  if (addr) return `${addr} 외 ${count - 1}필지, 총면적 ${areaText}`;
  return `${count}필지, 총면적 ${areaText}`;
}

function formatSqm(areaSqm: number): string {
  return `${Math.round(areaSqm).toLocaleString('ko-KR')}㎡`;
}

function ratioText(areaSqm: number, totalSqm: number): string {
  if (!(totalSqm > 0)) return '-';
  return `${((areaSqm / totalSqm) * 100).toFixed(1)}%`;
}

export const EMPTY_PARCEL_ANALYSIS_RESULT: ParcelAnalysisResult = {
  parcelCount: 0,
  totalAreaSqm: 0,
  itemCount: 0,
  landRows: [],
  ownerStats: [],
  jimokStats: [],
  buildingRows: [],
  facilityStats: {},
  landUseStats: [],
};

function formatPrice(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return `${Math.round(n).toLocaleString('ko-KR')}원/㎡`;
}

/** 서비스 숫자 응답 → 결과 모달 표시용 형태(면적·비율 문자열)로 변환 */
export function buildParcelAnalysisResult(
  res: AnalyzeExtendedResponse | null | undefined,
  itemCount: number
): ParcelAnalysisResult {
  if (!res) return { ...EMPTY_PARCEL_ANALYSIS_RESULT, itemCount };

  const totalAreaSqm = Math.round(Number(res.totalAreaSqm ?? 0)) || 0;

  const landRows = (res.landRows ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    const linkageFailed = Boolean(r.linkageFailed);
    const priceRaw = formatPrice(r.publicPrice);
    return {
      pnu: String(r.pnu ?? '').trim(),
      addr: String(r.jibun ?? '').trim() || String(r.pnu ?? '').trim(),
      jimok: formatParcelLandJimokValue(r.jimok),
      area: formatSqm(areaSqm),
      ownerType: formatParcelLandLinkageField(r.ownerType, linkageFailed, true),
      ownerName: formatParcelLandLinkageField(r.ownerName, linkageFailed),
      publicPrice: formatParcelLandLinkageField(
        priceRaw === '-' ? '' : priceRaw,
        linkageFailed
      ),
      linkageSource: String(r.source ?? '').trim() || undefined,
      linkageFailed,
    };
  });

  const ownerStats = (res.ownerStats ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    return {
      label: String(r.label ?? PARCEL_LAND_UNKNOWN_LABEL),
      count: Number(r.count ?? 0) || 0,
      area: formatSqm(areaSqm),
      ratio: ratioText(areaSqm, totalAreaSqm),
    };
  });

  const jimokStats = (res.jimokStats ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    return {
      jimok: String(r.jimok ?? PARCEL_LAND_UNKNOWN_LABEL),
      count: Number(r.count ?? 0) || 0,
      area: formatSqm(areaSqm),
      ratio: ratioText(areaSqm, totalAreaSqm),
    };
  });

  return {
    parcelCount: Number(res.parcelCount ?? 0) || 0,
    totalAreaSqm,
    itemCount,
    landRows,
    ownerStats,
    jimokStats,
    buildingRows: mapBuildingRows(res.buildingRows),
    facilityStats: mapFacilityStats(res.facilityStats),
    landUseStats: mapLandUseStats(res.landUseStats),
    landRowsProgress: mapProgress(res.landRowsProgress),
    landUseProgress: mapProgress(res.landUseProgress),
    wkt5181: res.wkt5181,
    linkageNotice: res.linkageNotice,
    buildingLedgerNotice: res.buildingLedgerNotice,
  };
}

function mapProgress(
  progress: AnalyzeExtendedResponse['landRowsProgress'] | undefined
): ParcelAnalysisResult['landRowsProgress'] {
  if (!progress) return undefined;
  return {
    loaded: Number(progress.loaded ?? 0) || 0,
    total: Number(progress.total ?? 0) || 0,
    loading: Boolean(progress.loading),
  };
}

function mapLandUseStats(
  rows: AnalyzeExtendedResponse['landUseStats'] | undefined
): ParcelAnalysisLandUseStat[] {
  return (rows ?? []).map((r) => ({
    zone: (() => {
      const z = String(r.zone ?? '').trim();
      if (!z || z === PARCEL_LAND_UNKNOWN_LABEL) return '-';
      return z;
    })(),
    count: Number(r.count ?? 0) || 0,
    area: String(r.area ?? '-'),
    ratio: String(r.ratio ?? '-'),
  }));
}

/** UI 확인용 건축물대장 더미 — true면 표에 3건 삽입. 확인 끝나면 false 유지 */
const USE_BUILDING_LEDGER_DUMMY = false;

/* true일 때만 사용 (아래 배열은 삭제하지 않고 보관)
const BUILDING_LEDGER_DUMMY_ROWS: NonNullable<AnalyzeExtendedResponse['buildingRows']> = [
  {
    pnu: '4776025022100010001',
    addr: '경상북도 영양군 영양읍 서부리 1',
    bldNm: '더미건물A',
    platLoc: '영양읍 서부리',
    jibun: '1',
    roadAddr: '경상북도 영양군 영양읍 중앙로 10',
    bcRat: '40%',
    vlRat: '80%',
    jijigu: '제1종일반주거지역',
    platArea: '200',
    totArea: '160',
    source: 'portal',
  },
  {
    pnu: '4776025022100010002',
    addr: '경상북도 영양군 영양읍 서부리 1-2',
    bldNm: '더미건물B',
    platLoc: '영양읍 서부리',
    jibun: '1-2',
    roadAddr: '경상북도 영양군 영양읍 중앙로 12',
    bcRat: '45%',
    vlRat: '100%',
    jijigu: '제1종일반주거지역',
    platArea: '180',
    totArea: '220',
    source: 'seum',
  },
  {
    pnu: '4776025022100010003',
    addr: '경상북도 영양군 영양읍 서부리 1-3',
    bldNm: '더미건물C',
    platLoc: '영양읍 서부리',
    jibun: '1-3',
    roadAddr: '경상북도 영양군 영양읍 중앙로 14',
    bcRat: '50%',
    vlRat: '120%',
    jijigu: '제1종일반주거지역',
    platArea: '250',
    totArea: '380',
    source: 'portal',
  },
];
*/

const BUILDING_LEDGER_DUMMY_ROWS: NonNullable<AnalyzeExtendedResponse['buildingRows']> = [];

function mapBuildingRows(
  rows: AnalyzeExtendedResponse['buildingRows'] | undefined
): ParcelAnalysisBuildingRow[] {
  const sourceRows = USE_BUILDING_LEDGER_DUMMY
    ? [...BUILDING_LEDGER_DUMMY_ROWS, ...(rows ?? [])]
    : (rows ?? []);
  const strip = (v: unknown) => {
    const t = String(v ?? '').trim();
    if (!t || t === '-') return t || '-';
    return formatAddressStripSidoSigungu(t) || t;
  };
  return sourceRows.map((r) => ({
    pnu: String(r.pnu ?? '').trim(),
    addr: strip(r.addr),
    bldNm: String(r.bldNm ?? '-'),
    platLoc: strip(r.platLoc),
    jibun: String(r.jibun ?? '-'),
    roadAddr: strip(r.roadAddr),
    bcRat: String(r.bcRat ?? '-'),
    vlRat: String(r.vlRat ?? '-'),
    jijigu: String(r.jijigu ?? '-'),
    platArea: String(r.platArea ?? '-'),
    totArea: String(r.totArea ?? '-'),
    linkageSource: r.source ? String(r.source).trim() : undefined,
  }));
}

function mapFacilityStats(
  stats: AnalyzeExtendedResponse['facilityStats'] | undefined
): Record<string, ParcelAnalysisFacilityStatRow[]> {
  const out: Record<string, ParcelAnalysisFacilityStatRow[]> = {};
  if (!stats) return out;
  for (const [key, rows] of Object.entries(stats)) {
    out[key] = (rows ?? []).map((r) => {
      const geom = String(r.geomType ?? 'POLYGON').toUpperCase();
      const geomType =
        geom === 'POINT' ? 'POINT' : geom === 'LINE' ? 'LINE' : 'POLYGON';
      const n = Number(r.stats ?? 0);
      return {
        layerKey: String(r.layerKey ?? ''),
        layerKorName: String(r.layerKorName ?? ''),
        geomType,
        stats: Number.isFinite(n) ? n.toLocaleString('ko-KR') : '0',
        unit: String(r.unit ?? ''),
      };
    });
  }
  return out;
}

type ZoneBucket = { count: number; areaSqm: number };

/** 청크별 용도지역 집계를 기존 누적에 합산 */
export function mergeLandUseZoneChunk(
  prev: Map<string, ZoneBucket>,
  parcels: Array<{ pnu: string; areaSqm: number }>,
  zonesByPnu: Record<string, string[]>
): Map<string, ZoneBucket> {
  const next = new Map(prev);
  for (const parcel of parcels) {
    const zones = zonesByPnu[parcel.pnu] ?? [];
    const label = zones.find((z) => z.trim())?.trim() || '-';
    const cur = next.get(label) ?? { count: 0, areaSqm: 0 };
    next.set(label, {
      count: cur.count + 1,
      areaSqm: cur.areaSqm + Math.max(0, Math.round(parcel.areaSqm)),
    });
  }
  return next;
}

export function landUseBucketToStats(
  buckets: Map<string, ZoneBucket>,
  totalAreaSqm: number
): ParcelAnalysisLandUseStat[] {
  return [...buckets.entries()]
    .map(([zone, { count, areaSqm }]) => ({
      zone,
      count,
      area: formatSqm(areaSqm),
      ratio: ratioText(areaSqm, totalAreaSqm),
    }))
    .sort((a, b) => {
      const areaA = Number(a.area.replace(/[^\d]/g, '')) || 0;
      const areaB = Number(b.area.replace(/[^\d]/g, '')) || 0;
      return areaB - areaA;
    });
}

/** 필지분석 토지현황 점진 로딩 청크 크기(클라이언트 전용). */
export const PARCEL_ANALYSIS_LAND_CHUNK = 100;

export {
  PARCEL_ANALYSIS_BUILDING_CONCURRENCY,
  PARCEL_ANALYSIS_LINKAGE_CONCURRENCY,
} from '@/lib/parcelAnalysisTheme';

type LandRow = NonNullable<AnalyzeExtendedResponse['landRows']>[number];

type ProgressiveLoadParams = {
  runId: number;
  isCancelled: () => boolean;
  wkt5181: string;
  totalCount: number;
  totalAreaSqm: number;
  selectedIds: Set<string>;
  facilityLayerMap: Record<string, Array<{ layerKey?: string; layerKorName?: string; geomType?: string; schema?: string }>>;
  onPatch: (patch: Partial<AnalyzeExtendedResponse>) => void;
  onEnriching: (active: boolean) => void;
};

function mergeEnrichedRows(all: LandRow[], enriched: LandRow[]): LandRow[] {
  if (!enriched.length) return all;
  const byPnu = new Map(enriched.map((r) => [String(r.pnu ?? ''), r]));
  return all.map((r) => byPnu.get(String(r.pnu ?? '')) ?? r);
}

async function listLandRows(
  wkt5181: string,
  offset: number,
  limit: number
): Promise<LandRow[]> {
  const res = await call('', 'POST', {
    service: 'mapAnalyseService',
    action: 'listAnalyzeLandRows',
    params: { wkt5181, offset, limit },
  });
  const data = (res?.data ?? res) as { ok?: boolean; landRows?: LandRow[] };
  return data?.ok ? (data.landRows ?? []) : [];
}

async function enrichRows(rows: LandRow[]): Promise<LandRow[]> {
  if (!rows.length) return rows;
  const res = await call('', 'POST', {
    service: 'mapAnalyseService',
    action: 'enrichParcelLandRows',
    params: { landRows: rows },
  });
  const data = (res?.data ?? res) as { ok?: boolean; landRows?: LandRow[] };
  let enriched: LandRow[] = data?.ok && data.landRows ? data.landRows : rows;

  const needsClientVworld = enriched.some((r) => r.linkageFailed);
  if (!needsClientVworld || typeof document === 'undefined') return enriched;

  const { vworldKey } = await fetchLandInfoConfig();
  if (!vworldKey) return enriched;

  const failedPnus = enriched
    .filter((r) => r.linkageFailed && /^\d{19}$/.test(String(r.pnu ?? '')))
    .map((r) => String(r.pnu));
  if (!failedPnus.length) return enriched;

  const vworldMap = await fetchVworldParcelLandEnrichmentBatch(
    failedPnus,
    vworldKey,
    PARCEL_ANALYSIS_LINKAGE_CONCURRENCY
  );
  if (!Object.keys(vworldMap).length) return enriched;

  const baseRows = enriched.map((r) => ({
    pnu: String(r.pnu ?? '').trim(),
    jibun: String(r.jibun ?? '').trim(),
    jimok: String(r.jimok ?? '미상'),
    areaSqm: Number(r.areaSqm ?? 0) || 0,
    ownerType: String(r.ownerType ?? '').trim(),
    ownerName: r.ownerName,
    publicPrice: r.publicPrice ?? null,
    source: r.source as 'db' | 'kras' | 'koreps' | 'vworld' | 'mixed' | undefined,
  }));

  const merged = applyEnrichmentToLandRows(baseRows, vworldMap);
  return merged.map((r) => ({
    pnu: r.pnu,
    jibun: r.jibun,
    jimok: r.jimok,
    areaSqm: r.areaSqm,
    ownerName: r.ownerName,
    ownerType: r.ownerType,
    publicPrice: r.publicPrice ?? null,
    source: r.source,
    linkageFailed: r.linkageFailed,
  }));
}

async function fetchBuildingChunk(
  rows: LandRow[]
): Promise<{
  rows: NonNullable<AnalyzeExtendedResponse['buildingRows']>;
  notice?: string;
}> {
  if (!rows.length) return { rows: [] };
  const res = await call('', 'POST', {
    service: 'mapAnalyseService',
    action: 'fetchBuildingLedgersForParcels',
    params: {
      parcels: rows.map((r) => ({ pnu: r.pnu, jibun: r.jibun })),
    },
  });
  const data = (res?.data ?? res) as {
    ok?: boolean;
    rows?: NonNullable<AnalyzeExtendedResponse['buildingRows']>;
    notice?: string;
    portalQuotaExceeded?: boolean;
  };
  const notice = data?.notice
    ? data.notice
    : data?.portalQuotaExceeded
      ? '공공데이터포털 호출 한도(쿼터)를 초과해 건축물대장을 가져오지 못했습니다.'
      : undefined;
  if (notice && typeof console !== 'undefined') {
    console.warn('[필지분석·건축물대장]', notice);
  }
  return {
    rows: data?.ok && data.rows ? data.rows : [],
    notice,
  };
}

async function fetchLandUseZones(pnus: string[]): Promise<Record<string, string[]>> {
  if (!pnus.length) return {};
  const res = await call('', 'POST', {
    service: 'mapAnalyseService',
    action: 'fetchLandUseZonesByPnus',
    params: { pnus },
  });
  const data = (res?.data ?? res) as { ok?: boolean; zonesByPnu?: Record<string, string[]> };
  let zonesByPnu = data?.ok ? (data.zonesByPnu ?? {}) : {};

  const missing = pnus.filter((p) => !(zonesByPnu[p]?.length > 0));
  if (!missing.length || typeof document === 'undefined') return zonesByPnu;

  const { vworldKey } = await fetchLandInfoConfig();
  if (!vworldKey) return zonesByPnu;

  const clientZones = await fetchVworldLandUseZonesBatch(
    missing,
    vworldKey,
    PARCEL_ANALYSIS_LINKAGE_CONCURRENCY
  );
  return { ...zonesByPnu, ...clientZones };
}

async function loadFacilityStats(
  wkt5181: string,
  facilityIds: string[],
  facilityLayerMap: ProgressiveLoadParams['facilityLayerMap'],
  isCancelled: () => boolean
): Promise<AnalyzeExtendedResponse['facilityStats']> {
  const stats: NonNullable<AnalyzeExtendedResponse['facilityStats']> = {};
  await Promise.all(
    facilityIds.map(async (facilityId) => {
      if (isCancelled()) return;
      const layers = facilityLayerMap[facilityId];
      if (!layers?.length) return;
      try {
        const statRes = await call('', 'POST', {
          service: 'mapAnalyseService',
          action: 'selectLayerStatsByWkt',
          params: { wkt5181, layers },
        });
        const stat = (statRes?.data ?? statRes) as {
          ok?: boolean;
          rows?: NonNullable<AnalyzeExtendedResponse['facilityStats']>[string];
        };
        if (stat?.ok && stat.rows?.length) stats[facilityId] = stat.rows;
      } catch {
        /* 무시 */
      }
    })
  );
  return stats;
}

/** 토지현황·보강·건축물·토지이용계획을 100건 청크로 로딩 (청크 내 보강·건축물·이용계획 병렬) */
export async function runParcelAnalysisProgressiveLoad(params: ProgressiveLoadParams): Promise<void> {
  const {
    wkt5181,
    totalCount,
    totalAreaSqm,
    selectedIds,
    facilityLayerMap,
    onPatch,
    onEnriching,
    isCancelled,
  } = params;

  const needsLand = selectedIds.has('parcel:land');
  const needsOwner = selectedIds.has('parcel:owner');
  const needsJimok = selectedIds.has('parcel:jimok');
  /** 소유·지목은 지적 DB에 없어 브이월드 보강 후 재집계 */
  const needsEnrich = needsLand || needsOwner || needsJimok;
  const needsBuilding = selectedIds.has('building:ledger');
  const needsLandUse = selectedIds.has('parcel:landUse');
  const needsLandRowPages =
    needsLand || needsBuilding || needsLandUse || needsOwner || needsJimok;

  const facilityIds = [...selectedIds].filter((id) => id.startsWith('facility:'));
  const facilityPromise =
    facilityIds.length > 0
      ? loadFacilityStats(wkt5181, facilityIds, facilityLayerMap, isCancelled).then((stats) => {
          if (!isCancelled() && stats && Object.keys(stats).length) {
            onPatch({ facilityStats: stats });
          }
        })
      : Promise.resolve();

  if (!needsLandRowPages) {
    await facilityPromise;
    return;
  }

  let allLandRows: LandRow[] = [];
  let allBuildingRows: NonNullable<AnalyzeExtendedResponse['buildingRows']> = [];
  let landUseBuckets = new Map<string, { count: number; areaSqm: number }>();
  let landUseStats: ParcelAnalysisLandUseStat[] = [];
  let offset = 0;
  let enrichFailChunks = 0;
  let buildingFailChunks = 0;
  let landUseFailChunks = 0;
  let buildingPortalQuotaNotice: string | undefined;

  const patchProgress = (loading: boolean) => {
    const notices: string[] = [];
    if (enrichFailChunks > 0) notices.push(`소유·공시 연계 일부 실패 ${enrichFailChunks}구간`);
    if (buildingFailChunks > 0 && !buildingPortalQuotaNotice) {
      notices.push(`건축물대장 일부 실패 ${buildingFailChunks}구간`);
    }
    if (landUseFailChunks > 0) notices.push(`토지이용계획 일부 실패 ${landUseFailChunks}구간`);

    const forStats: AnalyzeLandRow[] = allLandRows.map((r) => ({
      pnu: String(r.pnu ?? '').trim(),
      jibun: String(r.jibun ?? '').trim(),
      jimok: String(r.jimok ?? '').trim() || '미상',
      areaSqm: Number(r.areaSqm ?? 0) || 0,
      ownerType: String(r.ownerType ?? '').trim(),
      ownerName: r.ownerName,
      publicPrice: r.publicPrice ?? null,
      source: r.source as AnalyzeLandRow['source'],
      linkageFailed: r.linkageFailed,
    }));

    onPatch({
      ...(needsLand || needsOwner || needsJimok
        ? {
            landRows: allLandRows,
            ...(needsLand
              ? {
                  landRowsProgress: {
                    loaded: allLandRows.length,
                    total: totalCount,
                    loading,
                  },
                }
              : {}),
          }
        : {}),
      ...(needsOwner ? { ownerStats: recomputeOwnerStats(forStats) } : {}),
      ...(needsJimok ? { jimokStats: recomputeJimokStats(forStats) } : {}),
      buildingRows: allBuildingRows,
      landUseStats,
      landUseProgress: needsLandUse
        ? { loaded: allLandRows.length, total: totalCount, loading: loading && needsLandUse }
        : undefined,
      linkageNotice: notices.length
        ? `${notices.join(' · ')}. 표시된 표·통계는 유지됩니다.`
        : undefined,
      buildingLedgerNotice: buildingPortalQuotaNotice,
    });
  };

  while (offset < totalCount && !isCancelled()) {
    const pageRows = await listLandRows(wkt5181, offset, PARCEL_ANALYSIS_LAND_CHUNK);
    if (isCancelled()) return;
    if (!pageRows.length) break;

    allLandRows = [...allLandRows, ...pageRows];
    offset += pageRows.length;
    patchProgress(offset < totalCount);

    const chunkTasks: Promise<void>[] = [];

    if (needsEnrich) {
      chunkTasks.push(
        (async () => {
          onEnriching(true);
          try {
            const enriched = await enrichRows(pageRows);
            if (!isCancelled()) {
              allLandRows = mergeEnrichedRows(allLandRows, enriched);
              patchProgress(offset < totalCount);
            }
          } catch {
            enrichFailChunks += 1;
            patchProgress(offset < totalCount);
          } finally {
            if (!isCancelled()) onEnriching(offset < totalCount);
          }
        })()
      );
    }

    if (needsBuilding) {
      chunkTasks.push(
        (async () => {
          try {
            const chunkBld = await fetchBuildingChunk(pageRows);
            if (chunkBld.notice) buildingPortalQuotaNotice = chunkBld.notice;
            if (!isCancelled() && chunkBld.rows.length) {
              allBuildingRows = [...allBuildingRows, ...chunkBld.rows];
            }
            if (!isCancelled()) patchProgress(offset < totalCount);
          } catch {
            buildingFailChunks += 1;
            patchProgress(offset < totalCount);
          }
        })()
      );
    }

    if (needsLandUse) {
      chunkTasks.push(
        (async () => {
          try {
            const pnus = pageRows.map((r) => String(r.pnu ?? '')).filter((p) => /^\d{19}$/.test(p));
            const zonesByPnu = await fetchLandUseZones(pnus);
            if (!isCancelled()) {
              landUseBuckets = mergeLandUseZoneChunk(
                landUseBuckets,
                pageRows.map((r) => ({
                  pnu: String(r.pnu ?? ''),
                  areaSqm: Number(r.areaSqm ?? 0) || 0,
                })),
                zonesByPnu
              );
              landUseStats = landUseBucketToStats(landUseBuckets, totalAreaSqm);
              patchProgress(offset < totalCount);
            }
          } catch {
            landUseFailChunks += 1;
            patchProgress(offset < totalCount);
          }
        })()
      );
    }

    if (chunkTasks.length) await Promise.all(chunkTasks);

    if (pageRows.length < PARCEL_ANALYSIS_LAND_CHUNK) break;
  }

  if (!isCancelled()) {
    patchProgress(false);
    onEnriching(false);
  }

  await facilityPromise;
}

export function useParcelAnalysisResultSections(
  selectedItemIds: string[],
  groups: ParcelAnalysisGroupDef[],
  facilityWmsLayerMap?: Record<string, string[]>
) {
  const sections = useMemo(
    () => buildResultSections(selectedItemIds, groups, facilityWmsLayerMap),
    [selectedItemIds, groups, facilityWmsLayerMap]
  );

  return { sections };
}
