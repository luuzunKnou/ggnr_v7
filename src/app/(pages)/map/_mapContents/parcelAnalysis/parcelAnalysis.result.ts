'use client';

import { useMemo } from 'react';
import { call } from '@/lib/api';
import type { ParcelAnalysisGroupDef } from './ParcelAnalysis.items';
import { BASIC_MAP_COMPOSITE_SECTION_ID } from './parcelAnalysis.mapStyle';

export type MockLandRow = {
  pnu: string;
  addr: string;
  jimok: string;
  area: string;
  ownerType?: string;
  ownerName?: string;
  publicPrice?: string;
};

export type MockOwnerStat = { label: string; count: number; area: string; ratio: string };
export type MockJimokStat = { jimok: string; count: number; area: string; ratio: string };
export type MockLandUseStat = { zone: string; count: number; area: string; ratio: string };

export type MockLandRowsProgress = { loaded: number; total: number; loading: boolean };

export type MockBuildingRow = {
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
};

export type MockFacilityStatRow = {
  layerKey: string;
  layerKorName: string;
  geomType: 'POINT' | 'LINE' | 'POLYGON';
  stats: string;
  unit: string;
};

export type MockParcelAnalysisResult = {
  parcelCount: number;
  totalAreaSqm: number;
  itemCount: number;
  landRows: MockLandRow[];
  ownerStats: MockOwnerStat[];
  jimokStats: MockJimokStat[];
  buildingRows: MockBuildingRow[];
  facilityStats: Record<string, MockFacilityStatRow[]>;
  landUseStats: MockLandUseStat[];
  landRowsProgress?: MockLandRowsProgress;
  landUseProgress?: MockLandRowsProgress;
  wkt5181?: string;
  /** 청크 연계 일부 실패 시 안내 (표·통계는 유지) */
  linkageNotice?: string;
};

export function buildMockParcelAnalysisResult(selectedItemIds: string[]): MockParcelAnalysisResult {
  const landRows: MockLandRow[] = [
    { pnu: '4711110100100010001', addr: '동부동 123', jimok: '대', area: '1,240㎡', ownerType: '개인' },
    { pnu: '4711110100100010002', addr: '동부동 124', jimok: '전', area: '890㎡', ownerType: '국유' },
    { pnu: '4711110100100020001', addr: '송정리 45-1', jimok: '답', area: '2,100㎡', ownerType: '개인' },
  ];

  return {
    parcelCount: 12,
    totalAreaSqm: 42000,
    itemCount: selectedItemIds.length,
    landRows: selectedItemIds.some((id) => id.startsWith('parcel:land')) ? landRows : [],
    ownerStats: selectedItemIds.some((id) => id.startsWith('parcel:owner'))
      ? [
          { label: '개인', count: 8, area: '28,000㎡', ratio: '66.7%' },
          { label: '국유', count: 3, area: '11,000㎡', ratio: '26.2%' },
          { label: '법인', count: 1, area: '3,000㎡', ratio: '7.1%' },
        ]
      : [],
    jimokStats: selectedItemIds.some((id) => id.startsWith('parcel:jimok'))
      ? [
          { jimok: '대', count: 5, area: '19,000㎡', ratio: '45.2%' },
          { jimok: '전', count: 4, area: '14,000㎡', ratio: '33.3%' },
          { jimok: '답', count: 3, area: '9,000㎡', ratio: '21.5%' },
        ]
      : [],
    buildingRows: [],
    facilityStats: {},
    landUseStats: selectedItemIds.includes('parcel:landUse')
      ? [{ zone: '제2종일반주거지역', count: 5, area: '12,000㎡', ratio: '28.6%' }]
      : [],
  };
}

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

