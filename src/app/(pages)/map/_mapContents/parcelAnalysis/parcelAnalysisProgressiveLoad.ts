import { call } from '@/lib/api';
import type { AnalyzeExtendedResponse } from './buildParcelAnalysisResult';
import { PARCEL_ANALYSIS_LAND_CHUNK } from './parcelAnalysisChunk';
import {
  landUseBucketToStats,
  mergeLandUseZoneChunk,
} from './parcelAnalysisLandUseAggregate';
import type { MockLandUseStat } from './mockParcelAnalysisResult';
import { USE_DUMMY_BUILDING_LEDGER } from './parcelAnalysisBuildingLedgerDummy';

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
  const needsBuilding = selectedIds.has('building:ledger') && !USE_DUMMY_BUILDING_LEDGER;
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

  const patchProgress = (loading: boolean) => {
    onPatch({
      landRows: allLandRows,
      buildingRows: allBuildingRows,
      landUseStats,
      landRowsProgress: { loaded: allLandRows.length, total: totalCount, loading },
      landUseProgress: needsLandUse
        ? { loaded: allLandRows.length, total: totalCount, loading: loading && needsLandUse }
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
            /* DB 행 유지 */
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
            /* 무시 */
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
            /* 무시 */
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
