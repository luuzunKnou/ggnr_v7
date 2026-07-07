import type {
  MockBuildingRow,
  MockFacilityStatRow,
  MockLandUseStat,
  MockParcelAnalysisResult,
} from './mockParcelAnalysisResult';
import {
  DUMMY_BUILDING_LEDGER_ROWS,
  USE_DUMMY_BUILDING_LEDGER,
} from './parcelAnalysisBuildingLedgerDummy';

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
    buildingRows: resolveBuildingRows(res.buildingRows),
    facilityStats: mapFacilityStats(res.facilityStats),
    landUseStats: mapLandUseStats(res.landUseStats),
    landRowsProgress: mapProgress(res.landRowsProgress),
    landUseProgress: mapProgress(res.landUseProgress),
    wkt5181: res.wkt5181,
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

function resolveBuildingRows(
  rows: AnalyzeExtendedResponse['buildingRows'] | undefined
): MockBuildingRow[] {
  if (USE_DUMMY_BUILDING_LEDGER) return DUMMY_BUILDING_LEDGER_ROWS;
  return mapBuildingRows(rows);
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