export const EMPTY_PARCEL_ANALYSIS_RESULT: MockParcelAnalysisResult = {
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
): MockParcelAnalysisResult {
  if (!res) return { ...EMPTY_PARCEL_ANALYSIS_RESULT, itemCount };

  const totalAreaSqm = Math.round(Number(res.totalAreaSqm ?? 0)) || 0;

  const landRows = (res.landRows ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    return {
      pnu: String(r.pnu ?? '').trim(),
      addr: String(r.jibun ?? '').trim() || String(r.pnu ?? '').trim(),
      jimok: String(r.jimok ?? '미상'),
      area: formatSqm(areaSqm),
      ownerType: String(r.ownerType ?? '').trim() || undefined,
      ownerName: String(r.ownerName ?? '').trim() || undefined,
      publicPrice: formatPrice(r.publicPrice),
    };
  });

  const ownerStats = (res.ownerStats ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    return {
      label: String(r.label ?? '미상'),
      count: Number(r.count ?? 0) || 0,
      area: formatSqm(areaSqm),
      ratio: ratioText(areaSqm, totalAreaSqm),
    };
  });

  const jimokStats = (res.jimokStats ?? []).map((r) => {
    const areaSqm = Math.round(Number(r.areaSqm ?? 0)) || 0;
    return {
      jimok: String(r.jimok ?? '미상'),
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
  };
}

function mapProgress(
  progress: AnalyzeExtendedResponse['landRowsProgress'] | undefined
): MockParcelAnalysisResult['landRowsProgress'] {
  if (!progress) return undefined;
  return {
    loaded: Number(progress.loaded ?? 0) || 0,
    total: Number(progress.total ?? 0) || 0,
    loading: Boolean(progress.loading),
  };
}

function mapLandUseStats(
  rows: AnalyzeExtendedResponse['landUseStats'] | undefined
): MockLandUseStat[] {
  return (rows ?? []).map((r) => ({
    zone: String(r.zone ?? '미상'),
    count: Number(r.count ?? 0) || 0,
    area: String(r.area ?? '-'),
    ratio: String(r.ratio ?? '-'),
  }));
}

function mapBuildingRows(
  rows: AnalyzeExtendedResponse['buildingRows'] | undefined
): MockBuildingRow[] {
  return (rows ?? []).map((r) => ({
    pnu: String(r.pnu ?? '').trim(),
    addr: String(r.addr ?? '').trim(),
    bldNm: String(r.bldNm ?? '-'),
    platLoc: String(r.platLoc ?? '-'),
    jibun: String(r.jibun ?? '-'),
    roadAddr: String(r.roadAddr ?? '-'),
    bcRat: String(r.bcRat ?? '-'),
    vlRat: String(r.vlRat ?? '-'),
    jijigu: String(r.jijigu ?? '-'),
    platArea: String(r.platArea ?? '-'),
    totArea: String(r.totArea ?? '-'),
  }));
}

function mapFacilityStats(
  stats: AnalyzeExtendedResponse['facilityStats'] | undefined
): Record<string, MockFacilityStatRow[]> {
  const out: Record<string, MockFacilityStatRow[]> = {};
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
    const label = zones.find((z) => z.trim())?.trim() || '미상';
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
): MockLandUseStat[] {
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
  return data?.ok && data.landRows ? data.landRows : rows;
}

async function fetchBuildingChunk(
  rows: LandRow[]
): Promise<NonNullable<AnalyzeExtendedResponse['buildingRows']>> {
  if (!rows.length) return [];
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
  };
  return data?.ok && data.rows ? data.rows : [];
}

async function fetchLandUseZones(pnus: string[]): Promise<Record<string, string[]>> {
  if (!pnus.length) return {};
  const res = await call('', 'POST', {
    service: 'mapAnalyseService',
    action: 'fetchLandUseZonesByPnus',
    params: { pnus },
  });
  const data = (res?.data ?? res) as { ok?: boolean; zonesByPnu?: Record<string, string[]> };
  return data?.ok ? (data.zonesByPnu ?? {}) : {};
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
  const needsEnrich = needsLand;
  const needsBuilding = selectedIds.has('building:ledger');
  const needsLandUse = selectedIds.has('parcel:landUse');
  const needsLandRowPages = needsLand || needsBuilding || needsLandUse;

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
  let landUseStats: MockLandUseStat[] = [];
  let offset = 0;
  let enrichFailChunks = 0;
  let buildingFailChunks = 0;
  let landUseFailChunks = 0;

  const patchProgress = (loading: boolean) => {
    const notices: string[] = [];
    if (enrichFailChunks > 0) notices.push(`소유·공시 연계 일부 실패 ${enrichFailChunks}구간`);
    if (buildingFailChunks > 0) notices.push(`건축물대장 일부 실패 ${buildingFailChunks}구간`);
    if (landUseFailChunks > 0) notices.push(`토지이용계획 일부 실패 ${landUseFailChunks}구간`);
    onPatch({
      landRows: allLandRows,
      buildingRows: allBuildingRows,
      landUseStats,
      landRowsProgress: { loaded: allLandRows.length, total: totalCount, loading },
      landUseProgress: needsLandUse
        ? { loaded: allLandRows.length, total: totalCount, loading: loading && needsLandUse }
        : undefined,
      linkageNotice: notices.length
        ? `${notices.join(' · ')}. 표시된 표·통계는 유지됩니다.`
        : undefined,
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
            if (!isCancelled() && chunkBld.length) {
              allBuildingRows = [...allBuildingRows, ...chunkBld];
              patchProgress(offset < totalCount);
            }
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
