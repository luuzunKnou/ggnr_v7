/**
 * 필지 토지·소유 보강 공통 형식 — 필지분석·우클릭 필지정보(추후) 공유
 */
import type { KrasLandInfoRow } from '@/lib/krasLandXml';
import type { JijukLandAttrRow } from '@/service/jijukLandAttrService';

export type ParcelLandSource = 'db' | 'kras' | 'vworld' | 'cache';

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

export function maskOwnerName(name: string, masked: boolean): string {
  const v = toStr(name);
  if (!v) return '-';
  if (!masked) return v;
  return '**';
}

export function normalizeFromKrasRow(pnu: string, row: KrasLandInfoRow): NormalizedParcelLand {
  const jimokNm = toStr(row.JIMOK_NM) || toStr(row.JIMOK) || '미상';
  return {
    pnu,
    jimok: toStr(row.JIMOK) || jimokNm,
    jimokNm,
    areaSqm: toNum(row.PAREA),
    ownerName: toStr(row.OWNER_NM),
    ownerType: toStr(row.OWN_GBN_NM) || toStr(row.OWN_GBN) || '미상',
    publicPrice: toNum(row.PANN_JIGA) || null,
    source: 'kras',
  };
}

export function normalizeFromCacheRow(pnu: string, row: JijukLandAttrRow): NormalizedParcelLand {
  const jimok = toStr(row.jimok) || '미상';
  const areaSqm = toNum(row.lndpcl_ar);
  const price = row.pblntf_pclnd != null ? toNum(row.pblntf_pclnd) : null;
  return {
    pnu,
    jimok,
    jimokNm: jimok,
    areaSqm,
    ownerName: '',
    ownerType: toStr(row.ownship_se) || '미상',
    publicPrice: price != null && Number.isFinite(price) && price > 0 ? price : null,
    source: 'cache',
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
  const jimokNm = toStr(parts.jimokNm) || toStr(parts.jimok) || '미상';
  return {
    pnu,
    jimok: toStr(parts.jimok) || jimokNm,
    jimokNm,
    areaSqm: toNum(parts.areaSqm),
    ownerName: toStr(parts.ownerName),
    ownerType: toStr(parts.ownerType) || '미상',
    publicPrice: parts.publicPrice ?? null,
    source: 'vworld',
  };
}

function mergeRow(base: AnalyzeLandRow, enrich?: NormalizedParcelLand, masked = false): AnalyzeLandRow {
  if (!enrich) return base;
  const areaSqm = enrich.areaSqm > 0 ? enrich.areaSqm : base.areaSqm;
  const jimok = enrich.jimokNm !== '미상' ? enrich.jimokNm : enrich.jimok || base.jimok;
  const ownerType = enrich.ownerType !== '미상' ? enrich.ownerType : base.ownerType ?? '미상';
  const ownerName = enrich.ownerName
    ? maskOwnerName(enrich.ownerName, masked)
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
  };
}

/** 토지현황 목록만 보강 (소유·지목 통계는 DB 유지) */
export function applyEnrichmentToLandRows(
  landRows: AnalyzeLandRow[],
  enrichments: ParcelLandEnrichmentMap,
  maskOwner = false
): AnalyzeLandRow[] {
  return landRows.map((row) => mergeRow(row, enrichments[row.pnu], maskOwner));
}

export function recomputeOwnerStats(rows: AnalyzeLandRow[]): OwnerStatRow[] {
  const map = new Map<string, { count: number; areaSqm: number }>();
  for (const row of rows) {
    const label = toStr(row.ownerType) || '미상';
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
    const jimok = toStr(row.jimok) || '미상';
    const prev = map.get(jimok) ?? { count: 0, areaSqm: 0 };
    map.set(jimok, { count: prev.count + 1, areaSqm: prev.areaSqm + toNum(row.areaSqm) });
  }
  return [...map.entries()]
    .map(([jimok, v]) => ({ jimok, count: v.count, areaSqm: v.areaSqm }))
    .sort((a, b) => b.areaSqm - a.areaSqm);
}

/** DB 분석 행 + 보강 맵 → 목록·통계 갱신 */
export function applyEnrichmentToAnalyze(params: {
  landRows: AnalyzeLandRow[];
  allRows: AnalyzeLandRow[];
  enrichments: ParcelLandEnrichmentMap;
  maskOwner?: boolean;
}): {
  landRows: AnalyzeLandRow[];
  ownerStats: OwnerStatRow[];
  jimokStats: JimokStatRow[];
  enrichmentSource: ParcelLandSource | 'mixed' | 'db';
} {
  const { enrichments, maskOwner = false } = params;
  const mergeOne = (row: AnalyzeLandRow) => mergeRow(row, enrichments[row.pnu], maskOwner);

  const enrichedAll = params.allRows.map(mergeOne);
  const enrichedLandRows = params.landRows.map(mergeOne);

  const sources = new Set(
    Object.values(enrichments)
      .map((e) => e.source)
      .filter(Boolean)
  );
  let enrichmentSource: ParcelLandSource | 'mixed' | 'db' = 'db';
  if (sources.size === 1) enrichmentSource = [...sources][0]!;
  else if (sources.size > 1) enrichmentSource = 'mixed';

  return {
    landRows: enrichedLandRows,
    ownerStats: recomputeOwnerStats(enrichedAll),
    jimokStats: recomputeJimokStats(enrichedAll),
    enrichmentSource,
  };
}
